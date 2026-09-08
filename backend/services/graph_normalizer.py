"""Semantic normalization utilities for graph generation.

This module prevents raw AST serialization from leaking into graph node IDs.
It filters noisy call targets and normalizes valid symbols into stable IDs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set


_NOISY_PATTERNS = (
	"Call(",
	"BoolOp(",
	"Subscript(",
	"Attribute(",
	"Load(",
	"Store(",
	"<ast.",
)

# Default: do not include primitive string-ish method chains.
# These can be enabled at graph_level >= 3 if desired.
_PRIMITIVE_METHODS = {
	"strip",
	"lstrip",
	"rstrip",
	"replace",
	"lower",
	"upper",
	"startswith",
	"endswith",
	"split",
	"join",
	"format",
}

_NOISE_SEGMENTS = {
	".venv",
	"venv",
	"env",
	"node_modules",
	"site-packages",
	"__pycache__",
	".git",
	".tox",
	".mypy_cache",
	".ruff_cache",
	".pytest_cache",
	".next",
	".nuxt",
	".svelte-kit",
	"dist",
	"build",
}


def is_semantic_id(value: str) -> bool:
	"""Return True if the value looks like a stable semantic identifier."""
	if not value:
		return False
	v = value.strip()
	if not v:
		return False
	if any(pat in v for pat in _NOISY_PATTERNS):
		return False
	if any(ch in v for ch in {" ", "\t", "\n", "=", "<", ">"}):
		return False
	# Disallow full AST dumps which often contain parentheses/ctx=
	if "ctx=" in v or v.startswith("ast."):
		return False
	return True


def _last_segment(name: str) -> str:
	parts = [p for p in (name or "").split(".") if p]
	return parts[-1] if parts else ""


def contains_noise_namespace(value: str) -> bool:
	"""Return True when an identifier clearly points into dependency/cache noise."""
	parts = [part.lower() for part in (value or "").split(".") if part]
	return any(part in _NOISE_SEGMENTS for part in parts)


def build_module_suffix_index(project_modules: Set[str]) -> Dict[str, Optional[str]]:
	"""Map every dotted suffix of every project module back to that module.

	Projects are routinely imported from a directory that is not the repo root --
	a Django app importing `learning_paths.models` when the file lives at
	`backend/apps/learning_paths/models.py`. Without this, every such import looks
	external and its dependency edge is lost.

	A suffix claimed by two different modules resolves to None: ambiguous is not
	worth guessing at, and a wrong edge is worse than a missing one.
	"""
	index: Dict[str, Optional[str]] = {}
	for module in project_modules:
		parts = [part for part in str(module).split(".") if part]
		# Skip the full name; exact matches are handled before this index is used.
		for start in range(1, len(parts)):
			suffix = ".".join(parts[start:])
			current = index.get(suffix, "")
			if current == "":
				index[suffix] = module
				continue
			if current is None or current == module:
				continue
			# Prefer the module closest to the repo root; a tie is ambiguous.
			if len(module.split(".")) < len(current.split(".")):
				index[suffix] = module
			elif len(module.split(".")) == len(current.split(".")):
				index[suffix] = None
	return index


@dataclass(frozen=True)
class SymbolIndex:
	"""Lookup tables for resolving local function/method names to stable IDs."""

	module_name: str
	project_modules: Set[str]
	local_functions: Dict[str, str]
	local_methods: Dict[str, str]
	language: Optional[str] = None
	# Class name -> qualified id, for classes defined in this module.
	local_classes: Dict[str, str] = field(default_factory=dict)
	# Imported symbol (alias or name) -> qualified id, from `from x import Y`.
	imported_symbols: Dict[str, str] = field(default_factory=dict)
	# Module alias -> resolved module id, from `import x` / `import x as y`.
	imported_modules: Dict[str, str] = field(default_factory=dict)
	# Dotted suffix -> project module, from build_module_suffix_index.
	module_suffixes: Dict[str, Optional[str]] = field(default_factory=dict)

	def resolve_local(self, called: str) -> Optional[str]:
		last = _last_segment(called)
		if not last:
			return None
		if last in self.local_methods:
			return self.local_methods[last]
		if last in self.local_functions:
			return self.local_functions[last]
		return None

	@property
	def package_parts(self) -> List[str]:
		"""Dotted parts of the package containing this module."""
		return [part for part in self.module_name.split(".") if part][:-1]

	def absolutize(self, module: str, level: int) -> str:
		"""Resolve a relative import to an absolute dotted module name.

		`from . import x` (level 1) resolves against the current package,
		`from .. import x` (level 2) against its parent, and so on. The parser
		records `level` but nothing used it, so every relative import used to
		arrive here unqualified ("models") and fail to match any project module.
		"""
		if level <= 0:
			return module
		parts = self.package_parts
		keep = len(parts) - (level - 1)
		base = parts[: max(0, keep)]
		if module:
			base = base + [part for part in module.split(".") if part]
		return ".".join(base)

	def resolve_base(self, base: str) -> Optional[str]:
		"""Qualify a base-class expression against this module's scope.

		The parser emits bases as bare source text ("Model", "models.Model") while
		class node ids are fully qualified ("app.models.Model"), so inheritance
		edges could never connect to a real class. This closes that gap.
		"""
		candidate = (base or "").strip()
		if not candidate or not is_semantic_id(candidate):
			return None

		head, dot, rest = candidate.partition(".")
		if not dot:
			if candidate in self.local_classes:
				return self.local_classes[candidate]
			if candidate in self.imported_symbols:
				return self.imported_symbols[candidate]
			return candidate

		# Dotted base such as `models.Model`: qualify through the module alias.
		if head in self.imported_modules:
			return f"{self.imported_modules[head]}.{rest}"
		if head in self.imported_symbols:
			return f"{self.imported_symbols[head]}.{rest}"
		return candidate


class GraphNormalizer:
	"""Normalize and filter graph entities for frontend-safe export."""

	def __init__(self, *, graph_level: int = 2) -> None:
		self.graph_level = max(1, min(int(graph_level), 3))

	def normalize_import_target(
		self,
		imported_module: str,
		*,
		index: SymbolIndex,
		level: int = 0,
		name: Optional[str] = None,
	) -> Optional[str]:
		"""Resolve an import to a graph node id, or None if it is not usable.

		Previously this returned None for anything that was not textually equal to
		a project module, which silently discarded nearly every Python import --
		and, because an edge dies with its endpoint, nearly every dependency edge.
		Unresolved targets are now returned as-is so the caller can keep them as
		external nodes.
		"""
		raw = (imported_module or "").strip()
		if level and level > 0:
			raw = index.absolutize(raw, int(level))
		if not raw or not is_semantic_id(raw):
			return None
		if contains_noise_namespace(raw):
			return None

		# Exact project module.
		if raw in index.project_modules:
			return raw

		# `from pkg import submodule` -- the parser records module="pkg", so the
		# submodule only resolves once the imported name is appended.
		if name:
			combined = f"{raw}.{name}"
			if combined in index.project_modules:
				return combined

		# Longest project-module prefix, for `from pkg.mod import symbol` where the
		# recorded module already reaches past the module into a symbol.
		parts = raw.split(".")
		for stop in range(len(parts) - 1, 0, -1):
			candidate = ".".join(parts[:stop])
			if candidate in index.project_modules:
				return candidate

		# The mirror of the case below: the repo root sits *inside* the package, so
		# imports carry leading segments the module ids do not have (code says
		# `backend.services.parser`, the module is `services.parser`). Strip from
		# the left, longest tail first, and require two segments so that
		# `import os.path` cannot bind to a project `path.py`.
		if "." in raw:
			for start in range(1, len(raw.split(".")) - 1):
				tail = ".".join(raw.split(".")[start:])
				if tail in index.project_modules:
					return tail

		# Dotted name that matches a project module's tail: the project is being
		# imported from a sys.path root below the repo root. Single-segment names
		# are deliberately excluded -- `import os` must not bind to `pkg/os.py`.
		if "." in raw:
			matched = index.module_suffixes.get(raw)
			if matched:
				return matched
			if name:
				matched = index.module_suffixes.get(f"{raw}.{name}")
				if matched:
					return matched

		# Unresolved: an external/stdlib package. Keep it -- the export tags these
		# is_external and the UI hides them behind its existing toggle.
		return raw

	def normalize_call_target(self, called: str, *, index: SymbolIndex) -> Optional[str]:
		"""Normalize a parser-produced call target into a stable graph node ID.

		Rules:
		- Drop raw AST dumps and temporary expressions.
		- Drop primitive method chains by default (graph_level 1/2).
		- Prefer resolving to local project symbols.
		- Optionally include lightweight built-in method nodes at level 3.
		"""
		if not called:
			return None

		candidate = called.strip()
		if not is_semantic_id(candidate):
			return None
		if contains_noise_namespace(candidate):
			return None

		# Filter out obvious AST-ish remnants even if they passed the semantic check.
		if any(pat in candidate for pat in _NOISY_PATTERNS):
			return None

		last = _last_segment(candidate)
		if not last:
			return None

		# Remove primitive method chains unless at the most detailed level.
		if last in _PRIMITIVE_METHODS and self.graph_level < 3:
			return None

		# Prefer resolving to a local symbol.
		local = index.resolve_local(candidate)
		if local:
			return local

		# If this looks like a project module qualified call, keep it.
		# Example: backend.services.foo.bar
		if "." in candidate:
			prefix = ".".join(candidate.split(".")[:-1])
			if prefix in index.project_modules:
				return candidate

		# Primitive method chains (`str.strip`, `list.join`, ...) are not code the
		# user wrote and only add noise now that level 3 is the persisted level.
		if last in _PRIMITIVE_METHODS:
			return None

		# Default: drop unknown external calls to reduce noise.
		return None

	def node_display_name(self, node_id: str) -> str:
		return node_id.split(".")[-1]

	def edge_id(self, source: str, target: str, edge_type: str) -> str:
		# Deterministic, stable edge id.
		return re.sub(r"[^A-Za-z0-9_:\-\.>]+", "_", f"{source}>{target}:{edge_type}")

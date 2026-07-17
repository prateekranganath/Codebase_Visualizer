"""Semantic normalization utilities for graph generation.

This module prevents raw AST serialization from leaking into graph node IDs.
It filters noisy call targets and normalizes valid symbols into stable IDs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Optional, Set


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


@dataclass(frozen=True)
class SymbolIndex:
	"""Lookup tables for resolving local function/method names to stable IDs."""

	module_name: str
	project_modules: Set[str]
	local_functions: Dict[str, str]
	local_methods: Dict[str, str]
	language: Optional[str] = None

	def resolve_local(self, called: str) -> Optional[str]:
		last = _last_segment(called)
		if not last:
			return None
		if last in self.local_methods:
			return self.local_methods[last]
		if last in self.local_functions:
			return self.local_functions[last]
		return None


class GraphNormalizer:
	"""Normalize and filter graph entities for frontend-safe export."""

	def __init__(self, *, graph_level: int = 2) -> None:
		self.graph_level = max(1, min(int(graph_level), 3))

	def normalize_import_target(self, imported_module: str, *, index: SymbolIndex) -> Optional[str]:
		if not imported_module:
			return None
		# Keep project-local imports.
		if imported_module in index.project_modules:
			return imported_module

		# JS/TS: allow external package imports to show dependency edges.
		if (index.language or "").lower() in {"javascript", "typescript"}:
			return imported_module

		# Default: only keep imports to modules that exist in the project graph.
		if self.graph_level < 3:
			return None
		return imported_module

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

		# Level 3 can include minimal built-in method nodes.
		if self.graph_level >= 3 and last in _PRIMITIVE_METHODS:
			return f"str.{last}"

		# Default: drop unknown external calls to reduce noise.
		return None

	def node_display_name(self, node_id: str) -> str:
		return node_id.split(".")[-1]

	def edge_id(self, source: str, target: str, edge_type: str) -> str:
		# Deterministic, stable edge id.
		return re.sub(r"[^A-Za-z0-9_:\-\.>]+", "_", f"{source}>{target}:{edge_type}")

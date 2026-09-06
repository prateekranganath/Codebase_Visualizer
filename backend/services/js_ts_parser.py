"""Lightweight JS/TS parser for dependency graphing.

This is a heuristic parser intended for fast imports/exports, top-level symbol discovery,
and rudimentary call/method extraction without requiring a native JS AST runtime.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from backend.services.codebase_manager import read_file

_IMPORT_RE = re.compile(
	r"""^\s*(?:import|export)\s+(?:[^;]*?)\s+from\s+['\"]([^'\"]+)['\"]""",
	re.MULTILINE,
)
_REQUIRE_RE = re.compile(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)")
_DYNAMIC_IMPORT_RE = re.compile(r"import\(\s*['\"]([^'\"]+)['\"]\s*\)")

# Discover classes and their bases
_CLASS_RE = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+extends\s+([A-Za-z_$][A-Za-z0-9_$]*))?\b")

# Discover functions (both `function foo()` and `const foo = () =>`)
_FUNCTION_RE = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b")
_ARROW_FUNC_RE = re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>")

# Discover potential method declarations (very heuristic: word followed by parenthesis and an opening brace)
_METHOD_RE = re.compile(r"^\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{", re.MULTILINE)

# Discover function calls (any identifier followed by a parenthesis)
_CALL_RE = re.compile(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")


def _resolve_relative_import(root_dir: str, relative_path: str, spec: str) -> str:
	if not spec.startswith("."):
		return spec

	base_dir = Path(relative_path).parent
	candidate = (base_dir / spec).as_posix()
	root_path = Path(root_dir)
	for suffix in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
		path = (root_path / f"{candidate}{suffix}")
		if path.exists():
			return Path(f"{candidate}{suffix}").with_suffix("").as_posix().replace("/", ".")
	for suffix in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
		path = (root_path / candidate / f"index{suffix}")
		if path.exists():
			index_path = Path(candidate) / f"index{suffix}"
			return index_path.with_suffix("").as_posix().replace("/", ".")

	return spec


def _collect_imports(root_dir: str, relative_path: str, text: str) -> List[Dict[str, Any]]:
	imports: List[Dict[str, Any]] = []
	for module in _IMPORT_RE.findall(text):
		resolved = _resolve_relative_import(root_dir, relative_path, module)
		imports.append({"type": "import", "module": resolved, "name": module})
	for module in _REQUIRE_RE.findall(text):
		resolved = _resolve_relative_import(root_dir, relative_path, module)
		imports.append({"type": "require", "module": resolved, "name": module})
	for module in _DYNAMIC_IMPORT_RE.findall(text):
		resolved = _resolve_relative_import(root_dir, relative_path, module)
		imports.append({"type": "dynamic_import", "module": resolved, "name": module})
	return imports


def _extract_calls(text_block: str) -> List[str]:
	"""Extract all potential function calls from a block of text."""
	ignore = {"if", "for", "while", "switch", "catch", "function", "return", "import", "require"}
	calls = []
	for match in _CALL_RE.finditer(text_block):
		call_name = match.group(1)
		if call_name not in ignore:
			calls.append(call_name)
	return sorted(set(calls))


def parse_js_ts_string(text: str, relative_path: str, root_dir: str = "") -> Dict[str, Any]:
	"""Parse JS/TS source code text into structured module data."""
	lines = text.split("\n")

	functions_data: List[Dict[str, Any]] = []
	classes_data: List[Dict[str, Any]] = []

	current_block_type = None
	current_block_name = None
	current_block_bases = []
	current_block_content: List[str] = []
	bracket_depth = 0

	def finalize_block():
		nonlocal current_block_type, current_block_name, current_block_bases, current_block_content
		if current_block_type and current_block_name:
			content_str = "\n".join(current_block_content)
			calls = _extract_calls(content_str)
			
			if current_block_type == "function":
				functions_data.append({
					"name": current_block_name,
					"async": False,
					"args": [],
					"returns": None,
					"docstring": None,
					"calls": calls,
					"decorators": [],
				})
			elif current_block_type == "class":
				# Extract methods inside the class block
				methods = []
				for match in _METHOD_RE.finditer(content_str):
					method_name = match.group(1)
					if method_name not in {"constructor", "if", "for", "while", "switch", "catch"}:
						methods.append({
							"name": method_name,
							"async": False,
							"args": [],
							"returns": None,
							"docstring": None,
							"calls": calls,  # assign class-level calls to methods heuristically
							"decorators": [],
						})

				classes_data.append({
					"name": current_block_name,
					"bases": current_block_bases,
					"keywords": [],
					"docstring": None,
					"decorators": [],
					"methods": methods,
					"attributes": [],
				})
		
		current_block_type = None
		current_block_name = None
		current_block_bases = []
		current_block_content = []

	for line in lines:
		# Detect block starts if we are at top level
		if bracket_depth == 0:
			cls_match = _CLASS_RE.search(line)
			if cls_match:
				finalize_block()
				current_block_type = "class"
				current_block_name = cls_match.group(1)
				if cls_match.group(2):
					current_block_bases.append(cls_match.group(2))
			else:
				fn_match = _FUNCTION_RE.search(line)
				if fn_match:
					finalize_block()
					current_block_type = "function"
					current_block_name = fn_match.group(1)
				else:
					arr_match = _ARROW_FUNC_RE.search(line)
					if arr_match:
						finalize_block()
						current_block_type = "function"
						current_block_name = arr_match.group(1)

		# Track depth
		bracket_depth += line.count("{")
		bracket_depth -= line.count("}")

		if current_block_type:
			current_block_content.append(line)

		# If we return to top level, finalize
		if bracket_depth <= 0 and current_block_type:
			bracket_depth = 0
			finalize_block()

	# Finalize any remaining block
	finalize_block()

	suffix = Path(relative_path).suffix
	module_name = (relative_path[:-len(suffix)] if suffix else relative_path).replace("/", ".").replace("\\", ".")
	return {
		"path": relative_path,
		"module_name": module_name,
		"language": "javascript" if relative_path.endswith((".js", ".jsx", ".mjs", ".cjs")) else "typescript",
		"docstring": None,
		"imports": _collect_imports(root_dir, relative_path, text),
		"functions": functions_data,
		"classes": classes_data,
	}


def parse_js_ts_module(root_dir: str, relative_path: str) -> Dict[str, Any]:
	"""Parse a JS/TS module and return structured information using an advanced heuristic block parser."""
	text = read_file(root_dir, relative_path)
	return parse_js_ts_string(text, relative_path, root_dir)

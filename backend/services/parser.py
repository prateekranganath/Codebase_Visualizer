"""AST-based parsing helpers for the codebase service layer."""

from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from backend.services.codebase_manager import read_file, resolve_safe_path
from backend.services.js_ts_parser import parse_js_ts_module, parse_js_ts_string


def parse_file_contents(root_dir: str, relative_path: str) -> ast.AST:
	"""
	Parse a Python file into an AST.

	Args:
		root_dir: The project root directory.
		relative_path: The file path relative to the project root.

	Returns:
		The parsed AST for the file.

	Raises:
		ValueError: If the file is not a Python file or cannot be parsed.
	"""
	if not relative_path.endswith(".py"):
		raise ValueError("Path must be a Python file")

	file_contents = read_file(root_dir, relative_path)
	if not file_contents.strip():
		return ast.parse("")

	try:
		return ast.parse(file_contents)
	except SyntaxError as exc:
		raise ValueError(f"Failed to parse Python file: {relative_path}") from exc



def _unparse_node(node: Optional[ast.AST]) -> Optional[str]:
	"""Convert an AST node to source text when possible."""
	if node is None:
		return None

	try:
		return ast.unparse(node)
	except Exception:
		return ast.dump(node)


def _get_call_name(node: ast.AST) -> str:
	"""Return a readable name for a call target."""
	if isinstance(node, ast.Name):
		return node.id
	if isinstance(node, ast.Attribute):
		# Avoid leaking full AST dumps for chained/temporary expressions.
		# If the base is complex (e.g., another Call), keep only the attribute name.
		if isinstance(node.value, (ast.Name, ast.Attribute)):
			parent = _get_call_name(node.value)
			return f"{parent}.{node.attr}" if parent else node.attr
		return node.attr
	if isinstance(node, ast.Call):
		# Nested call: resolve its function name.
		return _get_call_name(node.func)
	# Fallback: do not return ast.dump(node) (too noisy for graph ids).
	return ""


def _extract_imports(tree: ast.AST) -> List[Dict[str, Any]]:
	imports: List[Dict[str, Any]] = []

	for node in ast.walk(tree):
		if isinstance(node, ast.Import):
			for alias in node.names:
				imports.append(
					{
						"type": "import",
						"module": alias.name,
						"name": alias.asname or alias.name,
					}
				)
		elif isinstance(node, ast.ImportFrom):
			for alias in node.names:
				imports.append(
					{
						"type": "from_import",
						"module": node.module,
						"name": alias.name,
						"alias": alias.asname,
						"level": node.level,
					}
				)

	return imports


def _extract_function_info(node: ast.FunctionDef | ast.AsyncFunctionDef) -> Dict[str, Any]:
	args = []
	positional_args = list(node.args.posonlyargs) + list(node.args.args)

	for arg in positional_args:
		args.append(
			{
				"name": arg.arg,
				"annotation": _unparse_node(arg.annotation),
			}
		)

	if node.args.vararg:
		args.append(
			{
				"name": f"*{node.args.vararg.arg}",
				"annotation": _unparse_node(node.args.vararg.annotation),
			}
		)

	for arg in node.args.kwonlyargs:
		args.append(
			{
				"name": arg.arg,
				"annotation": _unparse_node(arg.annotation),
			}
		)

	if node.args.kwarg:
		args.append(
			{
				"name": f"**{node.args.kwarg.arg}",
				"annotation": _unparse_node(node.args.kwarg.annotation),
			}
		)

	calls = []
	for child in ast.walk(node):
		if isinstance(child, ast.Call):
			calls.append(_get_call_name(child.func))

	return {
		"name": node.name,
		"async": isinstance(node, ast.AsyncFunctionDef),
		"args": args,
		"returns": _unparse_node(node.returns),
		"docstring": ast.get_docstring(node),
		"calls": sorted(set(calls)),
		"decorators": [_unparse_node(decorator) for decorator in node.decorator_list],
	}


def _extract_class_info(node: ast.ClassDef) -> Dict[str, Any]:
	methods: List[Dict[str, Any]] = []
	attributes: List[str] = []

	for child in node.body:
		if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
			methods.append(_extract_function_info(child))
		elif isinstance(child, ast.Assign):
			for target in child.targets:
				if isinstance(target, ast.Name):
					attributes.append(target.id)
		elif isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
			attributes.append(child.target.id)

	return {
		"name": node.name,
		"bases": [_unparse_node(base) for base in node.bases],
		"keywords": [
			{
				"arg": keyword.arg,
				"value": _unparse_node(keyword.value),
			}
			for keyword in node.keywords
		],
		"docstring": ast.get_docstring(node),
		"decorators": [_unparse_node(decorator) for decorator in node.decorator_list],
		"methods": methods,
		"attributes": sorted(set(attributes)),
	}


def parse_python_string(code: str, relative_path: str = "") -> Dict[str, Any]:
	"""Parse Python source code text into structured module data."""
	if not code.strip():
		tree = ast.parse("")
	else:
		tree = ast.parse(code)

	functions: List[Dict[str, Any]] = []
	classes: List[Dict[str, Any]] = []

	for node in tree.body:
		if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
			functions.append(_extract_function_info(node))
		elif isinstance(node, ast.ClassDef):
			classes.append(_extract_class_info(node))

	suffix = Path(relative_path).suffix
	module_name = (relative_path[:-len(suffix)] if suffix else relative_path).replace("/", ".").replace("\\", ".")
	return {
		"path": relative_path,
		"module_name": module_name,
		"language": "python",
		"docstring": ast.get_docstring(tree),
		"imports": _extract_imports(tree),
		"functions": functions,
		"classes": classes,
	}


def parse_python_module(root_dir: str, relative_path: str) -> Dict[str, Any]:
	"""
	Parse a single Python module and return structured information.

	Args:
		root_dir: The project root directory.
		relative_path: The file path relative to the project root.

	Returns:
		A dictionary containing the module path, imports, classes, functions, and calls.
	"""
	file_contents = read_file(root_dir, relative_path)
	return parse_python_string(file_contents, relative_path)


def parse_code_string(code: str, relative_path: str, root_dir: str = "") -> Dict[str, Any]:
	"""
	Parse code string of supported file types (Python, JS, TS) into structured module data.
	"""
	suffix = Path(relative_path).suffix.lower()
	if suffix == ".py":
		return parse_python_string(code, relative_path)
	elif suffix in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
		return parse_js_ts_string(code, relative_path, root_dir)
	else:
		return {
			"path": relative_path,
			"module_name": relative_path,
			"language": "unknown",
			"docstring": None,
			"imports": [],
			"functions": [],
			"classes": [],
		}


def _source_file_exts() -> Tuple[str, ...]:
	return (".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")


def _should_skip_path_parts(parts: Iterable[str], *, skip_dirs: set[str]) -> bool:
	parts_lower = [part.lower() for part in parts]
	if any(part in skip_dirs for part in parts_lower):
		return True
	# Skip hidden dependency/cache roots even if they are not explicitly listed.
	if any(part.startswith(".") for part in parts_lower if part not in {".", ".."}):
		allowed_dot_dirs = {".github", ".gitignore"}
		if not any(part in allowed_dot_dirs for part in parts_lower):
			return True
	return False


def _iter_source_files(root_path: Path, target_root: Path, *, skip_dirs: set[str]) -> Iterable[Path]:
	for current_root, dirs, files in os.walk(target_root):
		current_path = Path(current_root)
		rel_parts = current_path.resolve().relative_to(root_path).parts
		if _should_skip_path_parts(rel_parts, skip_dirs=skip_dirs):
			dirs[:] = []
			continue

		# Prune ignored directories before walking deeper.
		pruned_dirs = []
		for directory in dirs:
			if _should_skip_path_parts(rel_parts + (directory,), skip_dirs=skip_dirs):
				continue
			pruned_dirs.append(directory)
		dirs[:] = pruned_dirs

		for filename in files:
			if Path(filename).suffix.lower() not in _source_file_exts():
				continue
			file_path = current_path / filename
			file_parts = file_path.resolve().relative_to(root_path).parts
			if _should_skip_path_parts(file_parts, skip_dirs=skip_dirs):
				continue
			yield file_path


def parse_codebase(root_dir: str, relative_path: str = "") -> Dict[str, Dict[str, Any]]:
	"""
	Parse supported source files under a directory and return structured module data.

	Args:
		root_dir: The project root directory.
		relative_path: Optional subdirectory to parse from.

	Returns:
		A mapping of relative file paths to parsed module data.
	"""
	# Directories to skip during parsing (common dependency/cache directories)
	SKIP_DIRS = {
		'.venv', 'venv', 'env', '.env',
		'node_modules', '__pycache__', '.git', '.pytest_cache',
		'build', 'dist', 'eggs', '.eggs', '*.egg-info',
		'site-packages', '.tox', '.coverage', 'htmlcov',
		'.mypy_cache', '.ruff_cache', '.pytest', 'migrations',
		'.vscode', '.idea', '.DS_Store', '__snapshots__',
		'.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache'
	}

	target_root = resolve_safe_path(root_dir, relative_path)

	if not target_root.exists():
		raise ValueError("Path does not exist")

	if target_root.is_file():
		suffix = target_root.suffix.lower()
		if suffix not in _source_file_exts():
			raise ValueError("Path must be a supported source file or directory")
		if suffix == ".py":
			parsed = parse_python_module(root_dir, relative_path)
		else:
			parsed = parse_js_ts_module(root_dir, relative_path)
		return {relative_path: parsed}

	codebase: Dict[str, Dict[str, Any]] = {}
	root_path = Path(root_dir).resolve()

	for file_path in _iter_source_files(root_path, target_root, skip_dirs=SKIP_DIRS):
		relative_file_path = file_path.resolve().relative_to(root_path).as_posix()
		suffix = file_path.suffix.lower()
		try:
			if suffix == ".py":
				codebase[relative_file_path] = parse_python_module(root_dir, relative_file_path)
			else:
				codebase[relative_file_path] = parse_js_ts_module(root_dir, relative_file_path)
		except Exception:
			# Skip files that cannot be decoded or parsed so the full graph rebuild can continue.
			continue

	return codebase


def update_codebase(root_dir: str, relative_path: str) -> Dict[str, Dict[str, Any]]:
	"""
	Re-parse a single Python file and return its latest structured representation.

	Args:
		root_dir: The project root directory.
		relative_path: The file path relative to the project root.

	Returns:
		A mapping containing the parsed module for the requested file.
	"""
	parsed_module = parse_python_module(root_dir, relative_path)
	return {relative_path: parsed_module}





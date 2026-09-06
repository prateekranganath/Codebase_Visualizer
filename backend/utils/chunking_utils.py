"""Code chunking utilities for semantic retrieval and embeddings."""

from __future__ import annotations

import ast
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.services.codebase_manager import read_file


def get_tokenizer(model_name: str = "cl100k_base"):
    """
    Get a tiktoken tokenizer, with fallback to character-based counting.

    Args:
        model_name: The encoding name (e.g., "cl100k_base" for GPT-3.5-turbo).

    Returns:
        A tokenizer object with encode/decode methods, or a fallback dict.
    """
    try:
        import tiktoken

        return tiktoken.get_encoding(model_name)
    except Exception:
        # Fallback: character-based tokenizer
        return {"encode": lambda x: x.split(), "decode": lambda x: " ".join(x)}


def estimate_token_count(text: str, tokenizer: Optional[Any] = None) -> int:
    """
    Estimate the number of tokens in text.

    Args:
        text: The text to count.
        tokenizer: Optional tokenizer (tiktoken or fallback dict).

    Returns:
        Estimated token count.
    """
    if tokenizer is None:
        tokenizer = get_tokenizer()

    try:
        # tiktoken tokenizer
        if hasattr(tokenizer, "encode"):
            tokens = tokenizer.encode(text)
            return len(tokens) if isinstance(tokens, list) else len(list(tokens))
    except Exception:
        pass

    # Fallback: characters / 4 heuristic
    return len(text) // 4


def compute_chunk_id(source: str, start_line: int, end_line: int) -> str:
    """
    Compute a deterministic ID for a chunk.

    Args:
        source: The source file path.
        start_line: Starting line number.
        end_line: Ending line number.

    Returns:
        A unique chunk ID like "path/file.py::L10-L20".
    """
    return f"{source}::L{start_line}-L{end_line}"


def compute_chunk_checksum(text: str) -> str:
    """
    Compute a stable checksum for a chunk.

    Args:
        text: The chunk text.

    Returns:
        SHA256 hash of the text.
    """
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _build_embed_text(source: str, symbol_name: Optional[str], snippet: str) -> str:
    """Prepend a location/symbol header to the text that gets embedded (not displayed).

    Retrieval then keys on file path and symbol name as well as raw content, without
    polluting the clean `text` field that gets rendered back into LLM prompts.
    """
    header = f"# File: {source}"
    if symbol_name:
        header += f"\n# Symbol: {symbol_name}"
    return f"{header}\n\n{snippet}"


def split_by_ast_functions(
    code: str,
) -> List[Tuple[int, int, str]]:
    """
    Split code into AST-aware chunks (functions, classes, methods).

    Args:
        code: Python source code.

    Returns:
        List of tuples: (start_line, end_line, snippet_text).
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []

    chunks = []
    for node in ast.walk(tree):
        if isinstance(
            node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            snippet = ast.get_source_segment(code, node)
            if snippet:
                chunks.append(
                    (
                        node.lineno,
                        node.end_lineno or node.lineno,
                        snippet,
                    )
                )

    return sorted(chunks, key=lambda x: x[0])


def _make_ast_chunk(
    node: ast.AST,
    code: str,
    source: str,
    *,
    parent_class: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    snippet = ast.get_source_segment(code, node)
    if not snippet:
        return None

    name = getattr(node, "name", "") or ""
    qualified_name = f"{parent_class}.{name}" if parent_class else name
    chunk_id = compute_chunk_id(source, node.lineno, node.end_lineno or node.lineno)
    checksum = compute_chunk_checksum(snippet)
    token_count = estimate_token_count(snippet)

    return {
        "id": chunk_id,
        "type": type(node).__name__,
        "name": name,
        "parent_class": parent_class,
        "source": source,
        "start_line": node.lineno,
        "end_line": node.end_lineno or node.lineno,
        "text": snippet,
        "embed_text": _build_embed_text(source, qualified_name, snippet),
        "checksum": checksum,
        "token_count": token_count,
        "docstring": ast.get_docstring(node),
    }


def chunk_code_with_meta(code: str, source: str = "unknown") -> List[Dict[str, Any]]:
    """
    Chunk Python code into AST-aware semantic units with metadata.

    Iterates top-level definitions only (not ast.walk), which previously visited a
    class's methods twice: once folded into the class's own chunk text, and again as
    a second, unrelated top-level chunk with no indication it belonged to that class.
    Here, a class is emitted as one whole-body chunk, and each of its methods is also
    emitted as its own chunk tagged with parent_class — giving both a coarse
    "what does this class do" hit and precise per-method hits, explicitly related.

    Args:
        code: Python source code.
        source: Optional file path for metadata.

    Returns:
        List of chunk dicts with type, name, parent_class, lines, text, embed_text,
        checksum, id, and token_count.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise ValueError(f"Failed to parse code: {exc}") from exc

    chunks: List[Dict[str, Any]] = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            chunk = _make_ast_chunk(node, code, source)
            if chunk:
                chunks.append(chunk)
        elif isinstance(node, ast.ClassDef):
            class_chunk = _make_ast_chunk(node, code, source)
            if class_chunk:
                chunks.append(class_chunk)
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_chunk = _make_ast_chunk(member, code, source, parent_class=node.name)
                    if method_chunk:
                        chunks.append(method_chunk)

    return sorted(chunks, key=lambda c: c["start_line"])


def chunk_text(
    text: str,
    source: str = "unknown",
    max_tokens: int = 512,
    overlap: int = 64,
    tokenizer: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Chunk text into overlapping token-sized pieces with metadata.

    Args:
        text: The text to chunk.
        source: Optional source identifier.
        max_tokens: Maximum tokens per chunk.
        overlap: Number of overlapping tokens between chunks.
        tokenizer: Optional custom tokenizer (tiktoken or fallback).

    Returns:
        List of chunk dicts with id, text, start_line, end_line, token_count, and checksum.
    """
    if tokenizer is None:
        tokenizer = get_tokenizer()

    try:
        import tiktoken

        if isinstance(tokenizer, tiktoken.Encoding):
            tokens = tokenizer.encode(text)
            token_list = tokens
            has_decode = True
        else:
            # Fallback tokenizer
            token_list = tokenizer["encode"](text)
            has_decode = hasattr(tokenizer, "decode")
    except Exception:
        # Fallback: split by words
        token_list = text.split()
        has_decode = False

    def _decode(tokens: Any) -> str:
        if has_decode:
            try:
                return tokenizer.decode(tokens)
            except Exception:
                return " ".join(str(t) for t in tokens)
        return " ".join(tokens)

    chunks: List[Dict[str, Any]] = []
    start_idx = 0
    chunk_num = 0

    # Running 1-indexed line counter. Advanced only by the newly-consumed stride
    # tokens each iteration (not the whole prefix from scratch), so tracking line
    # numbers stays O(n) total instead of O(n^2) on large files.
    prefix_line_count = 1
    prev_start_idx = 0

    while start_idx < len(token_list):
        end_idx = min(start_idx + max_tokens, len(token_list))
        chunk_tokens = token_list[start_idx:end_idx]
        chunk_text_str = _decode(chunk_tokens)

        if start_idx > prev_start_idx:
            prefix_line_count += _decode(token_list[prev_start_idx:start_idx]).count("\n")
        prev_start_idx = start_idx

        start_line = prefix_line_count
        end_line = start_line + chunk_text_str.count("\n")

        chunk_id = f"{source}::chunk_{chunk_num}"
        checksum = compute_chunk_checksum(chunk_text_str)
        token_count = len(chunk_tokens)

        chunk = {
            "id": chunk_id,
            "source": source,
            "start_token": start_idx,
            "end_token": end_idx,
            "start_line": start_line,
            "end_line": end_line,
            "text": chunk_text_str,
            "embed_text": _build_embed_text(source, None, chunk_text_str),
            "checksum": checksum,
            "token_count": token_count,
        }
        chunks.append(chunk)

        # Advance by (max_tokens - overlap)
        start_idx += max_tokens - overlap
        chunk_num += 1

    return chunks


def _chunk_python_code(
    code: str,
    source: str,
    *,
    max_tokens: int,
    overlap: int,
    tokenizer: Optional[Any],
) -> List[Dict[str, Any]]:
    """Chunk Python code, preferring AST-aware splits with a token fallback."""
    try:
        ast_chunks = chunk_code_with_meta(code, source=source)
    except ValueError:
        ast_chunks = []
    if ast_chunks:
        return ast_chunks
    return chunk_text(code, source=source, max_tokens=max_tokens, overlap=overlap, tokenizer=tokenizer)


def _chunk_generic_source(
    code: str,
    source: str,
    *,
    max_tokens: int,
    overlap: int,
    tokenizer: Optional[Any],
) -> List[Dict[str, Any]]:
    """Chunk non-Python source files with a tokenizer-based fallback."""
    return chunk_text(code, source=source, max_tokens=max_tokens, overlap=overlap, tokenizer=tokenizer)


def chunk_code(
    root_dir: str,
    relative_path: str,
    max_tokens: int = 512,
    overlap: int = 64,
    tokenizer: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Chunk a supported source file, preferring language-aware splits where available.

    Args:
        root_dir: Project root directory.
        relative_path: Relative path to the source file.
        max_tokens: Maximum tokens per chunk.
        overlap: Overlapping tokens between chunks.
        tokenizer: Optional custom tokenizer.

    Returns:
        List of chunk dicts with metadata.
    """
    code = read_file(root_dir, relative_path)
    suffix = Path(relative_path).suffix.lower()
    if suffix == ".py":
        return _chunk_python_code(
            code,
            relative_path,
            max_tokens=max_tokens,
            overlap=overlap,
            tokenizer=tokenizer,
        )
    return _chunk_generic_source(
        code,
        relative_path,
        max_tokens=max_tokens,
        overlap=overlap,
        tokenizer=tokenizer,
    )


def merge_small_chunks(
    chunks: List[Dict[str, Any]],
    min_tokens: int = 100,
    max_tokens: int = 512,
) -> List[Dict[str, Any]]:
    """
    Merge small chunks to avoid low-signal embeddings.

    Args:
        chunks: Input chunk list.
        min_tokens: Minimum tokens to keep a chunk standalone.
        max_tokens: Maximum tokens to allow after merging.

    Returns:
        List of merged chunks.
    """
    if not chunks:
        return []

    merged: List[Dict[str, Any]] = []
    current = None

    for chunk in chunks:
        if current is None:
            current = chunk.copy()
        else:
            merged_token_count = current.get("token_count", 0) + chunk.get("token_count", 0)

            # Merge if combined tokens fit within max and current is below min
            if merged_token_count <= max_tokens and current.get("token_count", 0) < min_tokens:
                # Merge chunk into current
                current["text"] = current.get("text", "") + "\n\n" + chunk.get("text", "")
                current["end_line"] = chunk.get("end_line", current.get("end_line"))
                current["token_count"] = merged_token_count
                current["checksum"] = compute_chunk_checksum(current["text"])
            else:
                # Push current and start new
                merged.append(current)
                current = chunk.copy()

    if current:
        merged.append(current)

    return merged


def detect_chunk_changes(
    old_chunks: List[Dict[str, Any]],
    new_chunks: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Detect which chunks were added, removed, or modified.

    Args:
        old_chunks: Previous chunk list.
        new_chunks: Current chunk list.

    Returns:
        Dict with keys: "added", "removed", "modified".
    """
    old_map = {chunk.get("id"): chunk for chunk in old_chunks}
    new_map = {chunk.get("id"): chunk for chunk in new_chunks}

    added = [chunk for chunk_id, chunk in new_map.items() if chunk_id not in old_map]
    removed = [chunk for chunk_id, chunk in old_map.items() if chunk_id not in new_map]
    modified = [
        chunk
        for chunk_id, chunk in new_map.items()
        if chunk_id in old_map
        and chunk.get("checksum") != old_map[chunk_id].get("checksum")
    ]

    return {
        "added": added,
        "removed": removed,
        "modified": modified,
    }


def rebuild_chunks_for_file(
    root_dir: str,
    relative_path: str,
    max_tokens: int = 512,
    overlap: int = 64,
    tokenizer: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Re-chunk a file after edits.

    Args:
        root_dir: Project root directory.
        relative_path: Relative path to the Python file.
        max_tokens: Maximum tokens per chunk.
        overlap: Overlapping tokens between chunks.
        tokenizer: Optional custom tokenizer.

    Returns:
        List of fresh chunk dicts.
    """
    return chunk_code(root_dir, relative_path, max_tokens, overlap, tokenizer)



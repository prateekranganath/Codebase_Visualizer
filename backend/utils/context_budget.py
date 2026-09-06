"""Token-budget-aware truncation for large files fed into LLM prompts.

Explain/refactor previously interpolated the full, untruncated file into the prompt,
so a large file could silently overflow the model's context window. truncate_smart
keeps the parts of a Python file most useful for an LLM (docstring, imports, every
top-level def/class signature) and spends the remaining budget on full bodies,
largest first, before falling back to a plain token-boundary head truncation.
"""

from __future__ import annotations

import ast
from typing import Any, List, Tuple

from backend.utils.chunking_utils import estimate_token_count, get_tokenizer

# Per-task token budgets, deliberately conservative relative to the assigned models'
# advertised context windows (256K-1M) -- free-tier effective limits are often lower
# than advertised, and smaller prompts fail less often.
TOKEN_BUDGETS: dict[str, dict[str, int]] = {
    "explain": {"file": 60_000, "chunks": 8_000, "graph": 2_000},
    "refactor": {"file": 100_000, "chunks": 8_000, "graph": 2_000},
    "teach": {"file": 20_000, "chunks": 6_000, "graph": 2_000},
    "evaluate": {"file": 0, "chunks": 4_000, "graph": 0},
}


def budget_for(task: str, kind: str) -> int:
    table = TOKEN_BUDGETS.get(task, TOKEN_BUDGETS["explain"])
    return table.get(kind, 0)


def _token_head(text: str, budget_tokens: int, tokenizer: Any) -> str:
    """Token-boundary head truncation (not a naive character slice)."""
    if budget_tokens <= 0:
        return ""
    try:
        if hasattr(tokenizer, "encode") and hasattr(tokenizer, "decode"):
            tokens = tokenizer.encode(text)
            if len(tokens) <= budget_tokens:
                return text
            return tokenizer.decode(tokens[:budget_tokens]) + "\n\n# ... truncated to fit context budget ..."
    except Exception:
        pass
    # Fallback heuristic: ~4 chars/token.
    char_budget = budget_tokens * 4
    if len(text) <= char_budget:
        return text
    return text[:char_budget] + "\n\n# ... truncated to fit context budget ..."


def _python_priority_truncate(source: str, budget_tokens: int, tokenizer: Any) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return _token_head(source, budget_tokens, tokenizer)

    lines = source.splitlines(keepends=True)

    def line_range(node: ast.AST) -> Tuple[int, int]:
        start = node.lineno - 1
        end = getattr(node, "end_lineno", node.lineno) - 1
        return start, end

    always_keep: List[Tuple[int, int]] = []
    body = list(tree.body)

    # Module docstring.
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), (ast.Constant,)):
        if isinstance(body[0].value.value, str):
            always_keep.append(line_range(body[0]))
            body = body[1:]

    top_defs: List[ast.AST] = []
    for node in body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            always_keep.append(line_range(node))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            top_defs.append(node)

    sig_ranges: List[Tuple[int, int]] = []
    bodies: List[Tuple[int, int, int]] = []  # (start, end, line_count) for full bodies
    for node in top_defs:
        start, end = line_range(node)
        deco_start = start
        if getattr(node, "decorator_list", None):
            deco_start = min(d.lineno - 1 for d in node.decorator_list)
        inner_body = getattr(node, "body", None) or []
        if inner_body:
            sig_end = max(deco_start, inner_body[0].lineno - 2)
        else:
            sig_end = end
        sig_ranges.append((deco_start, sig_end))
        body_start = inner_body[0].lineno - 1 if inner_body else start
        bodies.append((body_start, end, end - body_start))

    def render(ranges: List[Tuple[int, int]]) -> str:
        merged = sorted(set(ranges))
        return "\n".join("".join(lines[start : end + 1]) for start, end in merged)

    kept_ranges = always_keep + sig_ranges
    rendered = render(kept_ranges)
    used_tokens = estimate_token_count(rendered, tokenizer)

    # Fill in full bodies, largest first, until the budget runs out.
    bodies.sort(key=lambda b: b[2], reverse=True)
    extra_ranges: List[Tuple[int, int]] = []
    for start, end, _size in bodies:
        candidate = "".join(lines[start : end + 1])
        candidate_tokens = estimate_token_count(candidate, tokenizer)
        if used_tokens + candidate_tokens > budget_tokens:
            continue
        extra_ranges.append((start, end))
        used_tokens += candidate_tokens

    if not extra_ranges and not kept_ranges:
        return _token_head(source, budget_tokens, tokenizer)

    result = render(kept_ranges + extra_ranges)
    omitted = len(bodies) - len(extra_ranges)
    if omitted > 0:
        result += f"\n\n# ... {omitted} function/class body(ies) omitted to fit the context budget ...\n"
    return result


def truncate_smart(file_contents: str, *, budget_tokens: int, language: str = "python") -> str:
    """Fit file_contents within budget_tokens, preserving the most useful structure.

    Python: keeps the module docstring, all import lines, and every top-level
    def/class signature, then fills remaining budget with full bodies (largest
    first). Non-Python or unparsable files fall back to token-boundary head
    truncation via tiktoken.
    """
    if not file_contents or budget_tokens <= 0:
        return file_contents if budget_tokens > 0 else ""

    tokenizer = get_tokenizer()
    if estimate_token_count(file_contents, tokenizer) <= budget_tokens:
        return file_contents

    if language == "python":
        try:
            return _python_priority_truncate(file_contents, budget_tokens, tokenizer)
        except Exception:
            pass

    return _token_head(file_contents, budget_tokens, tokenizer)


def language_for_path(file_path: str) -> str:
    return "python" if file_path.lower().endswith(".py") else "text"

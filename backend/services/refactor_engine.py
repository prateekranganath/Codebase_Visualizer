"""Refactor engine for generating, validating, and applying code improvements."""

from __future__ import annotations

import ast
import difflib
import re
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.config.settings import settings
from backend.services.ai_engine import AIEngine
from backend.services import codebase_manager
from backend.services.graph_builder import CodeGraphBuilder
from backend.services.parser import parse_code_string


@dataclass
class RefactorProposal:
    """A proposed code refactoring with reasoning and risks."""

    file_path: str
    goal: str
    original_code: str
    suggested_code: str
    diff: str
    reasoning: str
    risks: List[str]
    estimated_lines_changed: int
    estimated_complexity_change: int  # percent
    cached: bool = False


@dataclass
class ValidationReport:
    """Report on the safety and validity of a refactoring."""

    is_valid: bool
    syntax_errors: List[str]
    import_errors: List[str]
    breaking_changes: List[str]
    affected_dependents: List[str]
    complexity_delta: int  # percent change


@dataclass
class RefactorResult:
    """Result of applying a refactoring to a file."""

    success: bool
    file_path: str
    lines_changed: int
    backup_path: Optional[str]
    summary: str
    timestamp: str


class RefactorEngine:
    """Engine for proposing, validating, and applying code refactorings."""

    def __init__(
        self,
        ai_engine: AIEngine,
        codebase_manager: Any,
        graph_builder: CodeGraphBuilder,
    ) -> None:
        """
        Initialize the refactor engine.

        Args:
            ai_engine: AIEngine for generating suggestions.
            codebase_manager: CodebaseManager for file I/O.
            graph_builder: CodeGraphBuilder for dependency analysis.
        """
        self.ai_engine = ai_engine
        self.codebase_manager = codebase_manager
        self.graph_builder = graph_builder

    def propose_refactor(
        self,
        file_path: str,
        goal: str,
        top_k: int = 5,
        root_dir: Optional[str] = None,
        force_refresh: bool = False,
    ) -> RefactorProposal:
        """
        Generate an AI-proposed refactoring for a file with a specific goal.

        Args:
            file_path: Path to the file to refactor.
            goal: Goal or intent (e.g., "simplify", "extract method", "reduce duplication").
            top_k: Context chunks to retrieve for the LLM.
            root_dir: Optional project root directory.
            force_refresh: Bypass the server-side result cache and regenerate.

        Returns:
            RefactorProposal with suggested code, diff, reasoning, and risks.
        """
        target_root = root_dir or settings.root_dir

        # Read the original file
        original_code = self.codebase_manager.read_file(target_root, file_path)

        # Use ai_engine to propose refactoring
        ai_response = self.ai_engine.propose_refactor(
            file_path=file_path,
            goal=goal,
            top_k=top_k,
            root_dir=target_root,
            force_refresh=force_refresh,
        )

        suggested_code = ai_response.get("suggested_code", "")
        reasoning = ai_response.get("reasoning", "")
        ai_risks = ai_response.get("risks", [])
        cached = bool(ai_response.get("cached", False))

        # Generate diff
        diff_str = self.generate_diff(original_code, suggested_code, file_path)

        # Estimate changes
        lines_changed = self._estimate_lines_changed(original_code, suggested_code)
        complexity_delta = self._estimate_complexity_change(
            original_code, suggested_code
        )

        return RefactorProposal(
            file_path=file_path,
            goal=goal,
            original_code=original_code,
            suggested_code=suggested_code,
            diff=diff_str,
            reasoning=reasoning,
            risks=ai_risks,
            estimated_lines_changed=lines_changed,
            estimated_complexity_change=complexity_delta,
            cached=cached,
        )

    def generate_diff(
        self,
        original_code: str,
        refactored_code: str,
        file_path: str,
    ) -> str:
        """
        Generate a unified diff between original and refactored code.

        Args:
            original_code: The original code.
            refactored_code: The refactored code.
            file_path: Path to the file (for diff header).

        Returns:
            Unified diff string suitable for display or patching.
        """
        original_lines = original_code.splitlines(keepends=True)
        refactored_lines = refactored_code.splitlines(keepends=True)

        diff = difflib.unified_diff(
            original_lines,
            refactored_lines,
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
            lineterm="",
        )

        return "\n".join(diff)

    def _check_js_ts_syntax(self, code: str) -> List[str]:
        """Check for basic syntax issues in JS/TS code like unclosed brackets or strings."""
        errors: List[str] = []
        stack: List[Tuple[str, int]] = []
        brackets = {")": "(", "}": "{", "]": "["}
        in_string: Optional[str] = None
        escape = False
        in_comment: Optional[str] = None

        lines = code.splitlines()
        for line_idx, line in enumerate(lines, 1):
            i = 0
            while i < len(line):
                char = line[i]

                # Handle comments
                if not in_string:
                    if in_comment == "block":
                        if char == "*" and i + 1 < len(line) and line[i + 1] == "/":
                            in_comment = None
                            i += 2
                            continue
                        i += 1
                        continue
                    elif in_comment == "line":
                        break
                    elif char == "/" and i + 1 < len(line):
                        if line[i + 1] == "/":
                            break
                        elif line[i + 1] == "*":
                            in_comment = "block"
                            i += 2
                            continue

                # Handle strings
                if not in_comment:
                    if in_string:
                        if escape:
                            escape = False
                        elif char == "\\":
                            escape = True
                        elif char == in_string:
                            in_string = None
                        i += 1
                        continue
                    elif char in ("'", '"', "`"):
                        in_string = char
                        i += 1
                        continue

                # Handle brackets
                if char in "({[":
                    stack.append((char, line_idx))
                elif char in ")}]" :
                    if not stack:
                        errors.append(f"Line {line_idx}: Unmatched closing bracket '{char}'")
                    else:
                        top, top_line = stack.pop()
                        if brackets[char] != top:
                            errors.append(
                                f"Line {line_idx}: Mismatched bracket '{char}', expected closing for '{top}' from line {top_line}"
                            )

                i += 1
            if in_comment == "line":
                in_comment = None

        if in_string:
            errors.append(f"Unclosed string literal ({in_string})")
        if in_comment == "block":
            errors.append("Unclosed block comment")
        if stack:
            top, top_line = stack[-1]
            errors.append(f"Unclosed bracket '{top}' opened at line {top_line}")

        return errors

    def validate_refactor(
        self,
        refactored_code: str,
        original_code: str,
        file_path: str,
        root_dir: Optional[str] = None,
    ) -> ValidationReport:
        """
        Validate that a refactoring is safe and syntactically correct.

        Args:
            refactored_code: The proposed refactored code.
            original_code: The original code (for comparison).
            file_path: Path to the file (for context).

        Returns:
            ValidationReport with errors, risks, and affected dependents.
        """
        syntax_errors: List[str] = []
        import_errors: List[str] = []
        breaking_changes: List[str] = []
        affected_dependents: List[str] = []

        # Check syntax based on file extension
        if file_path.endswith(".py"):
            try:
                ast.parse(refactored_code)
            except SyntaxError as e:
                syntax_errors.append(f"Line {e.lineno}: {e.msg}")
        elif file_path.endswith((".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")):
            syntax_errors.extend(self._check_js_ts_syntax(refactored_code))

        # Parse for imports and structure
        try:
            target_root = root_dir or settings.root_dir
            original_parsed = parse_code_string(original_code, file_path, root_dir=target_root)
            refactored_parsed = parse_code_string(refactored_code, file_path, root_dir=target_root)
        except Exception as e:
            syntax_errors.append(f"Parse error: {str(e)}")
            return ValidationReport(
                is_valid=False,
                syntax_errors=syntax_errors,
                import_errors=import_errors,
                breaking_changes=breaking_changes,
                affected_dependents=affected_dependents,
                complexity_delta=0,
            )

        # Check for removed public functions/classes (breaking changes)
        original_functions = {f["name"] for f in original_parsed.get("functions", [])}
        original_classes = {c["name"] for c in original_parsed.get("classes", [])}
        refactored_functions = {
            f["name"] for f in refactored_parsed.get("functions", [])
        }
        refactored_classes = {c["name"] for c in refactored_parsed.get("classes", [])}

        removed_functions = original_functions - refactored_functions
        removed_classes = original_classes - refactored_classes

        if removed_functions:
            breaking_changes.append(f"Removed functions: {', '.join(sorted(removed_functions))}")
        if removed_classes:
            breaking_changes.append(f"Removed classes: {', '.join(sorted(removed_classes))}")

        # Check for import changes
        original_imports = {
            imp.get("name") or imp.get("module") for imp in original_parsed.get("imports", [])
        }
        refactored_imports = {
            imp.get("name") or imp.get("module") for imp in refactored_parsed.get("imports", [])
        }

        removed_imports = (original_imports - refactored_imports) - {None}
        if removed_imports:
            import_errors.append(f"Removed imports: {', '.join(sorted(removed_imports))}")

        # Estimate affected dependents from graph
        try:
            suffix = Path(file_path).suffix
            node_name = (file_path[:-len(suffix)] if suffix else file_path).replace("/", ".").replace("\\", ".")
            dependents = self.graph_builder.get_dependents(node_name)
            affected_dependents = list(dependents) if dependents else []
        except Exception:
            affected_dependents = []

        # Compute complexity delta
        complexity_delta = self._estimate_complexity_change(original_code, refactored_code)

        is_valid = len(syntax_errors) == 0 and len(import_errors) == 0

        return ValidationReport(
            is_valid=is_valid,
            syntax_errors=syntax_errors,
            import_errors=import_errors,
            breaking_changes=breaking_changes,
            affected_dependents=affected_dependents,
            complexity_delta=complexity_delta,
        )

    def apply_refactor(
        self,
        file_path: str,
        new_code: str,
        create_backup: bool = True,
        root_dir: Optional[str] = None,
    ) -> RefactorResult:
        """
        Apply a refactoring by writing new code to the file, optionally creating a backup.

        Args:
            file_path: Path to the file to refactor.
            new_code: The new code to write.
            create_backup: If true, create a timestamped backup before writing.
            root_dir: Optional project root directory.

        Returns:
            RefactorResult with success status, backup path, and change summary.
        """
        target_root = root_dir or settings.root_dir

        try:
            # Read original to compute changes
            original_code = self.codebase_manager.read_file(target_root, file_path)
            lines_changed = self._estimate_lines_changed(original_code, new_code)

            backup_path = None
            if create_backup:
                backup_path = self._create_backup(file_path, original_code, root_dir=target_root)

            # Write new code
            self.codebase_manager.write_file(target_root, file_path, new_code)

            summary = self._summarize_changes(original_code, new_code)

            return RefactorResult(
                success=True,
                file_path=file_path,
                lines_changed=lines_changed,
                backup_path=backup_path,
                summary=summary,
                timestamp=datetime.utcnow().isoformat(),
            )

        except Exception as e:
            return RefactorResult(
                success=False,
                file_path=file_path,
                lines_changed=0,
                backup_path=None,
                summary=f"Error: {str(e)}",
                timestamp=datetime.utcnow().isoformat(),
            )

    def batch_refactor(
        self,
        refactorings: List[Dict[str, Any]],
        root_dir: Optional[str] = None,
    ) -> List[RefactorResult]:
        """
        Apply multiple refactorings in batch; all-or-nothing semantics.

        Each refactoring dict should have: file_path, new_code, goal (optional).
        If any fails validation, all are rolled back.

        Args:
            refactorings: List of refactoring dicts.
            root_dir: Optional project root directory.

        Returns:
            List of RefactorResult objects.
        """
        target_root = root_dir or settings.root_dir
        backups: Dict[str, str] = {}
        results: List[RefactorResult] = []

        # Phase 1: Validate all
        for refactor in refactorings:
            file_path = refactor["file_path"]
            new_code = refactor["new_code"]
            item_root = refactor.get("root_dir") or target_root

            validation = self.validate_refactor(
                new_code,
                self.codebase_manager.read_file(item_root, file_path),
                file_path,
                root_dir=item_root,
            )

            if not validation.is_valid:
                # Rollback all and return failures
                self._rollback_batch(backups, root_dir=target_root)
                return [
                    RefactorResult(
                        success=False,
                        file_path=r["file_path"],
                        lines_changed=0,
                        backup_path=None,
                        summary=f"Validation failed: {validation.syntax_errors}",
                        timestamp=datetime.utcnow().isoformat(),
                    )
                    for r in refactorings
                ]

        # Phase 2: Apply all with backups
        for refactor in refactorings:
            file_path = refactor["file_path"]
            new_code = refactor["new_code"]
            item_root = refactor.get("root_dir") or target_root

            original = self.codebase_manager.read_file(item_root, file_path)
            backup_path = self._create_backup(file_path, original, root_dir=item_root)
            backups[file_path] = backup_path

            result = self.apply_refactor(file_path, new_code, create_backup=False, root_dir=item_root)
            results.append(result)

        return results

    def get_change_summary(self, old_code: str, new_code: str) -> Dict[str, Any]:
        """
        Summarize the changes between old and new code.

        Args:
            old_code: Original code.
            new_code: Refactored code.

        Returns:
            Dict with lines_added, lines_removed, percent_change, complexity_delta.
        """
        old_lines = set(old_code.splitlines())
        new_lines = set(new_code.splitlines())

        lines_added = len(new_lines - old_lines)
        lines_removed = len(old_lines - new_lines)
        total_lines = max(len(old_lines), len(new_lines))

        percent_change = (
            ((lines_added - lines_removed) / total_lines * 100)
            if total_lines > 0
            else 0
        )

        complexity_delta = self._estimate_complexity_change(old_code, new_code)

        return {
            "lines_added": lines_added,
            "lines_removed": lines_removed,
            "percent_change": round(percent_change, 2),
            "complexity_delta": complexity_delta,
        }

    def estimate_impact(
        self,
        file_path: str,
        changes: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Estimate the impact of changes on the codebase.

        Args:
            file_path: Path to the file being changed.
            changes: Dict describing the changes (e.g., removed functions).

        Returns:
            Dict with affected_modules, affected_functions, risk_level.
        """
        try:
            suffix = Path(file_path).suffix
            node_name = (file_path[:-len(suffix)] if suffix else file_path).replace("/", ".").replace("\\", ".")
            dependents = self.graph_builder.get_dependents(node_name)

            # Determine risk level
            risk_level = "low"
            if len(dependents) > 5:
                risk_level = "medium"
            if len(dependents) > 20:
                risk_level = "high"

            removed = changes.get("removed_functions", [])
            removed_classes = changes.get("removed_classes", [])
            if removed or removed_classes:
                risk_level = "critical"

            return {
                "file_path": file_path,
                "affected_modules": list(dependents) if dependents else [],
                "num_affected": len(dependents) if dependents else 0,
                "removed_functions": removed,
                "removed_classes": removed_classes,
                "risk_level": risk_level,
            }

        except Exception as e:
            return {
                "file_path": file_path,
                "affected_modules": [],
                "num_affected": 0,
                "removed_functions": [],
                "removed_classes": [],
                "risk_level": "unknown",
                "error": str(e),
            }

    # === Private helper methods ===

    def _estimate_lines_changed(self, old_code: str, new_code: str) -> int:
        """Estimate the number of lines changed between two code snippets."""
        old_lines = old_code.splitlines()
        new_lines = new_code.splitlines()

        matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
        matching_blocks = matcher.get_matching_blocks()

        matched_lines = sum(block.size for block in matching_blocks)
        total_lines = max(len(old_lines), len(new_lines))

        return total_lines - matched_lines

    def _estimate_complexity_change(self, old_code: str, new_code: str) -> int:
        """
        Estimate complexity change as a percentage.

        Supports Python via AST, and JS/TS via control flow keyword counting.
        """

        def count_complexity(code: str) -> int:
            try:
                tree = ast.parse(code)
                count = 0
                for node in ast.walk(tree):
                    if isinstance(
                        node,
                        (
                            ast.If,
                            ast.For,
                            ast.While,
                            ast.With,
                            ast.Try,
                            ast.ExceptHandler,
                        ),
                    ):
                        count += 1
                return count
            except SyntaxError:
                keywords = ["if", "for", "while", "catch", "switch", "case", "&&", "||", "?"]
                count = 0
                for kw in keywords:
                    if kw in ("&&", "||", "?"):
                        count += code.count(kw)
                    else:
                        count += len(re.findall(rf"\b{kw}\b", code))
                return count

        old_complexity = count_complexity(old_code)
        new_complexity = count_complexity(new_code)

        if old_complexity == 0:
            return 0

        delta = (new_complexity - old_complexity) / old_complexity * 100
        return int(delta)

    def _create_backup(self, file_path: str, code: str, root_dir: Optional[str] = None) -> str:
        """Create a timestamped backup of the file."""
        target_root = root_dir or settings.root_dir
        path = Path(file_path)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        ext = path.suffix or ".py"
        backup_name = f"{path.stem}_backup_{timestamp}{ext}"
        backup_path = str(path.parent / backup_name)

        self.codebase_manager.write_file(target_root, backup_path, code)
        return backup_path

    def _rollback_batch(self, backups: Dict[str, str], root_dir: Optional[str] = None) -> None:
        """Rollback all backups after a batch refactoring failure."""
        target_root = root_dir or settings.root_dir
        for original_path, backup_path in backups.items():
            try:
                backup_code = self.codebase_manager.read_file(target_root, backup_path)
                self.codebase_manager.write_file(target_root, original_path, backup_code)
                self.codebase_manager.delete_file(target_root, backup_path)
            except Exception:
                pass

    def _summarize_changes(self, old_code: str, new_code: str) -> str:
        """Create a human-readable summary of changes."""
        old_lines = old_code.splitlines()
        new_lines = new_code.splitlines()

        matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
        matching_blocks = matcher.get_matching_blocks()

        matched_lines = sum(block.size for block in matching_blocks)
        added = len(new_lines) - matched_lines
        removed = len(old_lines) - matched_lines

        parts = []
        if added > 0:
            parts.append(f"{added} lines added")
        if removed > 0:
            parts.append(f"{removed} lines removed")
        if not parts:
            parts.append("No changes")

        return ", ".join(parts)

"""Generic diff helpers for code review and refactor workflows."""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class DiffSummary:
	lines_added: int
	lines_removed: int
	percent_change: float


def unified_diff_text(original: str, updated: str, fromfile: str = "original", tofile: str = "updated") -> str:
	"""Return a unified diff string."""
	diff = difflib.unified_diff(
		original.splitlines(keepends=True),
		updated.splitlines(keepends=True),
		fromfile=fromfile,
		tofile=tofile,
		lineterm="",
	)
	return "\n".join(diff)


def diff_summary(original: str, updated: str) -> DiffSummary:
	"""Compute a simple add/remove summary."""
	original_lines = original.splitlines()
	updated_lines = updated.splitlines()
	matcher = difflib.SequenceMatcher(None, original_lines, updated_lines)
	matched = sum(block.size for block in matcher.get_matching_blocks())
	lines_added = len(updated_lines) - matched
	lines_removed = len(original_lines) - matched
	base = max(len(original_lines), len(updated_lines), 1)
	percent_change = ((lines_added - lines_removed) / base) * 100.0
	return DiffSummary(lines_added=lines_added, lines_removed=lines_removed, percent_change=percent_change)


def line_changes(original: str, updated: str) -> Dict[str, List[str]]:
	"""Return the exact added and removed lines."""
	original_lines = set(original.splitlines())
	updated_lines = set(updated.splitlines())
	return {
		"added": sorted(updated_lines - original_lines),
		"removed": sorted(original_lines - updated_lines),
	}


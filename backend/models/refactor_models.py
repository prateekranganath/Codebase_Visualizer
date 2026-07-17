"""Request and response models for refactor routes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RefactorProposalRequest(BaseModel):
	file_path: str
	goal: str
	top_k: int = Field(5, ge=1, le=50)


class RefactorValidateRequest(BaseModel):
	file_path: str
	original_code: str
	refactored_code: str


class RefactorApplyRequest(BaseModel):
	file_path: str
	new_code: str
	create_backup: bool = True


class BatchRefactorItem(BaseModel):
	file_path: str
	new_code: str
	goal: Optional[str] = None


class BatchRefactorRequest(BaseModel):
	refactorings: List[BatchRefactorItem]


class RefactorImpactRequest(BaseModel):
	file_path: str
	changes: Dict[str, Any]


class RefactorProposalResponse(BaseModel):
	file_path: str
	goal: str
	original_code: str
	suggested_code: str
	diff: str
	reasoning: str
	risks: List[str]
	estimated_lines_changed: int
	estimated_complexity_change: int


class RefactorValidationResponse(BaseModel):
	is_valid: bool
	syntax_errors: List[str]
	import_errors: List[str]
	breaking_changes: List[str]
	affected_dependents: List[str]
	complexity_delta: int


class RefactorApplyResponse(BaseModel):
	success: bool
	file_path: str
	lines_changed: int
	backup_path: Optional[str]
	summary: str
	timestamp: str


class ImpactResponse(BaseModel):
	file_path: str
	affected_modules: List[str]
	num_affected: int
	removed_functions: List[str]
	removed_classes: List[str]
	risk_level: str
	error: Optional[str] = None

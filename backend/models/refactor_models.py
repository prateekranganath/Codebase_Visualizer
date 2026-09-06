"""Request and response models for refactor routes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RefactorProposalRequest(BaseModel):
	file_path: str
	goal: str
	root_dir: Optional[str] = None
	top_k: int = Field(5, ge=1, le=50)
	force_refresh: bool = Field(False, description="Bypass the server-side result cache and regenerate")


class RefactorValidateRequest(BaseModel):
	file_path: str
	original_code: str
	refactored_code: str
	root_dir: Optional[str] = None


class RefactorApplyRequest(BaseModel):
	file_path: str
	new_code: str
	create_backup: bool = True
	root_dir: Optional[str] = None


class BatchRefactorItem(BaseModel):
	file_path: str
	new_code: str
	goal: Optional[str] = None
	root_dir: Optional[str] = None


class BatchRefactorRequest(BaseModel):
	refactorings: List[BatchRefactorItem]
	root_dir: Optional[str] = None


class RefactorImpactRequest(BaseModel):
	file_path: str
	changes: Dict[str, Any]
	root_dir: Optional[str] = None


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
	# Extra fields consumed by the frontend
	estimated_estimate: Optional[str] = None  # kept for legacy compat
	estimate: Optional[str] = None
	metadata: Optional[Dict[str, Any]] = None
	cached: bool = False


class RefactorValidationResponse(BaseModel):
	is_valid: bool
	syntax_errors: List[str]
	import_errors: List[str]
	breaking_changes: List[str]
	affected_dependents: List[str]
	complexity_delta: int
	# Aliased fields for frontend compatibility
	valid: Optional[bool] = None
	syntax_ok: Optional[bool] = None
	imports_ok: Optional[bool] = None
	details: Optional[Dict[str, Any]] = None


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

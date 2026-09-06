"""Refactor suggestion and application routes."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from backend.deps import get_refactor_engine
from backend.services.ai_engine import RateLimitError
from backend.models.refactor_models import (
	BatchRefactorRequest,
	ImpactResponse,
	RefactorApplyRequest,
	RefactorApplyResponse,
	RefactorImpactRequest,
	RefactorProposalRequest,
	RefactorProposalResponse,
	RefactorValidateRequest,
	RefactorValidationResponse,
)

router = APIRouter(prefix="/refactor", tags=["refactor"])


@router.post("/propose", response_model=RefactorProposalResponse)
def propose(payload: RefactorProposalRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		proposal = refactor_engine.propose_refactor(
			payload.file_path,
			payload.goal,
			top_k=payload.top_k,
			root_dir=payload.root_dir,
			force_refresh=payload.force_refresh,
		)
		# Build human-readable estimate summary for the frontend
		estimate_str = (
			f"~{proposal.estimated_lines_changed} lines changed"
			f", complexity delta: {proposal.estimated_complexity_change:+d}%"
		)
		metadata = {
			"estimated_lines_changed": proposal.estimated_lines_changed,
			"estimated_complexity_change": proposal.estimated_complexity_change,
		}
		return RefactorProposalResponse(
			**proposal.__dict__,
			estimate=estimate_str,
			metadata=metadata,
		)
	except RateLimitError as exc:
		raise HTTPException(status_code=429, detail={"error": "rate_limited", "retry_after_seconds": exc.retry_after_seconds}) from exc
	except httpx.HTTPStatusError as exc:
		status = exc.response.status_code if exc.response is not None else 502
		raise HTTPException(status_code=status, detail=str(exc)) from exc
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/validate", response_model=RefactorValidationResponse)
def validate(payload: RefactorValidateRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		validation = refactor_engine.validate_refactor(
			payload.refactored_code,
			payload.original_code,
			payload.file_path,
			root_dir=payload.root_dir,
		)
		# Populate frontend-expected alias fields
		return RefactorValidationResponse(
			**validation.__dict__,
			valid=validation.is_valid,
			syntax_ok=len(validation.syntax_errors) == 0,
			imports_ok=len(validation.import_errors) == 0,
			details={
				"syntax_errors": validation.syntax_errors,
				"import_errors": validation.import_errors,
				"breaking_changes": validation.breaking_changes,
				"affected_dependents": validation.affected_dependents,
				"complexity_delta": validation.complexity_delta,
			},
		)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/apply", response_model=RefactorApplyResponse)
def apply_refactor(payload: RefactorApplyRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		result = refactor_engine.apply_refactor(
			payload.file_path,
			payload.new_code,
			create_backup=payload.create_backup,
			root_dir=payload.root_dir,
		)
		return RefactorApplyResponse(**result.__dict__)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/batch")
def batch_refactor(payload: BatchRefactorRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		return [
			result.__dict__
			for result in refactor_engine.batch_refactor(
				[item.model_dump() for item in payload.refactorings],
				root_dir=payload.root_dir,
			)
		]
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/impact", response_model=ImpactResponse)
def impact(payload: RefactorImpactRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		impact_result = refactor_engine.estimate_impact(payload.file_path, payload.changes)
		return ImpactResponse(**impact_result)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc

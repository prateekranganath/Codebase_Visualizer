"""Refactor suggestion and application routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import get_refactor_engine
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
		)
		return RefactorProposalResponse(**proposal.__dict__)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/validate", response_model=RefactorValidationResponse)
def validate(payload: RefactorValidateRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		validation = refactor_engine.validate_refactor(
			payload.refactored_code,
			payload.original_code,
			payload.file_path,
		)
		return RefactorValidationResponse(**validation.__dict__)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/apply", response_model=RefactorApplyResponse)
def apply_refactor(payload: RefactorApplyRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		result = refactor_engine.apply_refactor(
			payload.file_path,
			payload.new_code,
			create_backup=payload.create_backup,
		)
		return RefactorApplyResponse(**result.__dict__)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/batch")
def batch_refactor(payload: BatchRefactorRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		return [result.__dict__ for result in refactor_engine.batch_refactor([item.model_dump() for item in payload.refactorings])]
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/impact", response_model=ImpactResponse)
def impact(payload: RefactorImpactRequest, refactor_engine=Depends(get_refactor_engine)):
	try:
		impact_result = refactor_engine.estimate_impact(payload.file_path, payload.changes)
		return ImpactResponse(**impact_result)
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc

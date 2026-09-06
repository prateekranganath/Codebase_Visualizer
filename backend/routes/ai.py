"""AI and teaching routes."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException

from backend.deps import get_ai_engine, get_teaching_engine
from backend.services.ai_engine import RateLimitError
from backend.models.ai_models import (
	ExplainRequest,
	ExplainResponseModel,
	LLMResponseModel,
	QueryRequest,
	TeachEvaluateRequest,
	TeachEvaluateResponseModel,
	TeachingRequest,
	TeachResponseModel,
)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/query", response_model=LLMResponseModel)
def query_codebase(payload: QueryRequest, ai_engine=Depends(get_ai_engine)):
	try:
		result = ai_engine.answer_query(
			payload.query,
			top_k=payload.top_k,
			mode=payload.mode,
			max_tokens=payload.max_tokens,
			temperature=payload.temperature,
			root_dir=payload.root_dir,
		)
		return LLMResponseModel(**result)
	except RateLimitError as exc:
		raise HTTPException(status_code=429, detail={"error": "rate_limited", "retry_after_seconds": exc.retry_after_seconds}) from exc
	except httpx.HTTPStatusError as exc:
		status = exc.response.status_code if exc.response is not None else 502
		raise HTTPException(status_code=status, detail=str(exc)) from exc
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/explain", response_model=ExplainResponseModel)
def explain_file(payload: ExplainRequest, ai_engine=Depends(get_ai_engine)):
	try:
		result = ai_engine.explain_code_structured(
			payload.file_path,
			root_dir=payload.root_dir,
			top_k=payload.top_k,
			max_tokens=payload.max_tokens,
			temperature=payload.temperature,
			force_refresh=payload.force_refresh,
		)
		return ExplainResponseModel(**result)
	except RateLimitError as exc:
		raise HTTPException(status_code=429, detail={"error": "rate_limited", "retry_after_seconds": exc.retry_after_seconds}) from exc
	except httpx.HTTPStatusError as exc:
		status = exc.response.status_code if exc.response is not None else 502
		raise HTTPException(status_code=status, detail=str(exc)) from exc
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/teach/evaluate", response_model=TeachEvaluateResponseModel)
def teach_evaluate(payload: TeachEvaluateRequest, teaching_engine=Depends(get_teaching_engine)):
	try:
		result = teaching_engine.evaluate_answer(
			user_id=payload.user_id,
			question=payload.question,
			user_answer=payload.user_answer,
			session_id=payload.session_id,
			concept_focus=payload.concept_focus,
			difficulty=payload.difficulty,
			root_dir=payload.root_dir,
			file_path=payload.file_path,
			node_id=payload.node_id,
			max_tokens=payload.max_tokens,
		)
		return TeachEvaluateResponseModel(**result)
	except RateLimitError as exc:
		raise HTTPException(status_code=429, detail={"error": "rate_limited", "retry_after_seconds": exc.retry_after_seconds}) from exc
	except httpx.HTTPStatusError as exc:
		status = exc.response.status_code if exc.response is not None else 502
		raise HTTPException(status_code=status, detail=str(exc)) from exc
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/teach", response_model=TeachResponseModel)
def teach(payload: TeachingRequest, teaching_engine=Depends(get_teaching_engine)):
	try:
		result = teaching_engine.teaching_response(
			payload.user_id,
			payload.query,
			root_dir=payload.root_dir,
			file_path=payload.file_path,
			node_id=payload.node_id,
			top_k=payload.top_k,
			escalate_on_repeat=payload.escalate_on_repeat,
			max_tokens=payload.max_tokens,
		)
		return TeachResponseModel(**result)
	except RateLimitError as exc:
		raise HTTPException(status_code=429, detail={"error": "rate_limited", "retry_after_seconds": exc.retry_after_seconds}) from exc
	except httpx.HTTPStatusError as exc:
		status = exc.response.status_code if exc.response is not None else 502
		raise HTTPException(status_code=status, detail=str(exc)) from exc
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/provider")
def provider_info(ai_engine=Depends(get_ai_engine)):
	return ai_engine.get_provider_info()

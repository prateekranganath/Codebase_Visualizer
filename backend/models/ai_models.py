"""Request and response models for AI routes."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
	query: str = Field(..., description="User question or request")
	root_dir: Optional[str] = Field(
		None,
		description="Optional workspace root to scope retrieval to that workspace's own embeddings/graph",
	)
	top_k: int = Field(5, ge=1, le=50)
	mode: str = Field("answer", description="answer, teach, explain, or refactor")
	max_tokens: int = Field(512, ge=1, le=4096)
	temperature: Optional[float] = Field(None, ge=0.0, le=2.0)


class ExplainRequest(BaseModel):
	root_dir: Optional[str] = Field(
		None,
		description="Optional workspace root for resolving file_path within an uploaded workspace",
	)
	file_path: str
	top_k: int = Field(5, ge=1, le=50)
	max_tokens: int = Field(1536, ge=1, le=4096)
	temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
	force_refresh: bool = Field(False, description="Bypass the server-side result cache and regenerate")


class TeachingRequest(BaseModel):
	user_id: str
	query: str
	root_dir: Optional[str] = Field(
		None,
		description="Optional workspace root so the question is grounded in the selected file's real context",
	)
	file_path: Optional[str] = Field(None, description="Optional file (workspace-relative) the question should focus on")
	node_id: Optional[str] = Field(None, description="Optional graph node id the question should focus on")
	top_k: int = Field(5, ge=1, le=50)
	escalate_on_repeat: bool = True
	max_tokens: int = Field(512, ge=1, le=4096)


class LLMResponseModel(BaseModel):
	text: str
	mode: str
	provider: str
	model: str
	context: Dict[str, Any]


class ExplainKeyComponent(BaseModel):
	name: str
	role: str


class ExplainResponseModel(BaseModel):
	# Backward-compatible fields for clients expecting LLMResponseModel.
	text: Optional[str] = None
	mode: Literal["explain"] = "explain"
	provider: Optional[str] = None
	model: Optional[str] = None
	context: Optional[Dict[str, Any]] = None

	summary: str
	responsibilities: List[str]
	key_components: List[ExplainKeyComponent]
	dependencies: List[str]
	risks: List[str]
	insights: List[str]
	cached: bool = False


class TeachEvaluateRequest(BaseModel):
	user_id: str
	session_id: Optional[str] = Field(
		None,
		description="session_id returned by /ai/teach; recovers concept_focus/difficulty/root_dir/file_path so the client doesn't need to resend them",
	)
	question: str
	user_answer: str
	concept_focus: Optional[str] = None
	difficulty: Optional[Literal["beginner", "intermediate", "advanced"]] = None
	root_dir: Optional[str] = None
	file_path: Optional[str] = None
	node_id: Optional[str] = None
	max_tokens: int = Field(512, ge=1, le=2048)


class TeachEvaluateResponseModel(BaseModel):
	is_correct: bool
	score: float = Field(..., ge=0.0, le=1.0)
	feedback: str
	ideal_answer: str
	concept_focus: str
	difficulty: Literal["beginner", "intermediate", "advanced"]


class TeachResponseModel(BaseModel):
	session_id: str = Field(..., description="Echo this back in /ai/teach/evaluate to recover session context")
	question: str
	hint: str
	concept_focus: str
	difficulty: Literal["beginner", "intermediate", "advanced"]


class TeachingResponseModel(BaseModel):
	user_id: str
	query: str
	proficiency_level: str
	topic: str
	guidance_level: str
	attempt_count: int
	timestamp: str
	context: Dict[str, Any]

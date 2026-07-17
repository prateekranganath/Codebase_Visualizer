"""Request and response models for project/codebase routes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ProjectPathRequest(BaseModel):
	root_dir: str = Field(..., description="Absolute path to the project root")
	relative_path: str = Field("", description="Path relative to the project root")


class ProjectFileWriteRequest(ProjectPathRequest):
	content: str = Field(..., description="File contents to write")


class ProjectFileResponse(BaseModel):
	path: str
	content: str


class ProjectListResponse(BaseModel):
	root_dir: str
	relative_path: str
	files: List[str]


class ProjectMetadataResponse(BaseModel):
	root_dir: str
	relative_path: str
	metadata: Dict[str, Any]


class ParseResponse(BaseModel):
	root_dir: str
	relative_path: str
	parsed: Dict[str, Any]
	framework: Optional[str] = None


class UpdateResponse(BaseModel):
	file_path: str
	root_dir: str
	parse_success: bool
	chunks_updated: int
	chunks_added: int
	chunks_removed: int
	embeddings_updated: bool
	graph_updated: bool
	warnings: List[str] = []
	errors: List[str] = []
	timestamp: Optional[str] = None
	framework: Optional[str] = None


class WorkspaceRebuildResult(BaseModel):
	parse_success: bool
	parsed_files: int
	indexed_files: int
	chunks_indexed: int
	embeddings_updated: bool
	graph_updated: bool
	warnings: List[str] = []
	errors: List[str] = []
	timestamp: Optional[str] = None
	framework: Optional[str] = None


class WorkspaceUploadResponse(BaseModel):
	workspace_id: str
	root_path: str
	graph_rebuilt: bool
	parse_result: WorkspaceRebuildResult
	sync_result: WorkspaceRebuildResult

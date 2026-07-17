"""Project and codebase management routes."""

from __future__ import annotations

import json
import os
import shutil
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from backend.models.project_models import (
	ParseResponse,
	ProjectFileResponse,
	ProjectFileWriteRequest,
	ProjectListResponse,
	ProjectMetadataResponse,
	ProjectPathRequest,
	UpdateResponse,
	WorkspaceRebuildResult,
	WorkspaceUploadResponse,
)
from backend.services import codebase_manager as codebase_service
from backend.services.parser import parse_codebase, parse_python_module
from backend.deps import get_embedding_engine, get_graph_builder, get_update_engine
from backend.config.settings import get_settings
from backend.db.graph_store import GraphStoreRepository
from backend.services.update_engine import UpdateEngine

router = APIRouter(prefix="/project", tags=["project"])


_PRUNE_DIRS = {
	".venv",
	"venv",
	"env",
	"__pycache__",
	"node_modules",
	".git",
	"uploaded_workspaces",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	"dist",
	"build",
}


_SKIP_FILE_SUFFIXES = {
	".pyc",
	".pyo",
	".pyd",
	".so",
	".dll",
}


def _should_skip_extracted_path(relative_path: Path) -> bool:
	"""Return True if a zip member path should be ignored during extraction.

	We skip dependency/cache artifacts early to avoid huge extractions and
	Windows path-length issues (common when zips include virtualenvs).
	"""
	parts_lower = {part.lower() for part in relative_path.parts}
	if parts_lower & {name.lower() for name in _PRUNE_DIRS}:
		return True
	if "__macosx" in parts_lower:
		return True
	# Never persist secrets from uploaded repos.
	if relative_path.name.lower() == ".env":
		return True
	if relative_path.suffix.lower() in _SKIP_FILE_SUFFIXES:
		return True
	return False


def _detect_repo_root(workspace_root: Path) -> Path:
	"""Return the likely extracted repo root inside a workspace container.

	If the workspace container contains exactly one top-level directory (besides
	known metadata/archives), we treat that directory as the repo root.
	"""
	ignored_names = {
		"workspace_manifest.json",
		"graph_store",
	}

	candidates: List[Path] = []
	for entry in workspace_root.iterdir():
		name = entry.name
		if name in ignored_names:
			continue
		if entry.is_file() and name.lower().endswith(".zip"):
			continue
		if entry.is_dir() and name == "__MACOSX":
			continue
		# Skip hidden filesystem noise, but don't exclude real repo roots.
		if entry.is_file() and name.startswith(".") and name != ".env":
			continue
		if entry.is_dir():
			candidates.append(entry)

	if len(candidates) == 1:
		return candidates[0]
	return workspace_root


def _prune_uploaded_repo(repo_root: Path) -> None:
	"""Remove dependency/cache artifacts from an uploaded repo.

	These directories are often huge and not useful for analysis.
	"""
	for name in _PRUNE_DIRS:
		path = repo_root / name
		if path.exists() and path.is_dir():
			shutil.rmtree(path, ignore_errors=True)

	# Remove .env files from uploaded repos to avoid persisting secrets.
	env_file = repo_root / ".env"
	if env_file.exists() and env_file.is_file():
		try:
			env_file.unlink()
		except Exception:
			pass


def _workspace_upload_root() -> Path:
	settings = get_settings()
	# Store uploads outside the repo by default so dev reload watchers don't
	# get spammed by extracted workspaces.
	configured = os.getenv("APP_UPLOADS_DIR") or os.getenv("UPLOADS_DIR")
	if configured:
		base_dir = Path(configured)
	else:
		local_app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
		if local_app_data:
			base_dir = Path(local_app_data) / "codebase_visualizer" / "uploaded_workspaces"
		else:
			base_dir = Path(settings.root_dir) / "uploaded_workspaces"
	base_dir.mkdir(parents=True, exist_ok=True)
	return base_dir


def _normalize_relative_path(root_dir: str, relative_path: str) -> str:
	"""Make the API tolerant of callers sending duplicate prefixes.

	Example: root_dir='backend' and relative_path='backend/main.py' should resolve
	to relative_path='main.py'.
	"""
	rel = (relative_path or "").replace("\\", "/").lstrip("/")
	if rel.startswith("./"):
		rel = rel[2:]

	root_name = Path(root_dir).name
	if root_name:
		prefix = root_name.replace("\\", "/")
		if rel == prefix:
			return ""
		if rel.startswith(prefix + "/"):
			return rel[len(prefix) + 1 :]
	return rel


def _safe_uploaded_relative_path(filename: str) -> Path:
	path = PurePosixPath(filename.replace("\\", "/"))
	if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
		raise ValueError(f"Unsafe upload path: {filename}")
	return Path(*path.parts)


def _save_uploaded_file(destination_root: Path, upload_file: UploadFile) -> Optional[Path]:
	if not upload_file.filename:
		return None

	relative_path = _safe_uploaded_relative_path(upload_file.filename)
	target_path = destination_root / relative_path
	target_path.parent.mkdir(parents=True, exist_ok=True)
	with target_path.open("wb") as output_file:
		shutil.copyfileobj(upload_file.file, output_file)
	return target_path


def _extract_zip_archive(destination_root: Path, archive_file: UploadFile) -> List[Path]:
	if not archive_file.filename:
		raise ValueError("Archive filename is required")

	archive_path = destination_root / _safe_uploaded_relative_path(archive_file.filename)
	archive_path.parent.mkdir(parents=True, exist_ok=True)
	with archive_path.open("wb") as output_file:
		shutil.copyfileobj(archive_file.file, output_file)

	extracted_files: List[Path] = []
	with zipfile.ZipFile(archive_path) as archive:
		for member in archive.infolist():
			if member.is_dir():
				continue

			try:
				relative_path = _safe_uploaded_relative_path(member.filename)
			except ValueError:
				# Skip unsafe archive members.
				continue

			if _should_skip_extracted_path(relative_path):
				continue

			target_path = destination_root / relative_path
			try:
				target_path.parent.mkdir(parents=True, exist_ok=True)
				with archive.open(member) as source_file, target_path.open("wb") as output_file:
					shutil.copyfileobj(source_file, output_file)
			except OSError:
				# Common on Windows for deeply nested venv/vendor paths.
				# Treat as a non-fatal extraction skip.
				continue
			extracted_files.append(target_path)

	# The zip is only an ingestion artifact; delete it to keep workspace dirs clean.
	try:
		archive_path.unlink(missing_ok=True)
	except Exception:
		pass

	return extracted_files


@router.get("/files", response_model=ProjectListResponse)
def list_project_files(payload: ProjectPathRequest = Depends()):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		files = codebase_service.list_files(payload.root_dir, relative_path)
		return ProjectListResponse(
			root_dir=payload.root_dir,
			relative_path=relative_path,
			files=files,
		)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/file", response_model=ProjectFileResponse)
def read_project_file(payload: ProjectPathRequest = Depends()):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		content = codebase_service.read_file(payload.root_dir, relative_path)
		return ProjectFileResponse(path=relative_path, content=content)
	except ValueError as exc:
		raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/file", response_model=ProjectMetadataResponse)
def write_project_file(payload: ProjectFileWriteRequest):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		codebase_service.write_file(payload.root_dir, relative_path, payload.content)
		metadata = codebase_service.get_file_metadata(payload.root_dir, relative_path)
		return ProjectMetadataResponse(
			root_dir=payload.root_dir,
			relative_path=relative_path,
			metadata=metadata,
		)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/metadata", response_model=ProjectMetadataResponse)
def file_metadata(payload: ProjectPathRequest = Depends()):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		metadata = codebase_service.get_file_metadata(payload.root_dir, relative_path)
		return ProjectMetadataResponse(
			root_dir=payload.root_dir,
			relative_path=relative_path,
			metadata=metadata,
		)
	except ValueError as exc:
		raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/parse", response_model=ParseResponse)
def parse_project(payload: ProjectPathRequest = Depends()):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		parsed = parse_python_module(payload.root_dir, relative_path)
		from backend.services.framework_detector import detect_framework
		parsed["framework"] = detect_framework(payload.root_dir)
		return ParseResponse(
			root_dir=payload.root_dir,
			relative_path=relative_path,
			parsed=parsed,
			framework=parsed["framework"],
		)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync", response_model=UpdateResponse)
def sync_project_file(payload: ProjectPathRequest, update_engine: UpdateEngine = Depends(get_update_engine)):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		result = update_engine.sync_file(payload.root_dir, relative_path)
		return UpdateResponse(**result)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/upload", response_model=WorkspaceUploadResponse)
def upload_workspace(
	files: List[UploadFile] = File(default=[]),
	archive: Optional[UploadFile] = File(default=None),
	workspace_name: Optional[str] = Form(default=None),
):
	"""Store an uploaded workspace on the server, rebuild the index, and refresh graph state."""
	if not files and archive is None:
		raise HTTPException(status_code=400, detail="Upload at least one file or a zip archive")

	workspace_id = uuid.uuid4().hex
	workspace_root = _workspace_upload_root() / workspace_id
	workspace_root.mkdir(parents=True, exist_ok=True)

	stored_files: List[str] = []
	try:
		if archive is not None:
			if not archive.filename:
				raise ValueError("Archive filename is required")
			archive_name = archive.filename.lower()
			if not archive_name.endswith(".zip"):
				raise ValueError("Only .zip archives are supported")
			extracted = _extract_zip_archive(workspace_root, archive)
			stored_files.extend(str(path.relative_to(workspace_root)) for path in extracted)

		for upload_file in files:
			saved_path = _save_uploaded_file(workspace_root, upload_file)
			if saved_path is not None:
				stored_files.append(str(saved_path.relative_to(workspace_root)))

		manifest_path = workspace_root / "workspace_manifest.json"
		repo_root = _detect_repo_root(workspace_root) if archive is not None else workspace_root
		_prune_uploaded_repo(repo_root)

		manifest_path.write_text(
			json.dumps(
				{
					"workspace_id": workspace_id,
					"workspace_name": workspace_name,
					"repo_root": str(repo_root.relative_to(workspace_root)).replace("\\", "/")
					if repo_root != workspace_root
					else "",
					"files": stored_files,
				},
				indent=2,
			),
			encoding="utf-8",
		)

		workspace_graph_store = GraphStoreRepository(store_path=str(workspace_root / "graph_store"))
		workspace_update_engine = UpdateEngine(
			embedding_engine=get_embedding_engine(),
			graph_builder=get_graph_builder(),
			graph_store_repo=workspace_graph_store,
		)
		rebuild_result = workspace_update_engine.rebuild_codebase(str(repo_root))

		parse_result = WorkspaceRebuildResult(
			parse_success=rebuild_result["parse_success"],
			parsed_files=rebuild_result["parsed_files"],
			indexed_files=rebuild_result["indexed_files"],
			chunks_indexed=rebuild_result["chunks_indexed"],
			embeddings_updated=rebuild_result["embeddings_updated"],
			graph_updated=rebuild_result["graph_updated"],
			warnings=rebuild_result["warnings"],
			errors=rebuild_result["errors"],
			timestamp=rebuild_result["timestamp"],
			framework=rebuild_result.get("framework"),
		)

		return WorkspaceUploadResponse(
			workspace_id=workspace_id,
			root_path=str(repo_root),
			graph_rebuilt=rebuild_result["graph_updated"],
			parse_result=parse_result,
			sync_result=parse_result,
		)
	except zipfile.BadZipFile as exc:
		raise HTTPException(status_code=400, detail=f"Invalid zip archive: {exc}") from exc
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc
	finally:
		if archive is not None:
			archive.file.close()
		for upload_file in files:
			upload_file.file.close()


@router.post("/parse-codebase")
def parse_entire_codebase(payload: ProjectPathRequest):
	try:
		relative_path = _normalize_relative_path(payload.root_dir, payload.relative_path)
		return parse_codebase(payload.root_dir, relative_path)
	except ValueError as exc:
		raise HTTPException(status_code=400, detail=str(exc)) from exc

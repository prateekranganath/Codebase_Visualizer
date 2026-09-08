"""Graph inspection routes."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from backend.config.settings import get_settings
from backend.db.graph_store import GraphStoreRepository
from backend.services.graph_builder import GRAPH_BUILDER_VERSION, CodeGraphBuilder
from backend.services.graph_normalizer import contains_noise_namespace
from backend.services.parser import parse_codebase
from backend.services.workspace_paths import is_allowed_graph_root, resolve_graph_store_root

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import get_graph_builder

router = APIRouter(prefix="/graph", tags=["graph"])


def _graph_has_noise(graph) -> bool:
	for node_id in graph.nodes:
		if contains_noise_namespace(str(node_id)):
			return True
	return False


@lru_cache(maxsize=128)
def _cached_export_from_root_dir(root_dir: str, *, graph_level: int, graph_mtime_ns: int) -> dict:
	root = resolve_graph_store_root(root_dir)
	repo = GraphStoreRepository(store_path=str(root / "graph_store"))
	graph = repo.load()
	builder = CodeGraphBuilder()
	builder.graph = graph
	builder.graph_level = graph_level
	return builder.export_for_visualization(graph_level=graph_level)


def _needs_rebuild(graph_root: Path, response: dict) -> bool:
	"""True when the persisted graph must be rebuilt before it can be trusted.

	A store written by an older builder is missing edges and node attributes the
	current UI depends on, so version drift is treated the same as pollution.
	"""
	nodes = response.get("nodes") or []
	if not nodes:
		return False
	if any(contains_noise_namespace(str(node.get("id", ""))) for node in nodes):
		return True
	return _stored_builder_version(graph_root) < GRAPH_BUILDER_VERSION


def _stored_builder_version(graph_root: Path) -> int:
	try:
		repo = GraphStoreRepository(store_path=str(graph_root / "graph_store"))
		return int(repo.load().graph.get("builder_version", 0))
	except Exception:
		return 0


def _export_from_root_dir(root_dir: str, *, graph_level: int) -> dict:
	root = Path(root_dir).resolve()
	if not root.exists() or not root.is_dir():
		raise HTTPException(status_code=404, detail="Workspace root not found")
	if not is_allowed_graph_root(root):
		raise HTTPException(status_code=400, detail="root_dir is not an allowed workspace")
	graph_root = resolve_graph_store_root(root_dir)

	graph_path = graph_root / "graph_store" / "graph.json"
	graph_mtime_ns = graph_path.stat().st_mtime_ns if graph_path.exists() else -1
	response = _cached_export_from_root_dir(
		str(graph_root),
		graph_level=graph_level,
		graph_mtime_ns=graph_mtime_ns,
	)
	if _needs_rebuild(graph_root, response):
		# Rebuild from source so stale or polluted graph_store data cannot leak
		# into the UI.
		# Rebuild at the canonical (richest) level, never the requested export
		# level -- this result gets persisted, and saving a level-1 rebuild would
		# permanently discard detail every later export depends on.
		codebase = parse_codebase(str(root))
		builder = CodeGraphBuilder()
		builder.build_from_codebase(codebase, graph_level=get_settings().graph_level)
		repo = GraphStoreRepository(store_path=str(graph_root / "graph_store"))
		repo.save(builder.graph)
		_cached_export_from_root_dir.cache_clear()
		graph_mtime_ns = graph_path.stat().st_mtime_ns if graph_path.exists() else -1
		response = _cached_export_from_root_dir(
			str(graph_root),
			graph_level=graph_level,
			graph_mtime_ns=graph_mtime_ns,
		)
	return response


@router.get("/export")
def export_graph(
	graph_level: int = Query(2, ge=1, le=3),
	root_dir: Optional[str] = Query(None, description="Optional workspace root to export persisted graph from"),
	graph_builder=Depends(get_graph_builder),
):
	response = None
	if root_dir:
		response = _export_from_root_dir(root_dir, graph_level=graph_level)
	else:
		response = graph_builder.export_for_visualization(graph_level=graph_level)
	return response


@router.get("/node")
def get_node(
	node_name: str,
	root_dir: Optional[str] = Query(None, description="Optional workspace root to read node from"),
	graph_builder=Depends(get_graph_builder),
):
	if root_dir:
		root = Path(root_dir)
		if not root.exists() or not root.is_dir():
			raise HTTPException(status_code=404, detail="Workspace root not found")
		if not is_allowed_graph_root(root):
			raise HTTPException(status_code=400, detail="root_dir is not an allowed workspace")
		repo = GraphStoreRepository(store_path=str(resolve_graph_store_root(root_dir) / "graph_store"))
		graph = repo.load()
		builder = CodeGraphBuilder()
		builder.graph = graph
		node = builder.get_node(node_name)
	else:
		node = graph_builder.get_node(node_name)

	if node is None:
		raise HTTPException(status_code=404, detail="Node not found")
	return {"id": node_name, "data": node}


@router.get("/dependencies")
def get_dependencies(
	node_name: str,
	root_dir: Optional[str] = Query(None, description="Optional workspace root to read dependencies from"),
	graph_builder=Depends(get_graph_builder),
):
	if root_dir:
		root = Path(root_dir)
		if not root.exists() or not root.is_dir():
			raise HTTPException(status_code=404, detail="Workspace root not found")
		if not is_allowed_graph_root(root):
			raise HTTPException(status_code=400, detail="root_dir is not an allowed workspace")
		repo = GraphStoreRepository(store_path=str(resolve_graph_store_root(root_dir) / "graph_store"))
		graph = repo.load()
		builder = CodeGraphBuilder()
		builder.graph = graph
		deps = builder.get_dependencies(node_name)
	else:
		deps = graph_builder.get_dependencies(node_name)
	return {"node": node_name, "dependencies": deps}


@router.get("/dependents")
def get_dependents(
	node_name: str,
	root_dir: Optional[str] = Query(None, description="Optional workspace root to read dependents from"),
	graph_builder=Depends(get_graph_builder),
):
	if root_dir:
		root = Path(root_dir)
		if not root.exists() or not root.is_dir():
			raise HTTPException(status_code=404, detail="Workspace root not found")
		if not is_allowed_graph_root(root):
			raise HTTPException(status_code=400, detail="root_dir is not an allowed workspace")
		repo = GraphStoreRepository(store_path=str(resolve_graph_store_root(root_dir) / "graph_store"))
		graph = repo.load()
		builder = CodeGraphBuilder()
		builder.graph = graph
		deps = builder.get_dependents(node_name)
	else:
		deps = graph_builder.get_dependents(node_name)
	return {"node": node_name, "dependents": deps}


@router.get("/subgraph")
def get_subgraph(
	centers: List[str] = Query(..., description="Center node names"),
	depth: int = Query(2, ge=0, le=8),
	graph_level: int = Query(2, ge=1, le=3),
	root_dir: Optional[str] = Query(None, description="Optional workspace root to export persisted graph from"),
	graph_builder=Depends(get_graph_builder),
):
	if root_dir:
		root = Path(root_dir)
		if not root.exists() or not root.is_dir():
			raise HTTPException(status_code=404, detail="Workspace root not found")
		if not is_allowed_graph_root(root):
			raise HTTPException(status_code=400, detail="root_dir is not an allowed workspace")
		repo = GraphStoreRepository(store_path=str(resolve_graph_store_root(root_dir) / "graph_store"))
		graph = repo.load()
		builder = CodeGraphBuilder()
		builder.graph = graph
		builder.graph_level = graph_level
		response = builder.export_subgraph_for_visualization(
			centers,
			depth=depth,
			graph_level=graph_level,
		)
	else:
		response = graph_builder.export_subgraph_for_visualization(
		centers,
		depth=depth,
		graph_level=graph_level,
	)
	return response

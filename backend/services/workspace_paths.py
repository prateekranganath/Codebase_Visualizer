"""Shared workspace path resolution.

Single source of truth for where a workspace's persisted state — graph store and
vector store — lives on disk, and for validating that a caller-supplied ``root_dir``
points at a workspace this server actually manages.

This logic previously lived only inside ``routes/graph.py`` (as
``_resolve_graph_store_root`` / ``_is_allowed_graph_root``). It is extracted here,
unchanged in behavior, so the AI layer (``ai_engine.py``, ``engine_registry.py``) can
resolve the same per-workspace directories that graph export already uses correctly,
instead of every consumer growing its own copy.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

import networkx as nx

from backend.config.settings import get_settings
from backend.db.graph_store import GraphStoreRepository


def _uploads_root_candidates() -> List[Path]:
	settings = get_settings()
	candidates: List[Path] = []
	configured = os.getenv("APP_UPLOADS_DIR") or os.getenv("UPLOADS_DIR")
	if configured:
		candidates.append(Path(configured).resolve())
	local_app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
	if local_app_data:
		candidates.append((Path(local_app_data) / "codebase_visualizer" / "uploaded_workspaces").resolve())
	candidates.append(Path(settings.root_dir).resolve())
	return candidates


def is_allowed_graph_root(root_dir: Path) -> bool:
	"""Return True if root_dir resolves under a recognized upload/workspace root."""
	root_dir_resolved = root_dir.resolve()
	for candidate in _uploads_root_candidates():
		try:
			if root_dir_resolved.is_relative_to(candidate):
				return True
		except Exception:
			continue
	return False


def resolve_graph_store_root(root_dir: Optional[str]) -> Path:
	"""Return the directory that actually owns a workspace's persisted state.

	Uploaded archives are stored inside a wrapper directory, while callers pass the
	extracted repository root back to the API. When the extracted root lives under a
	wrapper that contains the actual graph_store, fall back to that wrapper so graph
	export, the vector store, and AI context all resolve to the same anchor.

	When root_dir is falsy, returns the global default root (settings.root_dir) —
	the no-workspace case.
	"""
	settings = get_settings()
	if not root_dir:
		return Path(settings.root_dir).resolve()

	root = Path(root_dir).resolve()
	direct_graph = root / "graph_store" / "graph.json"
	if direct_graph.exists():
		return root

	parent = root.parent
	wrapper_manifest = parent / "workspace_manifest.json"
	wrapper_graph = parent / "graph_store" / "graph.json"
	if wrapper_manifest.exists() and wrapper_graph.exists():
		return parent

	return root


def resolve_graph_store_path(root_dir: Optional[str]) -> Path:
	"""Return the graph_store directory for a workspace root (or the global default)."""
	if not root_dir:
		return Path(get_settings().graph_store_path)
	return resolve_graph_store_root(root_dir) / "graph_store"


def resolve_vector_store_path(root_dir: Optional[str]) -> Path:
	"""Return the vector_store directory for a workspace root (or the global default).

	Placed as a sibling of graph_store under the same resolved anchor directory (see
	resolve_graph_store_root) so both persisted stores always live together, even when
	the extracted repo sits one level below the upload wrapper directory.
	"""
	if not root_dir:
		return Path(get_settings().vector_db_path)
	return resolve_graph_store_root(root_dir) / "vector_store"


@lru_cache(maxsize=32)
def _load_graph_cached(graph_store_dir: str, mtime_ns: int) -> nx.DiGraph:
	return GraphStoreRepository(store_path=graph_store_dir).load()


def load_graph_for_root(root_dir: Optional[str]) -> nx.DiGraph:
	"""Load the persisted graph for a workspace, cached until graph.json's mtime changes.

	Returns an empty graph if nothing has been built/persisted for this root yet.
	"""
	graph_dir = resolve_graph_store_path(root_dir)
	graph_path = graph_dir / "graph.json"
	mtime_ns = graph_path.stat().st_mtime_ns if graph_path.exists() else -1
	return _load_graph_cached(str(graph_dir), mtime_ns)

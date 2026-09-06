"""Shared singleton dependencies for the FastAPI app.

Note on root_dir-scoped engines: EmbeddingEngine and the persisted graph are both
per-workspace state (see services/workspace_paths.py and services/engine_registry.py).
FastAPI's Depends() resolves dependencies before the request body is parsed, so it
cannot see a root_dir that lives in a POST body. Routes that need a workspace-scoped
engine call the factory functions below directly in the handler body (passing
payload.root_dir) instead of via Depends() — see routes/project.py's /project/sync
for the pattern. Depends() remains fine for routes with no request-scoped root_dir.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from backend.db.graph_store import GraphStoreRepository
from backend.services.ai_engine import AIEngine
from backend.services.embedding_engine import EmbeddingEngine
from backend.services.engine_registry import get_embedding_engine as _get_embedding_engine
from backend.services.graph_builder import CodeGraphBuilder
from backend.services.refactor_engine import RefactorEngine
from backend.services.teaching_engine import TeachingEngine
from backend.services.update_engine import UpdateEngine
from backend.services.workspace_paths import resolve_graph_store_path
from backend.services import codebase_manager


def get_embedding_engine(root_dir: Optional[str] = None) -> EmbeddingEngine:
    """Return the EmbeddingEngine for a workspace root (or the global default store)."""
    return _get_embedding_engine(root_dir)


def get_graph_builder() -> CodeGraphBuilder:
    return CodeGraphBuilder()


def get_ai_engine() -> AIEngine:
    return AIEngine(
        embedding_engine=get_embedding_engine(),
        graph_builder=get_graph_builder(),
    )


@lru_cache(maxsize=1)
def get_teaching_engine() -> TeachingEngine:
    # Cached as a process-wide singleton (fine for a single-process personal-project
    # deployment): TeachingEngine.user_profiles and .sessions must survive across
    # requests, or per-user proficiency tracking and the teach->evaluate session
    # handshake would both reset on every call.
    return TeachingEngine(ai_engine=get_ai_engine())


def get_refactor_engine() -> RefactorEngine:
    return RefactorEngine(
        ai_engine=get_ai_engine(),
        codebase_manager=codebase_manager,
        graph_builder=get_graph_builder(),
    )


def get_update_engine(root_dir: Optional[str] = None) -> UpdateEngine:
    return UpdateEngine(
        embedding_engine=get_embedding_engine(root_dir),
        graph_builder=get_graph_builder(),
        graph_store_repo=GraphStoreRepository(store_path=str(resolve_graph_store_path(root_dir))),
    )
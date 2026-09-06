"""Keyed cache of per-workspace EmbeddingEngine instances.

Deliberately dependency-free of AIEngine and deps.py: deps.py imports ai_engine.py,
and ai_engine.py needs to resolve an EmbeddingEngine by root_dir at call time. Routing
both through this leaf module avoids an import cycle between them.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from backend.config.settings import get_settings
from backend.services.embedding_engine import EmbeddingEngine
from backend.services.workspace_paths import resolve_vector_store_path


@lru_cache(maxsize=32)
def _embedding_engine_for_path(vector_db_path: str, model_name: str) -> EmbeddingEngine:
	return EmbeddingEngine(model_name=model_name, vector_db_path=vector_db_path)


def get_embedding_engine(root_dir: Optional[str] = None) -> EmbeddingEngine:
	"""Return the EmbeddingEngine for a workspace root, or the global default store.

	Bounded to 32 concurrently-cached engines (LRU) so a long session with several
	uploaded workspaces doesn't hold unlimited FAISS indices in memory. An evicted
	engine reloads cleanly from its own persisted files on next access — no data loss,
	since EmbeddingEngine always saves to disk after every mutation.
	"""
	settings = get_settings()
	path = resolve_vector_store_path(root_dir)
	return _embedding_engine_for_path(str(path), settings.embedding_model_name)

"""Shared singleton dependencies for the FastAPI app."""

from __future__ import annotations

from functools import lru_cache

from backend.services.ai_engine import AIEngine
from backend.services.embedding_engine import EmbeddingEngine
from backend.services.graph_builder import CodeGraphBuilder
from backend.services.refactor_engine import RefactorEngine
from backend.services.teaching_engine import TeachingEngine
from backend.services.update_engine import UpdateEngine
from backend.services import codebase_manager


@lru_cache(maxsize=1)
def get_embedding_engine() -> EmbeddingEngine:
    return EmbeddingEngine()


def get_graph_builder() -> CodeGraphBuilder:
    return CodeGraphBuilder()


def get_ai_engine() -> AIEngine:
    return AIEngine(
        embedding_engine=get_embedding_engine(),
        graph_builder=get_graph_builder(),
    )


def get_teaching_engine() -> TeachingEngine:
    return TeachingEngine(ai_engine=get_ai_engine())


def get_refactor_engine() -> RefactorEngine:
    return RefactorEngine(
        ai_engine=get_ai_engine(),
        codebase_manager=codebase_manager,
        graph_builder=get_graph_builder(),
    )


def get_update_engine() -> UpdateEngine:
    return UpdateEngine(
        embedding_engine=get_embedding_engine(),
        graph_builder=get_graph_builder(),
    )
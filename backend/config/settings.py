"""Central application settings for the backend."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

try:
	from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional at runtime
	load_dotenv = None


_ROOT_DIR = Path(__file__).resolve().parents[2]

if load_dotenv is not None:
	load_dotenv(_ROOT_DIR / ".env")


def _env_bool(name: str, default: bool) -> bool:
	value = os.getenv(name)
	if value is None:
		return default
	return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, min_value: int, max_value: int) -> int:
	value = os.getenv(name)
	if value is None:
		return default
	try:
		parsed = int(value.strip())
	except Exception:
		return default
	return max(min_value, min(max_value, parsed))


def _first_model_from_env(name: str, default: str) -> str:
	value = os.getenv(name, default)
	for model in value.split(","):
		candidate = model.strip()
		if candidate:
			return candidate
	return default


def _resolve_llm_api_key(provider: str) -> Optional[str]:
	provider_name = provider.strip().lower()
	generic_key = os.getenv("LLM_API_KEY")
	if provider_name == "openrouter":
		return generic_key or os.getenv("OPENROUTER_API_KEY")
	if provider_name == "ollama":
		return generic_key or os.getenv("OLLAMA_API_KEY")
	return generic_key or os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")


def _resolve_llm_base_url(provider: str) -> Optional[str]:
	provider_name = provider.strip().lower()
	if provider_name == "openrouter":
		return os.getenv("LLM_BASE_URL") or os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
	if provider_name == "ollama":
		return os.getenv("LLM_BASE_URL") or os.getenv("OLLAMA_BASE_URL") or AppSettings.ollama_base_url
	return os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"


@dataclass(frozen=True)
class AppSettings:
	"""Application-wide configuration loaded from environment variables."""

	root_dir: str = str(Path(__file__).resolve().parents[2])
	api_title: str = "AI-Powered Codebase Visualizer & Socratic Refactoring Assistant"
	api_version: str = "0.1.0"
	debug: bool = False
	cors_allow_all: bool = True
	llm_provider: str = "openai"
	llm_model: str = "gpt-4o-mini"
	llm_model_answer: str = "gpt-4o-mini"
	llm_model_teach: str = "poolside/laguna-xs-2.1:free"
	llm_model_explain: str = "gpt-4o-mini"
	llm_model_refactor: str = "gpt-4o-mini"
	llm_api_key: Optional[str] = None
	llm_base_url: Optional[str] = None
	openai_api_key: Optional[str] = None
	openrouter_api_key: Optional[str] = None
	ollama_base_url: str = "http://localhost:11434"
	ollama_api_key: Optional[str] = None
	llm_timeout: float = 60.0
	embedding_model_name: str = "all-MiniLM-L6-v2"
	vector_db_path: str = "vector_store"
	graph_store_path: str = "graph_store"
	graph_level: int = 2
	mongo_url: Optional[str] = None
	mongo_db_name: str = "codebase_visualizer"


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
	"""Load settings once and reuse them across the app."""
	provider = os.getenv("LLM_PROVIDER", AppSettings.llm_provider)
	return AppSettings(
		root_dir=os.getenv("APP_ROOT_DIR", AppSettings.root_dir),
		api_title=os.getenv("API_TITLE", AppSettings.api_title),
		api_version=os.getenv("API_VERSION", AppSettings.api_version),
		debug=_env_bool("DEBUG", AppSettings.debug),
		cors_allow_all=_env_bool("CORS_ALLOW_ALL", AppSettings.cors_allow_all),
		llm_provider=provider,
		llm_model=_first_model_from_env("LLM_MODEL", AppSettings.llm_model),
		llm_model_answer=_first_model_from_env("LLM_MODEL_ANSWER", AppSettings.llm_model),
		llm_model_teach=_first_model_from_env("LLM_MODEL_TEACH", AppSettings.llm_model),
		llm_model_explain=_first_model_from_env("LLM_MODEL_EXPLAIN", AppSettings.llm_model),
		llm_model_refactor=_first_model_from_env("LLM_MODEL_REFACTOR", AppSettings.llm_model),
		llm_api_key=_resolve_llm_api_key(provider),
		llm_base_url=_resolve_llm_base_url(provider),
		openai_api_key=os.getenv("OPENAI_API_KEY"),
		openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
		ollama_base_url=os.getenv("OLLAMA_BASE_URL", AppSettings.ollama_base_url),
		ollama_api_key=os.getenv("OLLAMA_API_KEY"),
		llm_timeout=float(os.getenv("LLM_TIMEOUT", str(AppSettings.llm_timeout))),
		embedding_model_name=os.getenv("EMBEDDING_MODEL_NAME", AppSettings.embedding_model_name),
		vector_db_path=os.getenv("VECTOR_DB_PATH", AppSettings.vector_db_path),
		graph_store_path=os.getenv("GRAPH_STORE_PATH", AppSettings.graph_store_path),
		graph_level=_env_int("GRAPH_LEVEL", AppSettings.graph_level, min_value=1, max_value=3),
		mongo_url=os.getenv("MONGO_URL"),
		mongo_db_name=os.getenv("MONGO_DB_NAME", AppSettings.mongo_db_name),
	)


settings = get_settings()

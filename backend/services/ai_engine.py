"""AI orchestration layer for code understanding, teaching, and refactoring.

This module keeps the first version deterministic and testable:
- retrieve context from embeddings/graph services
- build prompts
- call a provider adapter (OpenAI-compatible APIs or Ollama)

The provider adapter is intentionally thin so the rest of the app can swap
providers without changing the higher-level AIEngine API.
"""

from __future__ import annotations

from dataclasses import replace
from abc import ABC, abstractmethod
from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import json
import re

import httpx

from backend.config.settings import settings
from backend.services.codebase_manager import read_file
from backend.services.embedding_engine import EmbeddingEngine


@dataclass
class LLMResponse:
	"""Normalized response returned by provider adapters."""

	content: str
	model: str
	provider: str
	raw: Optional[Dict[str, Any]] = None


@dataclass
class LLMConfig:
	"""Provider configuration for an LLM backend."""

	provider: str = "openai"
	model: str = "gpt-4o-mini"
	api_key: Optional[str] = None
	base_url: Optional[str] = None
	timeout: float = 60.0
	temperature: float = 0.0
	extra_headers: Optional[Dict[str, str]] = None

def _resolve_api_key(provider: str, explicit_key: Optional[str] = None) -> Optional[str]:
	provider_name = provider.strip().lower()
	if explicit_key:
		return explicit_key
	if provider_name == "openrouter":
		return settings.llm_api_key or settings.openrouter_api_key
	if provider_name == "ollama":
		return settings.llm_api_key or settings.ollama_api_key
	return settings.llm_api_key or settings.openai_api_key or settings.openrouter_api_key


def _resolve_base_url(provider: str, explicit_base_url: Optional[str] = None) -> Optional[str]:
	if explicit_base_url:
		return explicit_base_url
	provider_name = provider.strip().lower()
	if provider_name == "openrouter":
		return settings.llm_base_url or "https://openrouter.ai/api/v1"
	if provider_name == "ollama":
		return settings.llm_base_url or settings.ollama_base_url
	return settings.llm_base_url or "https://api.openai.com/v1"


def _default_llm_config() -> LLMConfig:
	provider = settings.llm_provider
	return LLMConfig(
		provider=provider,
		model=settings.llm_model,
		api_key=_resolve_api_key(provider),
		base_url=_resolve_base_url(provider),
		timeout=settings.llm_timeout,
	)


def _task_model(task: str) -> str:
	task_name = task.strip().lower()
	if task_name == "teach":
		return settings.llm_model_teach
	if task_name == "explain":
		return settings.llm_model_explain
	if task_name == "refactor":
		return settings.llm_model_refactor
	return settings.llm_model_answer or settings.llm_model


def _parse_model_candidates(raw_value: str) -> List[str]:
	models: List[str] = []
	seen: set[str] = set()
	for part in (raw_value or "").split(","):
		candidate = part.strip()
		if not candidate:
			continue
		if candidate in seen:
			continue
		seen.add(candidate)
		models.append(candidate)
	return models


def _task_model_candidates(task: str, *, use_env: bool = True) -> List[str]:
	"""Return an ordered list of candidate models for a task.

	We support comma-separated env vars like:
	`LLM_MODEL_TEACH=a,b,c` and will try them in order.
	"""
	task_name = task.strip().lower()
	env_var = {
		"teach": "LLM_MODEL_TEACH",
		"explain": "LLM_MODEL_EXPLAIN",
		"refactor": "LLM_MODEL_REFACTOR",
		"answer": "LLM_MODEL_ANSWER",
	}.get(task_name, "LLM_MODEL")

	raw = os.getenv(env_var) if use_env else None
	if raw is None or not raw.strip():
		raw = _task_model(task)

	models = _parse_model_candidates(raw)
	if models:
		return models

	default_model = _task_model(task)
	return [default_model] if default_model else []


class BaseLLMAdapter(ABC):
	"""Base class for all provider adapters."""

	def __init__(self, config: LLMConfig) -> None:
		self.config = config

	@abstractmethod
	def complete(
		self,
		messages: List[Dict[str, str]],
		*,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> LLMResponse:
		"""Execute a chat completion request and return a normalized response."""


class OpenAICompatibleAdapter(BaseLLMAdapter):
	"""Adapter for OpenAI-compatible chat completion APIs (OpenAI, OpenRouter, etc.)."""

	def __init__(self, config: LLMConfig) -> None:
		super().__init__(config)

		provider = config.provider.lower()
		self.base_url = _resolve_base_url(provider, config.base_url).rstrip("/")

		api_key = _resolve_api_key(provider, config.api_key)
		if not api_key:
			raise ValueError(f"Missing API key for {config.provider} provider")
		self.api_key = api_key

	def complete(
		self,
		messages: List[Dict[str, str]],
		*,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> LLMResponse:
		temperature = self.config.temperature if temperature is None else temperature

		payload = {
			"model": self.config.model,
			"messages": messages,
			"max_tokens": max_tokens,
			"temperature": temperature,
		}

		headers = {
			"Authorization": f"Bearer {self.api_key}",
			"Content-Type": "application/json",
		}
		if self.config.extra_headers:
			headers.update(self.config.extra_headers)

		# OpenRouter recommends these optional headers, but they are safe for others too.
		if self.config.provider.lower() == "openrouter":
			headers.setdefault("HTTP-Referer", "https://github.com/")
			headers.setdefault("X-Title", "Passion_Project")

		url = f"{self.base_url}/chat/completions"

		with httpx.Client(timeout=self.config.timeout) as client:
			response = client.post(url, json=payload, headers=headers)
			response.raise_for_status()
			data = response.json()

		content = data["choices"][0]["message"]["content"]
		return LLMResponse(
			content=content,
			model=self.config.model,
			provider=self.config.provider,
			raw=data,
		)


class OllamaAdapter(BaseLLMAdapter):
	"""Adapter for a local Ollama server."""

	def __init__(self, config: LLMConfig) -> None:
		super().__init__(config)
		self.base_url = _resolve_base_url("ollama", config.base_url).rstrip("/")

	def complete(
		self,
		messages: List[Dict[str, str]],
		*,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> LLMResponse:
		temperature = self.config.temperature if temperature is None else temperature

		payload = {
			"model": self.config.model,
			"messages": messages,
			"stream": False,
			"options": {
				"temperature": temperature,
				"num_predict": max_tokens,
			},
		}

		url = f"{self.base_url}/api/chat"
		with httpx.Client(timeout=self.config.timeout) as client:
			response = client.post(url, json=payload)
			response.raise_for_status()
			data = response.json()

		content = data.get("message", {}).get("content", "")
		return LLMResponse(
			content=content,
			model=self.config.model,
			provider=self.config.provider,
			raw=data,
		)


def _adapter_for_task(config: LLMConfig, task: str) -> BaseLLMAdapter:
	model = _task_model(task)
	selected_config = replace(config, model=model)
	return create_llm_adapter(selected_config)


def create_llm_adapter(config: Optional[LLMConfig] = None) -> BaseLLMAdapter:
	"""Factory that returns the correct provider adapter."""
	config = config or _default_llm_config()

	provider = config.provider.lower()
	if provider == "ollama":
		return OllamaAdapter(config)
	return OpenAICompatibleAdapter(config)


class AIEngine:
	"""High-level AI orchestration for codebase Q&A, teaching, and refactoring."""

	def __init__(
		self,
		*,
		llm_config: Optional[LLMConfig] = None,
		embedding_engine: Optional[EmbeddingEngine] = None,
		graph_builder: Optional[Any] = None,
		vector_db_path: str = "vector_store",
		embedding_model_name: str = "all-MiniLM-L6-v2",
	) -> None:
		self.llm_config = llm_config or _default_llm_config()
		self.embedding_engine = embedding_engine or EmbeddingEngine(
			model_name=embedding_model_name,
			vector_db_path=vector_db_path,
		)
		self.graph_builder = graph_builder

	def _source_to_module_name(self, source: str) -> str:
		"""Convert a file path into the module name convention used by the parser."""
		normalized = source.replace("\\", "/")
		if normalized.endswith(".py"):
			normalized = normalized[:-3]
		return normalized.replace("/", ".")

	def _build_graph_context(self, sources: Iterable[str], depth: int = 1) -> Dict[str, Any]:
		"""Build a graph subgraph for the supplied source files if a graph builder is available."""
		if self.graph_builder is None:
			return {}

		centers = [self._source_to_module_name(source) for source in sources]
		try:
			subgraph = self.graph_builder.get_subgraph(centers, depth=depth)
			return {
				"nodes": [
					{"id": node, **attrs}
					for node, attrs in subgraph.nodes(data=True)
				],
				"edges": [
					{"source": u, "target": v, **attrs}
					for u, v, attrs in subgraph.edges(data=True)
				],
			}
		except Exception:
			return {}

	def build_context(self, query: str, top_k: int = 5, *, include_graph: bool = True) -> Dict[str, Any]:
		"""
		Build retrieval context for a query.

		This is the first RAG step: semantic search over chunk embeddings, optionally
		augmented with a related graph slice.
		"""
		results = self.embedding_engine.search(query, top_k)
		sources = [chunk.get("source", "") for chunk in results if chunk.get("source")]

		context: Dict[str, Any] = {
			"query": query,
			"top_k": top_k,
			"chunks": results,
		}

		if include_graph and sources:
			context["graph"] = self._build_graph_context(sources)

		return context

	def _system_prompt(self, mode: str) -> str:
		# Keep system prompts “tool-like” and avoid meta-narration.
		common_rules = (
			"You are a backend response generation engine for a developer tool. "
			"Return clean, structured, frontend-safe output. "
			"Do not expose internal reasoning. Do not narrate analysis. "
			"Never say phrases like: 'We are given', 'The retrieved context', 'Let's analyze', 'system prompt'. "
			"Never mention retrieval mechanics, embeddings, vector search, similarity search, or prompt construction."
		)
		if mode == "teach":
			return common_rules + " You are a Socratic mentor. Ask one strong question and provide a short hint."
		if mode == "refactor":
			return common_rules + " You are a refactoring assistant. Focus on maintainability, minimal safe changes, and risks."
		if mode == "explain":
			return common_rules + " You are a senior code reviewer. Explain architecture and intent concisely."
		return common_rules + " You are an architecture assistant. Be concise and developer-centric."


	def _extract_json_object(self, text: str) -> Optional[str]:
		"""Best-effort extraction of a JSON object from an LLM response."""
		if not text:
			return None
		clean = text.strip()
		# Remove common Markdown code fences.
		clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
		clean = re.sub(r"\s*```$", "", clean)

		start = clean.find("{")
		end = clean.rfind("}")
		if start == -1 or end == -1 or end <= start:
			return None
		return clean[start : end + 1]


	def _parse_json_object(self, text: str) -> Optional[Dict[str, Any]]:
		payload = self._extract_json_object(text)
		if not payload:
			return None
		try:
			obj = json.loads(payload)
			return obj if isinstance(obj, dict) else None
		except Exception:
			return None


	def explain_code_structured(
		self,
		file_path: str,
		*,
		root_dir: Optional[str] = None,
		top_k: int = 5,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> Dict[str, Any]:
		"""Return a structured, frontend-safe explanation for a file."""
		file_contents = ""
		if root_dir:
			try:
				# Treat file_path as workspace-relative when root_dir is provided.
				file_contents = read_file(root_dir, file_path)
			except Exception:
				file_contents = ""
		else:
			try:
				path = Path(file_path)
				file_contents = path.read_text(encoding="utf-8") if path.exists() else ""
			except Exception:
				file_contents = ""

		system_prompt = self._system_prompt("explain")
		prompt = (
			"Return JSON only (no markdown).\n"
			"Schema:\n"
			"{\n"
			"  \"summary\": string,\n"
			"  \"responsibilities\": [string],\n"
			"  \"key_components\": [{\"name\": string, \"role\": string}],\n"
			"  \"dependencies\": [string],\n"
			"  \"risks\": [string],\n"
			"  \"insights\": [string]\n"
			"}\n\n"
			"Rules:\n"
			"- summary: <= 3 sentences\n"
			"- concise bullets; no repetition\n"
			"- do not mention analysis process or any context/retrieval mechanics\n\n"
			f"File path: {file_path}\n\n"
			"File contents:\n"
			f"{file_contents}\n"
		)

		text = self.callLLM(
			prompt,
			system_prompt=system_prompt,
			max_tokens=max_tokens,
			temperature=temperature,
			task="explain",
		)
		parsed = self._parse_json_object(text)
		if parsed is None:
			payload = {
				"summary": "File explanation unavailable in structured form.",
				"responsibilities": [],
				"key_components": [],
				"dependencies": [],
				"risks": ["LLM returned non-JSON output"],
				"insights": [],
			}
		else:
			payload = {
				"summary": str(parsed.get("summary", "")).strip(),
				"responsibilities": list(parsed.get("responsibilities", []) or []),
				"key_components": list(parsed.get("key_components", []) or []),
				"dependencies": list(parsed.get("dependencies", []) or []),
				"risks": list(parsed.get("risks", []) or []),
				"insights": list(parsed.get("insights", []) or []),
			}

		# Provide a simple legacy text field for older clients.
		text_lines = [payload.get("summary", "").strip()]
		resp = payload.get("responsibilities", []) or []
		if resp:
			text_lines.append("\nResponsibilities:")
			text_lines.extend([f"- {item}" for item in resp if str(item).strip()])

		return {
			**payload,
			"text": "\n".join([line for line in text_lines if line]).strip(),
			"mode": "explain",
			"context": {"file_path": file_path, "root_dir": root_dir},
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}

	def _format_context_block(self, context: Dict[str, Any]) -> str:
		chunks = context.get("chunks", [])
		graph = context.get("graph", {})

		lines = [f"User query: {context.get('query', '')}", "", "Relevant code chunks:"]
		if not chunks:
			lines.append("- No relevant chunks were found.")
		for idx, chunk in enumerate(chunks, start=1):
			lines.append(
				f"[{idx}] {chunk.get('source', 'unknown')} | lines {chunk.get('start_line', '?')}-{chunk.get('end_line', '?')} | score {chunk.get('similarity_score', 0):.3f}"
			)
			text = chunk.get("text", "").strip()
			if text:
				lines.append(text)
				lines.append("")

		if graph:
			lines.append("Related graph context:")
			lines.append(f"Nodes: {len(graph.get('nodes', []))}")
			lines.append(f"Edges: {len(graph.get('edges', []))}")

		return "\n".join(lines).strip()

	def callLLM(
		self,
		prompt: str,
		*,
		system_prompt: Optional[str] = None,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
		task: str = "answer",
	) -> str:
		"""
		Compatibility wrapper that sends a single prompt to the configured provider.

		Kept with the user's original method name, but now routed through the provider adapter.
		"""
		messages = []
		if system_prompt:
			messages.append({"role": "system", "content": system_prompt})
		messages.append({"role": "user", "content": prompt})

		def is_retryable_status(status: Optional[int]) -> bool:
			if status is None:
				return False
			return status in {408, 429} or status >= 500

		last_error: Optional[BaseException] = None
		model_candidates = _task_model_candidates(task)
		for model in model_candidates:
			adapter = create_llm_adapter(replace(self.llm_config, model=model))
			try:
				response = adapter.complete(
					messages,
					max_tokens=max_tokens,
					temperature=temperature,
				)
				return response.content
			except httpx.HTTPStatusError as exc:
				status = exc.response.status_code if exc.response is not None else None
				last_error = exc
				if is_retryable_status(status):
					continue
				raise
			except httpx.RequestError as exc:
				last_error = exc
				continue

		for fallback in self._fallback_adapters_for_task(task):
			try:
				fallback_response = fallback.complete(
					messages,
					max_tokens=max_tokens,
					temperature=temperature,
				)
				return fallback_response.content
			except httpx.HTTPStatusError as exc:
				status = exc.response.status_code if exc.response is not None else None
				last_error = exc
				if is_retryable_status(status):
					continue
				raise
			except httpx.RequestError as exc:
				last_error = exc
				continue

		if last_error is not None:
			raise last_error
		raise RuntimeError("LLM call failed without capturing an underlying exception")

	def _fallback_adapters_for_task(self, task: str) -> List[BaseLLMAdapter]:
		provider = (os.getenv("LLM_FALLBACK_PROVIDER") or "").strip().lower()
		if not provider:
			return []

		default_model_raw = os.getenv("LLM_FALLBACK_MODEL") or ""
		task_name = task.strip().lower()
		if task_name == "teach":
			raw = os.getenv("LLM_FALLBACK_MODEL_TEACH") or default_model_raw
		elif task_name == "explain":
			raw = os.getenv("LLM_FALLBACK_MODEL_EXPLAIN") or default_model_raw
		elif task_name == "refactor":
			raw = os.getenv("LLM_FALLBACK_MODEL_REFACTOR") or default_model_raw
		else:
			raw = default_model_raw

		models = _parse_model_candidates(raw)
		if not models:
			models = ["llama3.1"] if provider == "ollama" else [self.llm_config.model]

		api_key = (os.getenv("LLM_FALLBACK_API_KEY") or "").strip() or None
		base_url = (os.getenv("LLM_FALLBACK_BASE_URL") or "").strip() or None
		timeout = float(os.getenv("LLM_FALLBACK_TIMEOUT", str(self.llm_config.timeout)))

		adapters: List[BaseLLMAdapter] = []
		for model in models:
			fallback_config = LLMConfig(
				provider=provider,
				model=model,
				api_key=api_key,
				base_url=base_url,
				timeout=timeout,
				temperature=self.llm_config.temperature,
			)
			adapters.append(create_llm_adapter(fallback_config))
		return adapters

	def call_llm(
		self,
		prompt: str,
		*,
		system_prompt: Optional[str] = None,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> str:
		"""Pythonic alias for callLLM."""
		return self.callLLM(
			prompt,
			system_prompt=system_prompt,
			max_tokens=max_tokens,
			temperature=temperature,
			task="answer",
		)

	def answer_query(
		self,
		query: str,
		*,
		top_k: int = 5,
		mode: str = "answer",
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> Dict[str, Any]:
		"""Answer a codebase question using semantic retrieval plus an LLM."""
		context = self.build_context(query, top_k=top_k)
		system_prompt = self._system_prompt(mode)
		prompt = self._format_context_block(context)
		text = self.callLLM(
			prompt,
			system_prompt=system_prompt,
			max_tokens=max_tokens,
			temperature=temperature,
			task="explain",
		)

		return {
			"text": text,
			"mode": mode,
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
			"context": context,
		}

	def explain_code(
		self,
		file_path: str,
		*,
		top_k: int = 5,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> Dict[str, Any]:
		"""Backward-compatible wrapper (legacy shape)."""
		structured = self.explain_code_structured(
			file_path,
			top_k=top_k,
			max_tokens=max_tokens,
			temperature=temperature,
		)
		return {
			"text": json.dumps(structured, ensure_ascii=False),
			"file_path": file_path,
			"context": {},
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}

	def socratic_step(
		self,
		query: str,
		*,
		top_k: int = 5,
		max_tokens: int = 256,
		temperature: Optional[float] = None,
	) -> Dict[str, Any]:
		"""Generate a guided Socratic response instead of a direct answer."""
		context = self.build_context(query, top_k=top_k)
		prompt = self._format_context_block(context)
		text = self.callLLM(
			prompt,
			system_prompt=self._system_prompt("teach"),
			max_tokens=max_tokens,
			temperature=temperature,
			task="teach",
		)
		return {
			"text": text,
			"mode": "teach",
			"context": context,
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}

	def propose_refactor(
		self,
		file_path: str,
		goal: str,
		*,
		top_k: int = 5,
		max_tokens: int = 512,
		temperature: Optional[float] = None,
	) -> Dict[str, Any]:
		"""Generate a safe refactor recommendation and text diff guidance."""
		query = f"Refactor {file_path} to achieve: {goal}"
		context = self.build_context(query, top_k=top_k)
		context["file_path"] = file_path
		context["goal"] = goal

		prompt = (
			f"Refactor goal: {goal}\n"
			f"Target file: {file_path}\n\n"
			f"Retrieved context:\n{self._format_context_block(context)}\n\n"
			"Provide a concise refactor plan, any risks, and a minimal diff-style suggestion."
		)
		text = self.callLLM(
			prompt,
			system_prompt=self._system_prompt("refactor"),
			max_tokens=max_tokens,
			temperature=temperature,
			task="refactor",
		)
		return {
			"text": text,
			"mode": "refactor",
			"context": context,
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}

	def get_provider_info(self) -> Dict[str, Any]:
		"""Expose the current provider configuration for debugging/UI use."""
		return {
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
			"base_url": self.llm_config.base_url,
			"timeout": self.llm_config.timeout,
			"has_api_key": bool(self.llm_config.api_key),
			"fallback": {
				"provider": (os.getenv("LLM_FALLBACK_PROVIDER") or "").strip() or None,
				"model": (os.getenv("LLM_FALLBACK_MODEL") or "").strip() or None,
				"base_url": (os.getenv("LLM_FALLBACK_BASE_URL") or "").strip() or None,
			},
			"task_models": {
				"answer": settings.llm_model_answer,
				"teach": settings.llm_model_teach,
				"explain": settings.llm_model_explain,
				"refactor": settings.llm_model_refactor,
			},
			"task_model_candidates": {
				"answer": _task_model_candidates("answer"),
				"teach": _task_model_candidates("teach"),
				"explain": _task_model_candidates("explain"),
				"refactor": _task_model_candidates("refactor"),
			},
		}


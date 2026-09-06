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
import time

import httpx

from backend.config.settings import settings
from backend.services.ai_cache import AICache
from backend.services.codebase_manager import read_file
from backend.services.embedding_engine import EmbeddingEngine
from backend.services.engine_registry import get_embedding_engine as _resolve_embedding_engine
from backend.services.graph_builder import CodeGraphBuilder
from backend.services.workspace_paths import load_graph_for_root
from backend.utils.chunking_utils import estimate_token_count, get_tokenizer
from backend.utils.context_budget import TOKEN_BUDGETS, language_for_path, truncate_smart


class RateLimitError(RuntimeError):
	"""Raised when every model candidate for a task terminates in a 429.

	Lets routes distinguish "the upstream provider is rate-limiting us" (worth a
	real 429 + retry countdown in the UI) from other failures.
	"""

	def __init__(self, message: str = "LLM rate limit reached", retry_after_seconds: Optional[float] = None) -> None:
		super().__init__(message)
		self.retry_after_seconds = retry_after_seconds


@dataclass
class LLMResponse:
	"""Normalized response returned by provider adapters."""

	content: str
	model: str
	provider: str
	raw: Optional[Dict[str, Any]] = None
	tool_calls: Optional[List[Dict[str, Any]]] = None


# JSON-Schema constants for tool-calling structured output (see AIEngine._call_structured).
# None of the configured free OpenRouter models support response_format/structured_outputs,
# but all support tools + tool_choice, which is what actually enforces the output shape.
EXPLAIN_SCHEMA: Dict[str, Any] = {
	"type": "object",
	"properties": {
		"summary": {"type": "string"},
		"responsibilities": {"type": "array", "items": {"type": "string"}},
		"key_components": {
			"type": "array",
			"items": {
				"type": "object",
				"properties": {
					"name": {"type": "string"},
					"role": {"type": "string"},
				},
				"required": ["name", "role"],
			},
		},
		"dependencies": {"type": "array", "items": {"type": "string"}},
		"risks": {"type": "array", "items": {"type": "string"}},
		"insights": {"type": "array", "items": {"type": "string"}},
	},
	"required": ["summary", "responsibilities", "key_components", "dependencies", "risks", "insights"],
}

TEACH_SCHEMA: Dict[str, Any] = {
	"type": "object",
	"properties": {
		"question": {"type": "string"},
		"hint": {"type": "string"},
		"concept_focus": {"type": "string"},
		"difficulty": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
	},
	"required": ["question", "hint", "concept_focus", "difficulty"],
}

REFACTOR_SCHEMA: Dict[str, Any] = {
	"type": "object",
	"properties": {
		"suggested_code": {"type": "string"},
		"reasoning": {"type": "string"},
		"risks": {"type": "array", "items": {"type": "string"}},
	},
	"required": ["suggested_code", "reasoning", "risks"],
}

EVALUATE_SCHEMA: Dict[str, Any] = {
	"type": "object",
	"properties": {
		"is_correct": {"type": "boolean"},
		"score": {"type": "number"},
		"feedback": {"type": "string"},
		"ideal_answer": {"type": "string"},
	},
	"required": ["is_correct", "score", "feedback", "ideal_answer"],
}


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
	if task_name == "evaluate":
		return settings.llm_model_evaluate
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
		"evaluate": "LLM_MODEL_EVALUATE",
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
		tools: Optional[List[Dict[str, Any]]] = None,
		tool_choice: Optional[Dict[str, Any]] = None,
		reasoning: Optional[Dict[str, Any]] = None,
	) -> LLMResponse:
		"""Execute a chat completion request and return a normalized response.

		tools/tool_choice/reasoning are optional and used for structured tool-calling
		output (see AIEngine._call_structured). Adapters that don't support tool-calling
		may simply ignore them.
		"""


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
		tools: Optional[List[Dict[str, Any]]] = None,
		tool_choice: Optional[Dict[str, Any]] = None,
		reasoning: Optional[Dict[str, Any]] = None,
	) -> LLMResponse:
		temperature = self.config.temperature if temperature is None else temperature

		payload: Dict[str, Any] = {
			"model": self.config.model,
			"messages": messages,
			"max_tokens": max_tokens,
			"temperature": temperature,
		}
		if tools:
			payload["tools"] = tools
		if tool_choice:
			payload["tool_choice"] = tool_choice
		if reasoning:
			payload["reasoning"] = reasoning

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

		message = data["choices"][0]["message"]
		content = message.get("content") or message.get("reasoning") or ""
		return LLMResponse(
			content=str(content),
			model=self.config.model,
			provider=self.config.provider,
			raw=data,
			tool_calls=message.get("tool_calls"),
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
		tools: Optional[List[Dict[str, Any]]] = None,
		tool_choice: Optional[Dict[str, Any]] = None,
		reasoning: Optional[Dict[str, Any]] = None,
	) -> LLMResponse:
		# Ollama has no tool-calling support here; tools/tool_choice/reasoning are
		# accepted for interface compatibility with OpenAICompatibleAdapter and ignored.
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


# Model ids that have returned 404 (unknown/retired model) at least once this process
# lifetime. A 404 means the id is permanently wrong, not transiently unavailable, so we
# never waste another request retrying it until the process restarts.
_DEAD_MODELS: set[str] = set()


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

	def _build_graph_context(
		self,
		sources: Iterable[str],
		*,
		root_dir: Optional[str] = None,
		depth: int = 1,
	) -> Dict[str, Any]:
		"""Build a graph subgraph for the supplied source files.

		When root_dir is given, load that workspace's persisted graph fresh (cached by
		graph.json's mtime) instead of relying on self.graph_builder, which is only a
		harmless empty-graph placeholder for the no-workspace case — it is never
		populated from disk on its own.
		"""
		centers = [self._source_to_module_name(source) for source in sources]

		builder: Optional[CodeGraphBuilder]
		if root_dir:
			try:
				graph = load_graph_for_root(root_dir)
			except Exception:
				return {}
			builder = CodeGraphBuilder()
			builder.graph = graph
		else:
			builder = self.graph_builder

		if builder is None:
			return {}

		try:
			subgraph = builder.get_subgraph(centers, depth=depth)
			return {
				"nodes": [
					{"id": node, **attrs}
					for node, attrs in subgraph.nodes(data=True)
				],
				"edges": [
					{"source": u, "target": v, "type": attrs.get("type"), **attrs}
					for u, v, attrs in subgraph.edges(data=True)
				],
			}
		except Exception:
			return {}

	def read_source(self, file_path: Optional[str], root_dir: Optional[str] = None) -> str:
		"""Best-effort file read, treating file_path as workspace-relative when root_dir is given.

		Shared by explain/refactor/teach so each doesn't reimplement the same
		try-read-else-empty-string fallback.
		"""
		if not file_path:
			return ""
		if root_dir:
			try:
				return read_file(root_dir, file_path)
			except Exception:
				return ""
		try:
			path = Path(file_path)
			return path.read_text(encoding="utf-8") if path.exists() else ""
		except Exception:
			return ""

	def build_context(
		self,
		query: str,
		top_k: int = 5,
		*,
		root_dir: Optional[str] = None,
		include_graph: bool = True,
	) -> Dict[str, Any]:
		"""
		Build retrieval context for a query.

		This is the first RAG step: semantic search over chunk embeddings, optionally
		augmented with a related graph slice. When root_dir is given, both the chunk
		search and the graph slice are scoped to that workspace's own persisted state
		instead of this engine's default (in-process) embedding engine/graph.
		"""
		embedding_engine = _resolve_embedding_engine(root_dir) if root_dir else self.embedding_engine
		results = embedding_engine.search(query, top_k)
		sources = [chunk.get("source", "") for chunk in results if chunk.get("source")]

		context: Dict[str, Any] = {
			"query": query,
			"top_k": top_k,
			"chunks": results,
		}

		if include_graph and sources:
			context["graph"] = self._build_graph_context(sources, root_dir=root_dir)

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
		# Remove leading and trailing Markdown code fences
		clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
		clean = re.sub(r"\s*```$", "", clean).strip()

		# Extract from the first '{' to the last '}'
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
			try:
				# Attempt recovery from common LLM trailing commas before closing brackets/braces
				fixed = re.sub(r",\s*([\]}])", r"\1", payload)
				obj = json.loads(fixed)
				return obj if isinstance(obj, dict) else None
			except Exception:
				return None


	def explain_code_structured(
		self,
		file_path: str,
		*,
		root_dir: Optional[str] = None,
		top_k: int = 5,
		max_tokens: int = 1536,
		temperature: Optional[float] = None,
		force_refresh: bool = False,
	) -> Dict[str, Any]:
		"""Return a structured, frontend-safe explanation for a file."""
		file_contents = ""
		rag_context: Dict[str, Any] = {}
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

		cache = AICache(root_dir)
		if not force_refresh:
			cached = cache.get("explain", file_path, file_contents)
			if cached is not None:
				return {**cached, "cached": True}

		if file_contents or file_path:
			retrieval_query = f"{file_path}\n\n{file_contents[:2000]}" if file_contents else file_path
			rag_context = self.build_context(retrieval_query, top_k=top_k, root_dir=root_dir)

		budgets = TOKEN_BUDGETS["explain"]
		budgeted_contents = truncate_smart(
			file_contents,
			budget_tokens=budgets["file"],
			language=language_for_path(file_path),
		)
		context_block = (
			self._format_context_block(
				rag_context,
				max_chunk_tokens=budgets["chunks"],
				max_graph_tokens=budgets["graph"],
			)
			if rag_context
			else "No additional code context found."
		)

		system_prompt = self._system_prompt("explain")
		prompt = (
			"Provide a structured explanation for the following file based on its contents and additional code context.\n\n"
			f"File path: {file_path}\n\n"
			"Additional code context:\n"
			f"{context_block}\n\n"
			"File contents:\n"
			f"{budgeted_contents}\n\n"
			"Rules:\n"
			"- summary: <= 3 sentences\n"
			"- concise bullets; no repetition\n"
			"- use the additional code context when it is relevant\n"
			"- do not mention analysis process or any context/retrieval mechanics"
		)

		messages = [
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": prompt},
		]
		parsed = self._call_structured(
			messages,
			schema=EXPLAIN_SCHEMA,
			tool_name="submit_explanation",
			task="explain",
			max_tokens=max_tokens,
			temperature=temperature,
		)
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

		result = {
			**payload,
			"text": "\n".join([line for line in text_lines if line]).strip(),
			"mode": "explain",
			"context": {"file_path": file_path, "root_dir": root_dir, "rag_context": rag_context},
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}
		cache.set("explain", file_path, file_contents, result)
		return {**result, "cached": False}

	def _format_context_block(
		self,
		context: Dict[str, Any],
		*,
		max_chunk_tokens: Optional[int] = None,
		max_graph_tokens: Optional[int] = None,
	) -> str:
		chunks = context.get("chunks", [])
		graph = context.get("graph", {})
		tokenizer = get_tokenizer() if (max_chunk_tokens or max_graph_tokens) else None

		lines = [f"User query: {context.get('query', '')}", "", "Relevant code chunks:"]
		if not chunks:
			lines.append("- No relevant chunks were found.")

		chunk_tokens_used = 0
		for idx, chunk in enumerate(chunks, start=1):
			header = f"[{idx}] {chunk.get('source', 'unknown')} | lines {chunk.get('start_line', '?')}-{chunk.get('end_line', '?')} | score {chunk.get('similarity_score', 0):.3f}"
			text = chunk.get("text", "").strip()
			block = header + ("\n" + text if text else "")
			if max_chunk_tokens is not None:
				block_tokens = estimate_token_count(block, tokenizer)
				if chunk_tokens_used + block_tokens > max_chunk_tokens:
					lines.append(f"- ... {len(chunks) - idx + 1} more chunk(s) omitted to fit the context budget")
					break
				chunk_tokens_used += block_tokens
			lines.append(header)
			if text:
				lines.append(text)
				lines.append("")

		edges = (graph.get("edges", []) if graph else [])[:20]
		if edges:
			lines.append("Related graph context (imports, calls, containment, inheritance):")
			graph_tokens_used = 0
			shown = 0
			for edge in edges:
				edge_type = edge.get("type") or "relates to"
				line = f"- {edge.get('source')} --{edge_type}--> {edge.get('target')}"
				if max_graph_tokens is not None:
					line_tokens = estimate_token_count(line, tokenizer)
					if graph_tokens_used + line_tokens > max_graph_tokens:
						break
					graph_tokens_used += line_tokens
				lines.append(line)
				shown += 1
			total_edges = len(graph.get("edges", []) if graph else [])
			remaining = total_edges - shown
			if remaining > 0:
				lines.append(f"- ... and {remaining} more relationships")

		return "\n".join(lines).strip()

	def _complete_with_fallback(
		self,
		messages: List[Dict[str, str]],
		*,
		max_tokens: int,
		temperature: Optional[float],
		task: str,
		tools: Optional[List[Dict[str, Any]]] = None,
		tool_choice: Optional[Dict[str, Any]] = None,
		reasoning: Optional[Dict[str, Any]] = None,
	) -> LLMResponse:
		"""Try each configured model candidate (then fallback-provider candidates) in
		order, skipping models already known-dead this process lifetime, until one
		succeeds. Shared by callLLM (plain text) and _call_structured (tool-calling).
		"""

		def is_retryable_status(status: Optional[int]) -> bool:
			if status is None:
				return False
			# 404/403 are handled separately (see _DEAD_MODELS below): 404 means the
			# model id is wrong, 403 means OpenRouter permanently gates it (e.g. an
			# "agentic harness only" model) for this kind of direct API call --
			# neither is transient, so retrying the same model would never help.
			return status == 429 or status >= 500

		last_error: Optional[BaseException] = None
		model_candidates = [m for m in _task_model_candidates(task) if m not in _DEAD_MODELS]
		if not model_candidates:
			# Every configured candidate has 404'd this process lifetime — fall back to
			# the full list so misconfiguration still surfaces a clear error instead of
			# silently doing nothing.
			model_candidates = _task_model_candidates(task)

		for model in model_candidates:
			adapter = create_llm_adapter(replace(self.llm_config, model=model))
			try:
				return adapter.complete(
					messages,
					max_tokens=max_tokens,
					temperature=temperature,
					tools=tools,
					tool_choice=tool_choice,
					reasoning=reasoning,
				)
			except httpx.HTTPStatusError as exc:
				status = exc.response.status_code if exc.response is not None else None
				last_error = exc
				if status in (404, 403):
					_DEAD_MODELS.add(model)
					continue
				if is_retryable_status(status):
					if status == 429:
						time.sleep(0.5)
					continue
				raise
			except httpx.RequestError as exc:
				last_error = exc
				continue

		for fallback in self._fallback_adapters_for_task(task):
			if fallback.config.model in _DEAD_MODELS:
				continue
			try:
				return fallback.complete(
					messages,
					max_tokens=max_tokens,
					temperature=temperature,
					tools=tools,
					tool_choice=tool_choice,
					reasoning=reasoning,
				)
			except httpx.HTTPStatusError as exc:
				status = exc.response.status_code if exc.response is not None else None
				last_error = exc
				if status in (404, 403):
					_DEAD_MODELS.add(fallback.config.model)
					continue
				if is_retryable_status(status):
					continue
				raise
			except httpx.RequestError as exc:
				last_error = exc
				continue

		if last_error is not None:
			if isinstance(last_error, httpx.HTTPStatusError) and last_error.response is not None and last_error.response.status_code == 429:
				retry_after: Optional[float] = None
				header_value = last_error.response.headers.get("Retry-After")
				if header_value:
					try:
						retry_after = float(header_value)
					except ValueError:
						retry_after = None
				raise RateLimitError(retry_after_seconds=retry_after) from last_error
			raise last_error
		raise RuntimeError("LLM call failed without capturing an underlying exception")

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

		response = self._complete_with_fallback(
			messages,
			max_tokens=max_tokens,
			temperature=temperature,
			task=task,
		)
		return response.content

	def _call_structured(
		self,
		messages: List[Dict[str, str]],
		*,
		schema: Dict[str, Any],
		tool_name: str,
		task: str,
		max_tokens: int,
		temperature: Optional[float] = None,
	) -> Optional[Dict[str, Any]]:
		"""Call the LLM with a forced tool call so the response shape is enforced by
		the provider rather than begged for in the prompt. None of the configured free
		models support response_format/structured_outputs, but all support tools.

		Fallback ladder if the model still doesn't cooperate (no extra requests):
		tool_call arguments -> json.loads(content) -> regex JSON extraction -> None.
		"""
		tools = [
			{
				"type": "function",
				"function": {
					"name": tool_name,
					"description": f"Submit the {tool_name.replace('_', ' ')} result as structured data.",
					"parameters": schema,
				},
			}
		]
		tool_choice = {"type": "function", "function": {"name": tool_name}}

		response = self._complete_with_fallback(
			messages,
			max_tokens=max_tokens,
			temperature=temperature,
			task=task,
			tools=tools,
			tool_choice=tool_choice,
			reasoning={"enabled": False},
		)

		if response.tool_calls:
			for call in response.tool_calls:
				function = call.get("function", {}) if isinstance(call, dict) else {}
				if function.get("name") != tool_name:
					continue
				arguments = function.get("arguments")
				if isinstance(arguments, dict):
					return arguments
				if isinstance(arguments, str):
					try:
						parsed = json.loads(arguments)
						if isinstance(parsed, dict):
							return parsed
					except Exception:
						pass

		if response.content:
			try:
				parsed = json.loads(response.content)
				if isinstance(parsed, dict):
					return parsed
			except Exception:
				pass
			parsed = self._parse_json_object(response.content)
			if parsed is not None:
				return parsed

		return None

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
		root_dir: Optional[str] = None,
	) -> Dict[str, Any]:
		"""Answer a codebase question using semantic retrieval plus an LLM."""
		context = self.build_context(query, top_k=top_k, root_dir=root_dir)
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

	def propose_refactor(
		self,
		file_path: str,
		goal: str,
		*,
		root_dir: Optional[str] = None,
		top_k: int = 5,
		max_tokens: Optional[int] = None,
		temperature: Optional[float] = None,
		force_refresh: bool = False,
	) -> Dict[str, Any]:
		"""Generate a structured, safe refactor recommendation with the full suggested code.

		Returns a dict with keys:
		  - suggested_code: the full refactored file contents
		  - reasoning: explanation of the changes made
		  - risks: list of potential risks
		  - text: legacy plain-text summary
		  - mode, context, provider, model: metadata
		"""
		target_root = root_dir or settings.root_dir

		# ── 1. Read original file contents ──────────────────────────────────
		file_contents = ""
		try:
			file_contents = read_file(target_root, file_path)
		except Exception:
			try:
				path = Path(file_path)
				file_contents = path.read_text(encoding="utf-8") if path.exists() else ""
			except Exception:
				file_contents = ""

		cache = AICache(target_root)
		if not force_refresh:
			cached = cache.get("refactor", file_path, file_contents, extra=goal)
			if cached is not None:
				return {**cached, "cached": True}

		# ── 2. Build RAG context ─────────────────────────────────────────────
		retrieval_query = f"Refactor {file_path} to achieve: {goal}"
		if file_contents:
			retrieval_query = f"{retrieval_query}\n\n{file_contents[:2000]}"
		context = self.build_context(retrieval_query, top_k=top_k, root_dir=target_root)
		context["file_path"] = file_path
		context["goal"] = goal

		budgets = TOKEN_BUDGETS["refactor"]
		budgeted_contents = truncate_smart(
			file_contents,
			budget_tokens=budgets["file"],
			language=language_for_path(file_path),
		)
		context_block = (
			self._format_context_block(
				context,
				max_chunk_tokens=budgets["chunks"],
				max_graph_tokens=budgets["graph"],
			)
			if context.get("chunks")
			else "No additional context found."
		)

		# Scale the output budget with input size (small files don't need 4096 tokens
		# of headroom; large files need more than a flat default to avoid truncation)
		# unless the caller explicitly requested a specific budget.
		if max_tokens is None:
			file_tokens = estimate_token_count(budgeted_contents)
			max_tokens = int(max(2048, min(8192, file_tokens * 1.3)))

		# ── 3. Build structured prompt ───────────────────────────────────────
		system_prompt = self._system_prompt("refactor")
		prompt = (
			"Refactor the following source file to achieve the stated goal.\n\n"
			f"Refactor goal: {goal}\n"
			f"Target file: {file_path}\n\n"
			"Additional code context:\n"
			f"{context_block}\n\n"
			"Original file contents:\n"
			f"{budgeted_contents}\n\n"
			"Rules:\n"
			"- Return the FULL refactored file contents in suggested_code (not just a diff)\n"
			"- reasoning: <= 3 sentences explaining the changes\n"
			"- risks: bullet list of potential risks (empty array if none)\n"
			"- Preserve all existing behaviour unless the goal explicitly changes it\n"
			"- Do NOT omit any function, class, or import that was in the original unless the goal asks for it"
		)

		messages = [
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": prompt},
		]

		# ── 4. Call LLM with tool-enforced structured output ──────────────────
		try:
			parsed = self._call_structured(
				messages,
				schema=REFACTOR_SCHEMA,
				tool_name="submit_refactor",
				task="refactor",
				max_tokens=max_tokens,
				temperature=temperature,
			)
		except RateLimitError:
			# Let the route return a real 429 + retry-after so the UI can show a
			# countdown instead of a fake-successful "no changes applied" proposal.
			raise
		except Exception as exc:
			error_msg = str(exc)
			if "401" in error_msg or "API key" in error_msg:
				user_msg = "LLM authentication failed. Please check your API key settings."
			else:
				user_msg = f"LLM provider error: {error_msg}"

			return {
				"suggested_code": file_contents,
				"reasoning": user_msg,
				"risks": ["LLM call failed; original file preserved without changes."],
				"text": user_msg,
				"mode": "refactor",
				"context": context,
				"provider": self.llm_config.provider,
				"model": self.llm_config.model,
			}

		# ── 5. Normalise output ──────────────────────────────────────────────
		if parsed is None:
			# Last resort: return original code unchanged so the pipeline doesn't break
			suggested_code = file_contents
			reasoning = "Structured output unavailable; no changes applied."
			risks: List[str] = ["LLM returned non-JSON output"]
		else:
			suggested_code = str(parsed.get("suggested_code", file_contents)).strip()
			reasoning = str(parsed.get("reasoning", "")).strip()
			raw_risks = parsed.get("risks", [])
			risks = list(raw_risks) if isinstance(raw_risks, list) else []

		result = {
			"suggested_code": suggested_code,
			"reasoning": reasoning,
			"risks": risks,
			# Legacy plain-text field for older callers
			"text": reasoning or "Refactor proposal generated.",
			"mode": "refactor",
			"context": context,
			"provider": self.llm_config.provider,
			"model": self.llm_config.model,
		}
		cache.set("refactor", file_path, file_contents, result, extra=goal)
		return {**result, "cached": False}

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
				"evaluate": settings.llm_model_evaluate,
			},
			"task_model_candidates": {
				"answer": _task_model_candidates("answer"),
				"teach": _task_model_candidates("teach"),
				"explain": _task_model_candidates("explain"),
				"refactor": _task_model_candidates("refactor"),
				"evaluate": _task_model_candidates("evaluate"),
			},
			"dead_models": sorted(_DEAD_MODELS),
		}


"""Prompt templates shared by the AI orchestration layer."""

from __future__ import annotations

SYSTEM_PROMPTS = {
	"answer": (
		"You are an AI assistant for exploring and improving codebases. Be precise, helpful, and grounded in context."
	),
	"teach": (
		"You are a Socratic coding mentor. Do not give the final answer immediately. Ask precise questions and guide step by step."
	),
	"explain": (
		"You are a senior code reviewer. Explain code clearly and use evidence from the provided context."
	),
	"refactor": (
		"You are a refactoring assistant. Recommend safe, incremental improvements. Prefer concise diffs and preserve behavior."
	),
}


def system_prompt(mode: str) -> str:
	return SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["answer"])


def query_prompt(query: str, context_block: str) -> str:
	return f"User query: {query}\n\nContext:\n{context_block}"


def refactor_prompt(file_path: str, goal: str, context_block: str) -> str:
	return (
		f"Refactor goal: {goal}\n"
		f"Target file: {file_path}\n\n"
		f"Context:\n{context_block}\n\n"
		"Provide a concise refactor plan, risks, and a minimal diff-style suggestion."
	)


"""Teaching engine for Socratic code guidance with adaptive learning memory."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.ai_engine import AIEngine


@dataclass
class Interaction:
    """Record of a single user-engine teaching interaction."""

    timestamp: str
    query: str
    response: Dict[str, Any]
    user_feedback: Optional[str] = None


@dataclass
class UserProfile:
    """Tracks a user's learning progress and knowledge gaps."""

    user_id: str
    weak_areas: List[str] = field(default_factory=list)
    strong_areas: List[str] = field(default_factory=list)
    interaction_history: List[Interaction] = field(default_factory=list)
    proficiency_level: str = "beginner"  # beginner, intermediate, advanced
    last_active: Optional[str] = None
    attempts_count: Dict[str, int] = field(default_factory=dict)  # topic -> count


class TeachingEngine:
    """Provides Socratic-style guidance for code exploration and learning."""

    def __init__(self, ai_engine: Optional[AIEngine] = None) -> None:
        """
        Initialize the teaching engine.

        Args:
            ai_engine: Optional AIEngine instance; creates one if not provided.
        """
        self.ai_engine = ai_engine or AIEngine()
        self.user_profiles: Dict[str, UserProfile] = {}

    def _get_or_create_user(self, user_id: str) -> UserProfile:
        """Get an existing user profile or create a new one."""
        if user_id not in self.user_profiles:
            self.user_profiles[user_id] = UserProfile(user_id=user_id)
        return self.user_profiles[user_id]

    def _infer_topic(self, query: str) -> str:
        """Extract a topic/keyword from the query (simple heuristic)."""
        keywords = ["auth", "api", "database", "ui", "validation", "error", "test", "cache"]
        query_lower = query.lower()
        for kw in keywords:
            if kw in query_lower:
                return kw
        return "general"

    def _get_user_proficiency_level(self, user_id: str) -> str:
        """Estimate the user's proficiency from their interaction history."""
        profile = self._get_or_create_user(user_id)
        if not profile.interaction_history:
            return "beginner"

        # Simple heuristic: count attempts and categorize
        total_interactions = len(profile.interaction_history)
        if total_interactions > 50:
            return "advanced"
        if total_interactions > 20:
            return "intermediate"
        return "beginner"

    def analyze_user_level(
        self,
        user_id: str,
        query: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Analyze what level of guidance a user needs.

        Args:
            user_id: The user identifier.
            query: The user's question.
            context: Optional retrieved context (chunks, graph data).

        Returns:
            Dict with inferred level, weak areas, strong areas, and guidance strategy.
        """
        profile = self._get_or_create_user(user_id)
        topic = self._infer_topic(query)
        proficiency = self._get_user_proficiency_level(user_id)

        # Track topic attempts
        profile.attempts_count[topic] = profile.attempts_count.get(topic, 0) + 1

        # Determine if user is asking about a weak area
        is_weak_area = topic in profile.weak_areas
        is_strong_area = topic in profile.strong_areas

        guidance_level = "hints"  # default
        if proficiency == "beginner":
            guidance_level = "questions"
        elif proficiency == "intermediate" and is_weak_area:
            guidance_level = "hints"
        elif proficiency == "advanced":
            guidance_level = "explanation"

        return {
            "user_id": user_id,
            "proficiency_level": proficiency,
            "topic": topic,
            "guidance_level": guidance_level,
            "is_weak_area": is_weak_area,
            "is_strong_area": is_strong_area,
            "attempt_count_for_topic": profile.attempts_count.get(topic, 1),
            "weak_areas": profile.weak_areas,
            "strong_areas": profile.strong_areas,
        }

    def generate_teach_payload(
        self,
        query: str,
        *,
        concept_focus: str,
        difficulty: str,
        max_tokens: int = 256,
    ) -> Dict[str, Any]:
        """Generate a single Socratic question + hint in a frontend-safe JSON shape."""

        system_prompt = self.ai_engine._system_prompt("teach")
        prompt = (
            "Return JSON only (no markdown).\n"
            "Schema:\n"
            "{\n"
            "  \"question\": string,\n"
            "  \"hint\": string,\n"
            "  \"concept_focus\": string,\n"
            "  \"difficulty\": \"beginner\"|\"intermediate\"|\"advanced\"\n"
            "}\n\n"
            "Rules:\n"
            "- Ask ONE Socratic question only\n"
            "- Hint must guide, not reveal the answer\n"
            "- Keep concise and tool-like\n\n"
            f"concept_focus: {concept_focus}\n"
            f"difficulty: {difficulty}\n"
            f"user_query: {query}\n"
        )

        text = self.ai_engine.callLLM(
            prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            task="teach",
        )

        parsed = self.ai_engine._parse_json_object(text)  # type: ignore[attr-defined]
        if not isinstance(parsed, dict):
            return {
                "question": "What is the smallest part of the code you can inspect to validate your assumption?",
                "hint": "Start by identifying the input, output, and one invariant you can check.",
                "concept_focus": concept_focus,
                "difficulty": difficulty,
            }

        return {
            "question": str(parsed.get("question", "")).strip(),
            "hint": str(parsed.get("hint", "")).strip(),
            "concept_focus": str(parsed.get("concept_focus", concept_focus)).strip() or concept_focus,
            "difficulty": str(parsed.get("difficulty", difficulty)).strip() or difficulty,
        }

    def generate_hint(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        top_k: int = 5,
        hint_level: str = "light",
    ) -> Dict[str, Any]:
        """
        Generate a hint that points toward the answer without giving it directly.

        Args:
            query: The user's question.
            context: Optional retrieved context.
            top_k: Number of top chunks to retrieve.
            hint_level: "light" (very indirect), "medium" (moderate guidance), or "heavy" (almost the answer).

        Returns:
            Dict with hint, guidance level, and context.
        """
        if context is None:
            context = self.ai_engine.build_context(query, top_k=top_k)

        hint_prompt_map = {
            "light": "Provide a very subtle hint; do not mention the answer. Ask what tool or concept might help.",
            "medium": "Provide a moderate hint; mention relevant concepts but not the final answer.",
            "heavy": "Provide a detailed hint that almost gives the answer, but leaves a small gap for discovery.",
        }

        system = hint_prompt_map.get(hint_level, hint_prompt_map["light"])

        prompt = (
            f"Question: {query}\n\n"
            f"Context:\n{self.ai_engine._format_context_block(context)}\n\n"
            f"{system}"
        )

        hint_text = self.ai_engine.callLLM(
            prompt,
            system_prompt="You are a guide. Provide hints without directly answering.",
            max_tokens=256,
            task="teach",
        )

        return {
            "hint": hint_text,
            "hint_level": hint_level,
            "context": context,
            "type": "hint",
        }

    def teaching_response(
        self,
        user_id: str,
        query: str,
        *,
        top_k: int = 5,
        escalate_on_repeat: bool = True,
        max_tokens: int = 512,
    ) -> Dict[str, Any]:
        """
        Generate a full Socratic teaching response, adapting based on user level and history.

        This is the main method: it analyzes the user, retrieves context, and returns
        questions, hints, or explanation depending on proficiency and topic history.

        Args:
            user_id: The user identifier.
            query: The user's question.
            top_k: Number of context chunks to retrieve.
            escalate_on_repeat: If true, give more direct help after repeated attempts.
            max_tokens: Maximum tokens for the LLM response.

        Returns:
            Dict with questions, hint, explanation, next_step, and interaction metadata.
        """
        profile = self._get_or_create_user(user_id)
        analysis = self.analyze_user_level(user_id, query)
        guidance_level = analysis["guidance_level"]
        topic = analysis["topic"]
        attempt_count = analysis["attempt_count_for_topic"]

        # Escalate guidance if user has attempted this topic multiple times
        if escalate_on_repeat and attempt_count > 2:
            if guidance_level == "questions":
                guidance_level = "hints"
            elif guidance_level == "hints":
                guidance_level = "explanation"

        proficiency = analysis["proficiency_level"]
        difficulty = proficiency if proficiency in {"beginner", "intermediate", "advanced"} else "beginner"

        response = self.generate_teach_payload(
            query,
            concept_focus=topic,
            difficulty=difficulty,
            max_tokens=min(max_tokens, 256),
        )

        # Store the interaction
        interaction = Interaction(
            timestamp=datetime.utcnow().isoformat(),
            query=query,
            response={
                "user_id": user_id,
                "query": query,
                "proficiency_level": proficiency,
                "topic": topic,
                "guidance_level": guidance_level,
                "attempt_count": attempt_count,
                "payload": response,
            },
        )
        profile.interaction_history.append(interaction)
        profile.last_active = interaction.timestamp

        return response

    def evaluate_answer(
        self,
        *,
        user_id: str,
        question: str,
        user_answer: str,
        concept_focus: Optional[str] = None,
        difficulty: Optional[str] = None,
        max_tokens: int = 256,
    ) -> Dict[str, Any]:
        """Evaluate a user's answer to a Socratic question.

        Returns a frontend-safe JSON shape:
        {is_correct, score, feedback, ideal_answer, concept_focus, difficulty}
        """
        profile = self._get_or_create_user(user_id)
        focus = (concept_focus or self._infer_topic(question) or "general").strip() or "general"
        level = (difficulty or profile.proficiency_level or "beginner").strip().lower()
        if level not in {"beginner", "intermediate", "advanced"}:
            level = "beginner"

        system_prompt = self.ai_engine._system_prompt("teach")
        prompt = (
            "Return JSON only (no markdown).\n"
            "Schema:\n"
            "{\n"
            "  \"is_correct\": boolean,\n"
            "  \"score\": number,\n"
            "  \"feedback\": string,\n"
            "  \"ideal_answer\": string\n"
            "}\n\n"
            "Rules:\n"
            "- score must be between 0.0 and 1.0\n"
            "- feedback: 2-6 concise sentences, actionable\n"
            "- ideal_answer: 1-3 sentences, no code blocks\n"
            "- do not mention analysis process or LLM behavior\n\n"
            f"concept_focus: {focus}\n"
            f"difficulty: {level}\n\n"
            f"Question: {question}\n\n"
            f"User answer: {user_answer}\n"
        )

        text = self.ai_engine.callLLM(
            prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            task="teach",
        )

        parsed = self.ai_engine._parse_json_object(text)  # type: ignore[attr-defined]
        if not isinstance(parsed, dict):
            result = {
                "is_correct": False,
                "score": 0.0,
                "feedback": "I couldn't evaluate that answer in a structured way. Try answering in 2-4 sentences and name one concrete code artifact (function/class/file) you inspected.",
                "ideal_answer": "A good answer states the key idea, ties it to a specific part of the code, and mentions one implication or tradeoff.",
                "concept_focus": focus,
                "difficulty": level,
            }
            return result

        # Normalize.
        score_raw = parsed.get("score", 0.0)
        try:
            score = float(score_raw)
        except Exception:
            score = 0.0
        score = max(0.0, min(1.0, score))
        is_correct = bool(parsed.get("is_correct", score >= 0.75))
        feedback = str(parsed.get("feedback", "")).strip() or ""
        ideal_answer = str(parsed.get("ideal_answer", "")).strip() or ""

        result = {
            "is_correct": is_correct,
            "score": score,
            "feedback": feedback,
            "ideal_answer": ideal_answer,
            "concept_focus": focus,
            "difficulty": level,
        }

        # Update memory heuristically.
        try:
            if is_correct or score >= 0.75:
                self.update_memory(user_id, focus, "understood")
            elif score <= 0.35:
                self.update_memory(user_id, focus, "confused")
        except Exception:
            pass

        # Record the interaction.
        interaction = Interaction(
            timestamp=datetime.utcnow().isoformat(),
            query=f"EVALUATE: {focus}",
            response={
                "user_id": user_id,
                "question": question,
                "user_answer": user_answer,
                "result": result,
            },
        )
        profile.interaction_history.append(interaction)
        profile.last_active = interaction.timestamp

        return result

    def update_memory(
        self,
        user_id: str,
        topic: str,
        result: str,
        **kwargs: Any,
    ) -> None:
        """
        Update the user's learning profile based on interaction outcome.

        Args:
            user_id: The user identifier.
            topic: The topic or area being learned.
            result: "understood", "confused", "mastered", or similar.
            **kwargs: Additional metadata (e.g., time_spent, confidence).
        """
        profile = self._get_or_create_user(user_id)

        if result == "understood":
            if topic not in profile.strong_areas and topic not in profile.weak_areas:
                profile.strong_areas.append(topic)
        elif result == "confused":
            if topic not in profile.weak_areas:
                profile.weak_areas.append(topic)
            if topic in profile.strong_areas:
                profile.strong_areas.remove(topic)
        elif result == "mastered":
            if topic in profile.weak_areas:
                profile.weak_areas.remove(topic)
            if topic not in profile.strong_areas:
                profile.strong_areas.append(topic)

        profile.proficiency_level = self._get_user_proficiency_level(user_id)

    def get_learning_profile(self, user_id: str) -> Dict[str, Any]:
        """
        Retrieve a user's full learning profile for analytics or debugging.

        Args:
            user_id: The user identifier.

        Returns:
            Dict with proficiency level, weak/strong areas, interaction count, and history.
        """
        profile = self._get_or_create_user(user_id)

        return {
            "user_id": user_id,
            "proficiency_level": profile.proficiency_level,
            "weak_areas": profile.weak_areas,
            "strong_areas": profile.strong_areas,
            "interaction_count": len(profile.interaction_history),
            "last_active": profile.last_active,
            "topic_attempts": profile.attempts_count,
            "recent_interactions": [
                {
                    "timestamp": i.timestamp,
                    "query": i.query,
                    "type": i.response.get("type"),
                }
                for i in profile.interaction_history[-5:]
            ],
        }

    def reset_user(self, user_id: str) -> None:
        """Reset a user's entire learning profile (clear all memory)."""
        if user_id in self.user_profiles:
            del self.user_profiles[user_id]

    def export_profiles(self) -> Dict[str, Dict[str, Any]]:
        """Export all user profiles for persistence or analytics."""
        return {
            user_id: {
                "proficiency_level": profile.proficiency_level,
                "weak_areas": profile.weak_areas,
                "strong_areas": profile.strong_areas,
                "interaction_count": len(profile.interaction_history),
                "last_active": profile.last_active,
                "topic_attempts": profile.attempts_count,
            }
            for user_id, profile in self.user_profiles.items()
        }

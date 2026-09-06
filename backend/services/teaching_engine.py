"""Teaching engine for Socratic code guidance with adaptive learning memory."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.services.ai_engine import EVALUATE_SCHEMA, TEACH_SCHEMA, AIEngine
from backend.utils.context_budget import TOKEN_BUDGETS

# How long a teach session (question -> evaluate) stays recoverable by session_id.
SESSION_TTL = timedelta(hours=2)


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


@dataclass
class TeachSession:
    """Recovers a /ai/teach question's context for the matching /ai/teach/evaluate call,
    so the client only needs to echo back a session_id instead of resending everything."""

    session_id: str
    user_id: str
    question: str
    concept_focus: str
    difficulty: str
    root_dir: Optional[str] = None
    file_path: Optional[str] = None
    node_id: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


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
        self.sessions: Dict[str, TeachSession] = {}

    def _purge_expired_sessions(self) -> None:
        now = datetime.utcnow()
        expired = [
            session_id
            for session_id, session in self.sessions.items()
            if now - datetime.fromisoformat(session.created_at) > SESSION_TTL
        ]
        for session_id in expired:
            del self.sessions[session_id]

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
        max_tokens: int = 512,
        context: Optional[Dict[str, Any]] = None,
        file_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a single Socratic question + hint in a frontend-safe JSON shape.

        When context (from AIEngine.build_context) is given, the question is grounded
        in real retrieved code/graph relationships instead of the bare query string.
        """
        context_block = ""
        if context and context.get("chunks"):
            budgets = TOKEN_BUDGETS["teach"]
            context_block = self.ai_engine._format_context_block(
                context,
                max_chunk_tokens=budgets["chunks"],
                max_graph_tokens=budgets["graph"],
            )

        system_prompt = self.ai_engine._system_prompt("teach")
        prompt = (
            "Ask ONE Socratic question about the code, tailored to the concept focus "
            "and difficulty below.\n\n"
            + (f"File in focus: {file_path}\n\n" if file_path else "")
            + (f"Code context:\n{context_block}\n\n" if context_block else "")
            + "Rules:\n"
            "- Ask ONE Socratic question only\n"
            "- Reference a specific, real symbol (function/class/variable) from the code context or file when available\n"
            "- Hint must guide, not reveal the answer\n"
            "- Keep concise and tool-like\n\n"
            f"concept_focus: {concept_focus}\n"
            f"difficulty: {difficulty}\n"
            f"user_query: {query}\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        parsed = self.ai_engine._call_structured(
            messages,
            schema=TEACH_SCHEMA,
            tool_name="submit_question",
            task="teach",
            max_tokens=max_tokens,
        )
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

    def teaching_response(
        self,
        user_id: str,
        query: str,
        *,
        root_dir: Optional[str] = None,
        file_path: Optional[str] = None,
        node_id: Optional[str] = None,
        top_k: int = 5,
        escalate_on_repeat: bool = True,
        max_tokens: int = 512,
    ) -> Dict[str, Any]:
        """
        Generate a full Socratic teaching response, adapting based on user level and history.

        This is the main method: it analyzes the user, retrieves context, and returns
        a question + hint grounded in the selected file/node when given. Mints a
        session_id so the matching /ai/teach/evaluate call can recover this context
        without the client resending it.

        Args:
            user_id: The user identifier.
            query: The user's question.
            root_dir: Optional workspace root to scope retrieval to.
            file_path: Optional workspace-relative file the question should focus on.
            node_id: Optional graph node id the question should focus on.
            top_k: Number of context chunks to retrieve.
            escalate_on_repeat: If true, give more direct help after repeated attempts.
            max_tokens: Maximum tokens for the LLM response.

        Returns:
            Dict with session_id, question, hint, concept_focus, difficulty.
        """
        self._purge_expired_sessions()
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

        context: Optional[Dict[str, Any]] = None
        if root_dir or file_path or node_id:
            file_contents = self.ai_engine.read_source(file_path, root_dir)
            retrieval_seed = node_id or file_path or query
            retrieval_query = f"{retrieval_seed}\n\n{file_contents[:2000]}" if file_contents else retrieval_seed
            context = self.ai_engine.build_context(retrieval_query, top_k=top_k, root_dir=root_dir)

        response = self.generate_teach_payload(
            query,
            concept_focus=topic,
            difficulty=difficulty,
            max_tokens=max_tokens,
            context=context,
            file_path=file_path,
        )

        session_id = uuid.uuid4().hex
        self.sessions[session_id] = TeachSession(
            session_id=session_id,
            user_id=user_id,
            question=response.get("question", ""),
            concept_focus=response.get("concept_focus", topic),
            difficulty=response.get("difficulty", difficulty),
            root_dir=root_dir,
            file_path=file_path,
            node_id=node_id,
        )
        response["session_id"] = session_id

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
        session_id: Optional[str] = None,
        concept_focus: Optional[str] = None,
        difficulty: Optional[str] = None,
        root_dir: Optional[str] = None,
        file_path: Optional[str] = None,
        node_id: Optional[str] = None,
        max_tokens: int = 512,
    ) -> Dict[str, Any]:
        """Evaluate a user's answer to a Socratic question.

        When session_id matches a live /ai/teach session, concept_focus/difficulty/
        root_dir/file_path/node_id are recovered from it so the client doesn't need
        to resend them (explicit args still take precedence when given).

        Returns a frontend-safe JSON shape:
        {is_correct, score, feedback, ideal_answer, concept_focus, difficulty}
        """
        self._purge_expired_sessions()
        profile = self._get_or_create_user(user_id)
        session = self.sessions.get(session_id) if session_id else None

        focus = (
            concept_focus
            or (session.concept_focus if session else None)
            or self._infer_topic(question)
            or "general"
        ).strip() or "general"
        level = (
            difficulty
            or (session.difficulty if session else None)
            or profile.proficiency_level
            or "beginner"
        ).strip().lower()
        if level not in {"beginner", "intermediate", "advanced"}:
            level = "beginner"

        resolved_root_dir = root_dir or (session.root_dir if session else None)
        resolved_file_path = file_path or (session.file_path if session else None)
        resolved_node_id = node_id or (session.node_id if session else None)

        context: Optional[Dict[str, Any]] = None
        if resolved_root_dir or resolved_file_path or resolved_node_id:
            file_contents = self.ai_engine.read_source(resolved_file_path, resolved_root_dir)
            retrieval_seed = resolved_node_id or resolved_file_path or question
            retrieval_query = f"{retrieval_seed}\n\n{file_contents[:2000]}" if file_contents else retrieval_seed
            context = self.ai_engine.build_context(retrieval_query, top_k=5, root_dir=resolved_root_dir)

        context_block = ""
        if context and context.get("chunks"):
            budgets = TOKEN_BUDGETS["evaluate"]
            context_block = self.ai_engine._format_context_block(
                context,
                max_chunk_tokens=budgets["chunks"],
                max_graph_tokens=budgets["graph"],
            )

        # Session served its purpose once evaluated; drop it so the sessions dict
        # stays bounded to sessions still in progress.
        if session_id and session_id in self.sessions:
            del self.sessions[session_id]

        system_prompt = self.ai_engine._system_prompt("teach")
        prompt = (
            "Evaluate the user's answer to the Socratic question below.\n\n"
            + (f"Code context:\n{context_block}\n\n" if context_block else "")
            + "Rules:\n"
            "- score must be between 0.0 and 1.0\n"
            "- feedback: 2-6 concise sentences, actionable\n"
            "- ideal_answer: 1-3 sentences, no code blocks\n"
            "- do not mention analysis process or LLM behavior\n\n"
            f"concept_focus: {focus}\n"
            f"difficulty: {level}\n\n"
            f"Question: {question}\n\n"
            f"User answer: {user_answer}\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        parsed = self.ai_engine._call_structured(
            messages,
            schema=EVALUATE_SCHEMA,
            tool_name="submit_evaluation",
            task="evaluate",
            max_tokens=max_tokens,
        )
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

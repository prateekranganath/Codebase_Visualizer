import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, teachEvaluate } from '../api';
import type { TeachEvaluateResponseModel, TeachingResponseModel } from '../types/backend';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type TeachExchange = {
  sessionId: string;
  question: string;
  hint: string;
  conceptFocus: string;
  difficulty: Difficulty;
  answer?: string;
  evaluation?: TeachEvaluateResponseModel;
};

type UseTeachSessionParams = {
  teaching: TeachingResponseModel | null;
  userId?: string;
  rootDir: string;
  filePath: string | null;
  nodeId: string | null;
  resetKey: string | null;
};

// Drives the answer -> evaluate -> next-question loop on top of useAiWorkspace's
// refreshTeach (which only fetches a new question). teaching's new session_id feeds
// in here to append an exchange; submitAnswer spends the matching /ai/teach/evaluate
// call, which is not cached server-side by design (interactive, not stale-safe).
export function useTeachSession({ teaching, userId = 'local-developer', rootDir, filePath, nodeId, resetKey }: UseTeachSessionParams) {
  const [history, setHistory] = useState<TeachExchange[]>([]);
  const [answer, setAnswer] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const lastSessionIdRef = useRef<string | null>(null);
  const resetKeyRef = useRef<string | null>(resetKey);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }
    resetKeyRef.current = resetKey;
    setHistory([]);
    setAnswer('');
    setError(null);
    lastSessionIdRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (!teaching || teaching.session_id === lastSessionIdRef.current) {
      return;
    }
    lastSessionIdRef.current = teaching.session_id;
    setHistory((prev) => [
      ...prev,
      {
        sessionId: teaching.session_id,
        question: teaching.question,
        hint: teaching.hint,
        conceptFocus: teaching.concept_focus,
        difficulty: teaching.difficulty,
      },
    ]);
    setAnswer('');
    setError(null);
  }, [teaching]);

  const current = useMemo(() => history[history.length - 1] ?? null, [history]);

  const submitAnswer = useCallback(async () => {
    if (!current || !answer.trim() || current.evaluation || evaluating) {
      return;
    }

    setEvaluating(true);
    setError(null);
    try {
      const result = await teachEvaluate({
        user_id: userId,
        session_id: current.sessionId,
        question: current.question,
        user_answer: answer.trim(),
        concept_focus: current.conceptFocus,
        difficulty: current.difficulty,
        root_dir: rootDir,
        file_path: filePath ?? undefined,
        node_id: nodeId ?? undefined,
      });
      setRateLimitedUntil(null);
      setHistory((prev) =>
        prev.map((exchange) =>
          exchange.sessionId === current.sessionId
            ? { ...exchange, answer: answer.trim(), evaluation: result }
            : exchange,
        ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.isRateLimited) {
        setRateLimitedUntil(Date.now() + (err.retryAfterSeconds ?? 30) * 1000);
      }
      setError(err instanceof Error ? err.message : 'Failed to evaluate answer');
    } finally {
      setEvaluating(false);
    }
  }, [current, answer, evaluating, userId, rootDir, filePath, nodeId]);

  return {
    history,
    current,
    answer,
    setAnswer,
    submitAnswer,
    evaluating,
    error,
    rateLimitedUntil,
  };
}

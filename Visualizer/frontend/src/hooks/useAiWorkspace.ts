import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, explainFile, getAiProvider, teachAi } from '../api';
import type { ExplainResponseModel, ProviderInfo, TeachingResponseModel } from '../types/backend';
import { useWorkspaceStore } from '../store/workspaceStore';

export type AiWorkspaceState = {
  explanation: ExplainResponseModel | null;
  teaching: TeachingResponseModel | null;
  provider: ProviderInfo | null;
  aiMessage: string;
  selectedMode: 'explain' | 'teach';
  rateLimitedUntil: number | null;
};

type UseAiWorkspaceParams = {
  projectRoot: string;
  selectedFile: string | null;
  selectedNodeId: string | null;
  selectedNodeLabel: string | null;
};

// Explain/teach are user-triggered only (via refreshExplain/refreshTeach) -- they used
// to auto-fire on every file selection, which burns ~2 requests per click against the
// free-tier 50/day budget for output nobody asked to see yet.
export function useAiWorkspace({ projectRoot, selectedFile, selectedNodeId, selectedNodeLabel }: UseAiWorkspaceParams) {
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const [explanation, setExplanation] = useState<ExplainResponseModel | null>(null);
  const [teaching, setTeaching] = useState<TeachingResponseModel | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [aiMessage, setAiMessage] = useState('Select Explain or Teach to analyze this file.');
  const [selectedMode, setSelectedMode] = useState<'explain' | 'teach'>('explain');
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const lastFetchedExplainFileRef = useRef<string | null>(null);
  const isFetchingExplainRef = useRef<boolean>(false);

  useEffect(() => {
    let active = true;

    async function loadProvider() {
      try {
        const providerInfo = await getAiProvider();
        if (!active) {
          return;
        }

        setProvider(providerInfo);
      } catch {
        if (!active) {
          return;
        }

        setProvider(null);
      }
    }

    void loadProvider();

    return () => {
      active = false;
    };
  }, []);

  // Clear stale results when the selection changes -- no network call, just avoids
  // showing file A's explanation while file B is selected.
  useEffect(() => {
    setExplanation(null);
    setTeaching(null);
    lastFetchedExplainFileRef.current = null;
    setAiMessage(selectedFile ? 'Select Explain or Teach to analyze this file.' : 'Select a file to get started.');
  }, [projectRoot, selectedFile]);

  const teachContext = useMemo(() => {
    const filePart = selectedFile ?? 'unknown file';
    const nodePart = selectedNodeLabel ?? 'unknown node';
    return `Teach me about ${filePart} and its graph node ${nodePart}. Ask one Socratic question, then provide a hint.`;
  }, [selectedFile, selectedNodeLabel]);

  const reportError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.isRateLimited) {
      setRateLimitedUntil(Date.now() + (error.retryAfterSeconds ?? 30) * 1000);
    }
    setAiMessage(error instanceof Error ? error.message : fallback);
  }, []);

  const refreshExplain = useCallback(async (force = false) => {
    if (!selectedFile) {
      return;
    }

    if (!force && lastFetchedExplainFileRef.current === selectedFile && explanation) {
      return;
    }

    if (isFetchingExplainRef.current) {
      return;
    }

    isFetchingExplainRef.current = true;
    setLoading('ai', true);
    setSelectedMode('explain');
    setAiMessage(`Explaining ${selectedFile}`);
    try {
      const response = await explainFile({
        root_dir: projectRoot,
        file_path: selectedFile,
        top_k: 5,
        max_tokens: 700,
        force_refresh: force,
      });
      setRateLimitedUntil(null);
      setExplanation(response);
      lastFetchedExplainFileRef.current = selectedFile;
      setAiMessage(response.summary || response.text || `Explanation ready for ${selectedFile}`);
    } catch (error) {
      reportError(error, 'Failed to refresh explanation');
    } finally {
      isFetchingExplainRef.current = false;
      setLoading('ai', false);
    }
  }, [projectRoot, selectedFile, explanation, setLoading, reportError]);

  const refreshTeach = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setLoading('ai', true);
    setSelectedMode('teach');
    setAiMessage(`Preparing a question about ${selectedFile}`);
    try {
      const response = await teachAi({
        root_dir: projectRoot,
        file_path: selectedFile,
        node_id: selectedNodeId ?? undefined,
        user_id: 'local-developer',
        query: teachContext,
        top_k: 5,
        escalate_on_repeat: true,
        max_tokens: 700,
      });
      setRateLimitedUntil(null);
      setTeaching(response);
      setAiMessage(response.question || 'Teaching response ready');
    } catch (error) {
      reportError(error, 'Failed to refresh teaching response');
    } finally {
      setLoading('ai', false);
    }
  }, [projectRoot, selectedFile, selectedNodeId, teachContext, setLoading, reportError]);

  return {
    explanation,
    teaching,
    provider,
    aiMessage,
    selectedMode,
    rateLimitedUntil,
    refreshExplain,
    refreshTeach,
  };
}

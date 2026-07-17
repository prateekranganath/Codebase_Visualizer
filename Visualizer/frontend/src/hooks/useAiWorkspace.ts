import { useCallback, useEffect, useMemo, useState } from 'react';
import { explainFile, getAiProvider, teachAi } from '../api';
import type { ExplainResponseModel, ProviderInfo, TeachingResponseModel } from '../types/backend';
import { useWorkspaceStore } from '../store/workspaceStore';

export type AiWorkspaceState = {
  explanation: ExplainResponseModel | null;
  teaching: TeachingResponseModel | null;
  provider: ProviderInfo | null;
  aiMessage: string;
  selectedMode: 'explain' | 'teach';
};

type UseAiWorkspaceParams = {
  projectRoot: string;
  selectedFile: string | null;
  selectedNodeLabel: string | null;
};

export function useAiWorkspace({ projectRoot, selectedFile, selectedNodeLabel }: UseAiWorkspaceParams) {
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const [explanation, setExplanation] = useState<ExplainResponseModel | null>(null);
  const [teaching, setTeaching] = useState<TeachingResponseModel | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [aiMessage, setAiMessage] = useState('AI context not loaded yet');
  const [selectedMode, setSelectedMode] = useState<'explain' | 'teach'>('explain');

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

  useEffect(() => {
    let active = true;

    async function loadExplanation() {
      if (!projectRoot || !selectedFile) {
        setExplanation(null);
        return;
      }

      setLoading('ai', true);
      setSelectedMode('explain');
      setAiMessage(`Explaining ${selectedFile}`);

      try {
        const response = await explainFile({ root_dir: projectRoot, file_path: selectedFile, top_k: 5, max_tokens: 700 });
        if (!active) {
          return;
        }

        setExplanation(response);
        setAiMessage(response.summary || response.text || `Explanation ready for ${selectedFile}`);
      } catch (error) {
        if (!active) {
          return;
        }

        setExplanation(null);
        setAiMessage(error instanceof Error ? error.message : 'Failed to load explanation');
      } finally {
        if (active) {
          setLoading('ai', false);
        }
      }
    }

    void loadExplanation();

    return () => {
      active = false;
    };
  }, [projectRoot, selectedFile, setLoading]);

  const teachContext = useMemo(() => {
    const filePart = selectedFile ?? 'unknown file';
    const nodePart = selectedNodeLabel ?? 'unknown node';
    return `Teach me about ${filePart} and its graph node ${nodePart}. Ask one Socratic question, then provide a hint.`;
  }, [selectedFile, selectedNodeLabel]);

  useEffect(() => {
    let active = true;

    async function loadTeaching() {
      if (!projectRoot || !selectedFile) {
        setTeaching(null);
        return;
      }

      try {
        const response = await teachAi({
          root_dir: projectRoot,
          user_id: 'local-developer',
          query: teachContext,
          top_k: 5,
          escalate_on_repeat: true,
          max_tokens: 700,
        });

        if (!active) {
          return;
        }

        setTeaching(response);
      } catch {
        if (!active) {
          return;
        }

        setTeaching(null);
      }
    }

    void loadTeaching();

    return () => {
      active = false;
    };
  }, [projectRoot, selectedFile, teachContext]);

  const refreshExplain = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setLoading('ai', true);
    setSelectedMode('explain');
    try {
      const response = await explainFile({ root_dir: projectRoot, file_path: selectedFile, top_k: 5, max_tokens: 700 });
      setExplanation(response);
      setAiMessage(response.summary || response.text || `Explanation ready for ${selectedFile}`);
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : 'Failed to refresh explanation');
    } finally {
      setLoading('ai', false);
    }
  }, [projectRoot, selectedFile, setLoading]);

  const refreshTeach = useCallback(async () => {
    if (!selectedFile) {
      return;
    }

    setLoading('ai', true);
    setSelectedMode('teach');
    try {
      const response = await teachAi({
        root_dir: projectRoot,
        user_id: 'local-developer',
        query: teachContext,
        top_k: 5,
        escalate_on_repeat: true,
        max_tokens: 700,
      });
      setTeaching(response);
      setAiMessage(response.guidance ?? response.explanation ?? 'Teaching response ready');
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : 'Failed to refresh teaching response');
    } finally {
      setLoading('ai', false);
    }
  }, [selectedFile, teachContext, setLoading]);

  return {
    explanation,
    teaching,
    provider,
    aiMessage,
    selectedMode,
    refreshExplain,
    refreshTeach,
  };
}

import { useEffect, useMemo, useState } from 'react';
import { ApiError, applyRefactor, proposeRefactor, validateRefactor } from '../api';
import type {
  RefactorApplyResponse,
  RefactorProposalResponse,
  RefactorValidationResponse,
} from '../types/backend';
import { useWorkspaceStore } from '../store/workspaceStore';

export type RefactorStep = 'idle' | 'analyze' | 'proposal' | 'diff' | 'validate' | 'apply';

type UseRefactorWorkspaceParams = {
  projectRoot: string;
  selectedFile: string | null;
  selectedContent: string;
  onApplySuccess?: () => void | Promise<void>;
};

export function useRefactorWorkspace({ projectRoot, selectedFile, selectedContent, onApplySuccess }: UseRefactorWorkspaceParams) {
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const currentRefactorTarget = useWorkspaceStore((state) => state.currentRefactorTarget) ?? selectedFile;
  const [goal, setGoal] = useState('Improve readability and reduce coupling');
  const [proposal, setProposal] = useState<RefactorProposalResponse | null>(null);
  const [validation, setValidation] = useState<RefactorValidationResponse | null>(null);
  const [applyResult, setApplyResult] = useState<RefactorApplyResponse | null>(null);
  const [refactorMessage, setRefactorMessage] = useState('No refactor proposal yet');
  const [proposedCode, setProposedCode] = useState('');
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  // Tracked explicitly instead of derived from which summary strings are non-empty
  // -- that derivation made 'analyze' unreachable (nothing ever produced a summary
  // during the loading phase) and couldn't tell 'proposal' apart from 'diff' (the
  // UI shows both together the moment a proposal arrives, so they advance together).
  const [step, setStep] = useState<RefactorStep>('idle');

  const reportError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.isRateLimited) {
      setRateLimitedUntil(Date.now() + (error.retryAfterSeconds ?? 30) * 1000);
    }
    setRefactorMessage(error instanceof Error ? error.message : fallback);
  };

  useEffect(() => {
    if (selectedFile && currentRefactorTarget !== selectedFile) {
      setProposedCode('');
      setProposal(null);
      setValidation(null);
      setApplyResult(null);
      setStep('idle');
      setRefactorMessage(`Ready to refactor ${selectedFile}`);
    }
  }, [selectedFile, currentRefactorTarget]);

  useEffect(() => {
    if (!selectedContent) {
      setProposedCode('');
    }
  }, [selectedContent]);

  const targetFile = useMemo(() => currentRefactorTarget || selectedFile, [currentRefactorTarget, selectedFile]);

  const runProposal = async (force = false) => {
    if (!projectRoot || !targetFile || !goal.trim()) {
      setRefactorMessage('Select a file and provide a refactor goal first.');
      return;
    }

    setLoading('refactor', true);
    setStep('analyze');
    setRefactorMessage(force ? `Regenerating refactor for ${targetFile}` : `Proposing refactor for ${targetFile}`);

    try {
      const response = await proposeRefactor({
        file_path: targetFile,
        goal: goal.trim(),
        root_dir: projectRoot,
        top_k: 5,
        force_refresh: force,
      });

      setRateLimitedUntil(null);
      setProposal(response);
      setProposedCode(response.suggested_code ?? '');
      setValidation(null);
      setApplyResult(null);
      setStep('diff');
      setRefactorMessage(response.reasoning ?? response.estimate ?? response.diff ?? 'Refactor proposal ready');
    } catch (error) {
      reportError(error, 'Failed to generate refactor proposal');
      setProposal(null);
      setProposedCode('');
      setStep('idle');
    } finally {
      setLoading('refactor', false);
    }
  };

  const runValidation = async () => {
    if (!projectRoot || !targetFile) {
      setRefactorMessage('Select a file before validating a refactor.');
      return;
    }

    const refactoredCode = proposedCode || proposal?.suggested_code;
    if (!refactoredCode) {
      setRefactorMessage('Generate a proposal before validating.');
      return;
    }

    setLoading('refactor', true);
    setStep('validate');
    setRefactorMessage(`Validating ${targetFile}`);

    try {
      const response = await validateRefactor({
        file_path: targetFile,
        original_code: selectedContent,
        refactored_code: refactoredCode,
        root_dir: projectRoot,
      });

      setValidation(response);
      setRefactorMessage(response.valid ? 'Validation passed' : 'Validation reported issues');
    } catch (error) {
      reportError(error, 'Failed to validate refactor');
      setValidation(null);
      setStep('diff');
    } finally {
      setLoading('refactor', false);
    }
  };

  const runApply = async () => {
    if (!projectRoot || !targetFile) {
      setRefactorMessage('Select a file before applying a refactor.');
      return;
    }

    const refactoredCode = proposedCode || proposal?.suggested_code;
    if (!refactoredCode) {
      setRefactorMessage('Generate a proposal before applying.');
      return;
    }

    setLoading('refactor', true);
    setStep('apply');
    setRefactorMessage(`Applying refactor to ${targetFile}`);

    try {
      const response = await applyRefactor({
        file_path: targetFile,
        new_code: refactoredCode,
        create_backup: true,
        root_dir: projectRoot,
      });

      setApplyResult(response);
      setRefactorMessage(response.summary ?? (response.success ? 'Refactor applied successfully' : 'Refactor apply finished'));

      // Trigger sync after successful apply
      if (onApplySuccess) {
        await onApplySuccess();
      }
    } catch (error) {
      reportError(error, 'Failed to apply refactor');
      setApplyResult(null);
      setStep(validation ? 'validate' : 'diff');
    } finally {
      setLoading('refactor', false);
    }
  };

  const validationSummary = useMemo(() => {
    if (!validation) {
      return '';
    }

    const parts = [
      `Valid: ${validation.valid ?? false}`,
      `Syntax: ${validation.syntax_ok ?? false}`,
      `Imports: ${validation.imports_ok ?? false}`,
    ];

    if (validation.breaking_changes?.length) {
      parts.push(`Breaking changes: ${validation.breaking_changes.join(', ')}`);
    }

    if (validation.affected_dependents?.length) {
      parts.push(`Dependents: ${validation.affected_dependents.join(', ')}`);
    }

    return parts.join('\n');
  }, [validation]);

  const proposalSummary = useMemo(() => {
    if (!proposal) {
      return '';
    }

    const parts = [proposal.reasoning, proposal.estimate, proposal.risks?.length ? `Risks: ${proposal.risks.join(', ')}` : '']
      .filter(Boolean)
      .join('\n\n');

    return parts || proposal.diff || proposal.suggested_code || '';
  }, [proposal]);

  const applySummary = useMemo(() => {
    if (!applyResult) {
      return '';
    }

    return [
      `Success: ${applyResult.success ?? false}`,
      applyResult.backup_path ? `Backup: ${applyResult.backup_path}` : '',
      applyResult.summary ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  }, [applyResult]);

  return {
    goal,
    setGoal,
    targetFile,
    proposal,
    validation,
    applyResult,
    refactorMessage,
    proposedCode,
    setProposedCode,
    proposalSummary,
    validationSummary,
    applySummary,
    rateLimitedUntil,
    step,
    runProposal,
    runValidation,
    runApply,
  };
}

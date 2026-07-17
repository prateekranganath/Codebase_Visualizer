import { useEffect, useMemo, useState } from 'react';
import { applyRefactor, proposeRefactor, validateRefactor } from '../api';
import type {
  RefactorApplyResponse,
  RefactorProposalResponse,
  RefactorValidationResponse,
} from '../types/backend';
import { useWorkspaceStore } from '../store/workspaceStore';

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

  useEffect(() => {
    if (selectedFile && currentRefactorTarget !== selectedFile) {
      setProposedCode('');
      setProposal(null);
      setValidation(null);
      setApplyResult(null);
      setRefactorMessage(`Ready to refactor ${selectedFile}`);
    }
  }, [selectedFile, currentRefactorTarget]);

  useEffect(() => {
    if (!selectedContent) {
      setProposedCode('');
    }
  }, [selectedContent]);

  const targetFile = useMemo(() => currentRefactorTarget || selectedFile, [currentRefactorTarget, selectedFile]);

  const runProposal = async () => {
    if (!projectRoot || !targetFile || !goal.trim()) {
      setRefactorMessage('Select a file and provide a refactor goal first.');
      return;
    }

    setLoading('refactor', true);
    setRefactorMessage(`Proposing refactor for ${targetFile}`);

    try {
      const response = await proposeRefactor({
        file_path: targetFile,
        goal: goal.trim(),
        top_k: 5,
      });

      setProposal(response);
      setProposedCode(response.suggested_code ?? '');
      setValidation(null);
      setApplyResult(null);
      setRefactorMessage(response.reasoning ?? response.estimate ?? response.diff ?? 'Refactor proposal ready');
    } catch (error) {
      setRefactorMessage(error instanceof Error ? error.message : 'Failed to generate refactor proposal');
      setProposal(null);
      setProposedCode('');
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
    setRefactorMessage(`Validating ${targetFile}`);

    try {
      const response = await validateRefactor({
        file_path: targetFile,
        original_code: selectedContent,
        refactored_code: refactoredCode,
      });

      setValidation(response);
      setRefactorMessage(response.valid ? 'Validation passed' : 'Validation reported issues');
    } catch (error) {
      setRefactorMessage(error instanceof Error ? error.message : 'Failed to validate refactor');
      setValidation(null);
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
    setRefactorMessage(`Applying refactor to ${targetFile}`);

    try {
      const response = await applyRefactor({
        file_path: targetFile,
        new_code: refactoredCode,
        create_backup: true,
      });

      setApplyResult(response);
      setRefactorMessage(response.summary ?? (response.success ? 'Refactor applied successfully' : 'Refactor apply finished'));
      
      // Trigger sync after successful apply
      if (onApplySuccess) {
        await onApplySuccess();
      }
    } catch (error) {
      setRefactorMessage(error instanceof Error ? error.message : 'Failed to apply refactor');
      setApplyResult(null);
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
    runProposal,
    runValidation,
    runApply,
  };
}

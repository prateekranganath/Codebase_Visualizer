import { useRef, useEffect } from 'react';
import { X, ChevronUp, CheckCircle, Circle, Loader } from 'lucide-react';
import { AiResponseSkeleton } from '../Skeleton';
import type { ExplainResponseModel, ProviderInfo, TeachingResponseModel } from '../../types/backend';

export type AIChatDrawerTab = 'explain' | 'teach' | 'refactor';

type RefactorStep = 'idle' | 'analyze' | 'proposal' | 'diff' | 'validate' | 'apply';

type AIChatDrawerProps = {
  open: boolean;
  activeTab: AIChatDrawerTab;
  onTabChange: (tab: AIChatDrawerTab) => void;
  onClose: () => void;

  // Context
  activeNodeLabel: string | null;
  activeFilePath: string | null;

  // Explain
  explanation: ExplainResponseModel | null;
  aiMessage: string;
  provider: ProviderInfo | null;
  loadingAi: boolean;
  onExplain: () => void;

  // Teach
  teaching: TeachingResponseModel | null;
  onTeach: () => void;

  // Refactor
  goal: string;
  onGoalChange: (g: string) => void;
  targetFile: string | null;
  proposalSummary: string;
  validationSummary: string;
  applySummary: string;
  diffText: string;
  refactorMessage: string;
  loadingRefactor: boolean;
  onPropose: () => void;
  onValidate: () => void;
  onApply: () => void;
};

const REFACTOR_STEPS: Array<{ key: RefactorStep; label: string }> = [
  { key: 'analyze',  label: 'Analyze'  },
  { key: 'proposal', label: 'Proposal' },
  { key: 'diff',     label: 'Diff'     },
  { key: 'validate', label: 'Validate' },
  { key: 'apply',    label: 'Apply'    },
];

function getRefactorStep(proposalSummary: string, validationSummary: string, applySummary: string): RefactorStep {
  if (applySummary)     return 'apply';
  if (validationSummary) return 'validate';
  if (proposalSummary)  return 'diff';
  return 'idle';
}

export default function AIChatDrawer({
  open,
  activeTab,
  onTabChange,
  onClose,
  activeNodeLabel,
  activeFilePath,
  explanation,
  aiMessage,
  provider,
  loadingAi,
  onExplain,
  teaching,
  onTeach,
  goal,
  onGoalChange,
  targetFile,
  proposalSummary,
  validationSummary,
  applySummary,
  diffText,
  refactorMessage,
  loadingRefactor,
  onPropose,
  onValidate,
  onApply,
}: AIChatDrawerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentStep = getRefactorStep(proposalSummary, validationSummary, applySummary);

  // Scroll to top when tab changes
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const contextLabel = activeNodeLabel ?? activeFilePath ?? 'No context selected';

  return (
    <div
      className={`ai-chat-drawer ${open ? 'ai-chat-drawer--open' : ''}`}
      role="complementary"
      aria-label="AI Chat Drawer"
      aria-hidden={!open}
    >
      {/* Handle bar */}
      <div className="ai-chat-drawer__handle-bar">
        <span className="ai-chat-drawer__handle" />

        {/* Tabs */}
        <div className="ai-chat-drawer__tabs" role="tablist">
          {(['explain', 'teach', 'refactor'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`ai-chat-drawer__tab ${activeTab === tab ? 'ai-chat-drawer__tab--active' : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {tab === 'explain' && '💡'}
              {tab === 'teach'   && '🎓'}
              {tab === 'refactor' && '⚡'}
              <span style={{ textTransform: 'capitalize' }}>{tab}</span>
            </button>
          ))}
        </div>

        {/* Context chip */}
        <div className="ai-chat-drawer__context">
          <span
            className="ai-chat-drawer__context-chip"
            title={contextLabel}
          >
            {activeNodeLabel ? '⬡ ' : '📄 '}
            {contextLabel}
          </span>
        </div>

        {/* Close */}
        <button
          type="button"
          className="ai-chat-drawer__close"
          onClick={onClose}
          aria-label="Close AI drawer"
        >
          <ChevronUp size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="ai-chat-drawer__body" ref={bodyRef} role="tabpanel">
        {/* ── EXPLAIN TAB ── */}
        {activeTab === 'explain' && (
          <>
            <div className="ai-chat-drawer__actions">
              <button
                type="button"
                className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                onClick={onExplain}
                disabled={loadingAi}
                aria-label="Refresh explanation"
              >
                {loadingAi ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : '💡'}
                {loadingAi ? 'Explaining…' : 'Explain'}
              </button>
              {provider && (
                <span className="ai-chat-drawer__provider">
                  {provider.provider} · {provider.model}
                </span>
              )}
            </div>

            {loadingAi ? (
              <AiResponseSkeleton />
            ) : !explanation ? (
              <div className="ai-chat-drawer__output-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
                <p style={{ margin: 0, fontSize: '0.86rem' }}>{aiMessage}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>
                  Click Explain to load AI analysis for the selected node or file.
                </p>
              </div>
            ) : (
              <>
                <div className="ai-chat-drawer__output-card">
                  <span className="ai-chat-drawer__output-title">Summary</span>
                  <p className="ai-chat-drawer__output-text">
                    {explanation.summary ?? explanation.text ?? 'No summary available.'}
                  </p>
                </div>

                {explanation.responsibilities?.length ? (
                  <div className="ai-chat-drawer__output-card">
                    <span className="ai-chat-drawer__output-title">Responsibilities</span>
                    <ul className="ai-chat-drawer__output-list">
                      {explanation.responsibilities.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                ) : null}

                {explanation.key_components?.length ? (
                  <div className="ai-chat-drawer__output-card">
                    <span className="ai-chat-drawer__output-title">Key Components</span>
                    <ul className="ai-chat-drawer__output-list">
                      {explanation.key_components.map((c) => (
                        <li key={c.name}><strong>{c.name}:</strong> {c.role}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {/* ── TEACH TAB ── */}
        {activeTab === 'teach' && (
          <>
            <div className="ai-chat-drawer__actions">
              <button
                type="button"
                className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                onClick={onTeach}
                disabled={loadingAi}
                aria-label="Refresh teaching"
              >
                {loadingAi ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : '🎓'}
                {loadingAi ? 'Loading…' : 'Ask Socratic Question'}
              </button>
            </div>

            {loadingAi ? (
              <AiResponseSkeleton />
            ) : !teaching ? (
              <div className="ai-chat-drawer__output-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
                <p style={{ margin: 0, fontSize: '0.86rem' }}>
                  Click above to get a Socratic teaching prompt about the selected code.
                </p>
              </div>
            ) : (
              <div className="ai-chat-drawer__output-card">
                <span className="ai-chat-drawer__output-title">Teaching</span>
                <p className="ai-chat-drawer__output-text">
                  {teaching.guidance ?? teaching.question ?? teaching.hint ?? teaching.explanation ?? 'No teaching response.'}
                </p>
              </div>
            )}
          </>
        )}

        {/* ── REFACTOR TAB ── */}
        {activeTab === 'refactor' && (
          <>
            {/* Stepper */}
            <div className="refactor-stepper">
              {REFACTOR_STEPS.map((step, i) => {
                const stepOrder: RefactorStep[] = ['analyze','proposal','diff','validate','apply'];
                const currentIdx = stepOrder.indexOf(currentStep);
                const thisIdx = i;
                const isDone   = currentStep !== 'idle' && thisIdx < currentIdx;
                const isActive = (currentStep === step.key) ||
                  (currentStep === 'idle' && i === 0);
                return (
                  <span key={step.key} style={{ display: 'contents' }}>
                    <span
                      className={`refactor-stepper__step ${isDone ? 'refactor-stepper__step--done' : isActive ? 'refactor-stepper__step--active' : ''}`}
                    >
                      <span className="refactor-stepper__circle">
                        {isDone ? <CheckCircle size={11} /> : isActive ? <Circle size={11} style={{ fill: 'currentColor' }} /> : <span>{i + 1}</span>}
                      </span>
                      <span>{step.label}</span>
                    </span>
                    {i < REFACTOR_STEPS.length - 1 && (
                      <span className={`refactor-stepper__connector ${isDone ? 'refactor-stepper__connector--done' : ''}`} />
                    )}
                  </span>
                );
              })}
            </div>

            {/* Target file */}
            {targetFile && (
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📄</span>
                <span style={{ color: 'var(--muted-strong)' }}>{targetFile}</span>
              </div>
            )}

            {/* Goal textarea */}
            <div>
              <label style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                Refactor Goal
              </label>
              <textarea
                className="refactor-textarea"
                value={goal}
                onChange={(e) => onGoalChange(e.target.value)}
                placeholder="Describe the refactor goal…"
                rows={3}
                disabled={loadingRefactor}
              />
            </div>

            {/* Action buttons */}
            <div className="ai-chat-drawer__actions">
              <button
                type="button"
                className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                onClick={onPropose}
                disabled={loadingRefactor || !goal.trim()}
                aria-label="Generate refactor proposal"
              >
                {loadingRefactor ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : '⚡'}
                Propose
              </button>
              <button
                type="button"
                className="ai-chat-drawer__action-btn"
                onClick={onValidate}
                disabled={loadingRefactor || !proposalSummary}
                aria-label="Validate refactor proposal"
              >
                Validate
              </button>
              <button
                type="button"
                className="ai-chat-drawer__action-btn"
                onClick={onApply}
                disabled={loadingRefactor || !proposalSummary}
                style={{ borderColor: 'rgba(24,214,155,0.4)', color: 'var(--accent-3)' }}
                aria-label="Apply refactor"
              >
                Apply
              </button>
            </div>

            {/* Summary grid */}
            {(proposalSummary || validationSummary || applySummary) && (
              <div className="refactor-summary-grid">
                <div className="refactor-summary-card">
                  <h3>Proposal</h3>
                  <pre>{proposalSummary || '—'}</pre>
                </div>
                <div className="refactor-summary-card">
                  <h3>Validation</h3>
                  <pre>{validationSummary || '—'}</pre>
                </div>
                <div className="refactor-summary-card">
                  <h3>Apply</h3>
                  <pre>{applySummary || '—'}</pre>
                </div>
              </div>
            )}

            {/* Diff viewer */}
            {diffText && (
              <div>
                <span className="ai-chat-drawer__output-title">Diff Preview</span>
                <pre className="refactor-diff">{diffText}</pre>
              </div>
            )}

            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: '0.8rem' }}>
              <span className={`status-dot ${loadingRefactor ? 'status-dot--loading' : 'status-dot--success'}`} />
              {refactorMessage}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

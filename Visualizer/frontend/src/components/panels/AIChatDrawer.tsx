import { useRef, useEffect, useState } from 'react';
import { X, ChevronUp, CheckCircle, Circle, Loader, Clock } from 'lucide-react';
import { AiResponseSkeleton } from '../Skeleton';
import DiffView from '../diff/DiffView';
import type { ExplainResponseModel, ProviderInfo, TeachingResponseModel } from '../../types/backend';
import type { RefactorStep } from '../../hooks/useRefactorWorkspace';
import type { TeachExchange } from '../../hooks/useTeachSession';

export type AIChatDrawerTab = 'explain' | 'teach' | 'refactor';

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
  onRegenerateExplain: () => void;
  aiRateLimitedUntil: number | null;

  // Teach
  teaching: TeachingResponseModel | null;
  onTeach: () => void;
  teachHistory: TeachExchange[];
  teachAnswer: string;
  onTeachAnswerChange: (value: string) => void;
  onSubmitTeachAnswer: () => void;
  teachEvaluating: boolean;
  teachError: string | null;

  // Refactor
  goal: string;
  onGoalChange: (g: string) => void;
  targetFile: string | null;
  proposalSummary: string;
  validationSummary: string;
  applySummary: string;
  diffText: string;
  proposalCached: boolean;
  refactorStep: RefactorStep;
  refactorMessage: string;
  loadingRefactor: boolean;
  refactorRateLimitedUntil: number | null;
  onPropose: () => void;
  onRegenerateProposal: () => void;
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

const REFACTOR_STEP_ORDER: RefactorStep[] = ['analyze', 'proposal', 'diff', 'validate', 'apply'];

function RateLimitBanner({ until }: { until: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);

  if (!until) {
    return null;
  }

  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  if (remaining <= 0) {
    return null;
  }

  return (
    <div className="rate-limit-banner" role="status">
      <Clock size={13} />
      <span>Rate limited by the LLM provider — retry in {remaining}s</span>
    </div>
  );
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
  onRegenerateExplain,
  aiRateLimitedUntil,
  teaching,
  onTeach,
  teachHistory,
  teachAnswer,
  onTeachAnswerChange,
  onSubmitTeachAnswer,
  teachEvaluating,
  teachError,
  goal,
  onGoalChange,
  targetFile,
  proposalSummary,
  validationSummary,
  applySummary,
  diffText,
  proposalCached,
  refactorStep,
  refactorMessage,
  loadingRefactor,
  refactorRateLimitedUntil,
  onPropose,
  onRegenerateProposal,
  onValidate,
  onApply,
}: AIChatDrawerProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

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
            title={activeFilePath ? `${contextLabel} (${activeFilePath})` : contextLabel}
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
        {!activeNodeLabel && !activeFilePath && (
          <div className="ai-chat-drawer__output-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
            <p style={{ margin: 0, fontSize: '0.86rem' }}>Select a file or graph node to ask the AI about it.</p>
          </div>
        )}

        {/* ── EXPLAIN TAB ── */}
        {activeTab === 'explain' && (activeNodeLabel || activeFilePath) && (
          <>
            <RateLimitBanner until={aiRateLimitedUntil} />
            <div className="ai-chat-drawer__actions">
              <button
                type="button"
                className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                onClick={onExplain}
                disabled={loadingAi}
                aria-label="Explain this file or node"
              >
                {loadingAi ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : '💡'}
                {loadingAi ? 'Explaining…' : 'Explain'}
              </button>
              {explanation && (
                <button
                  type="button"
                  className="ai-chat-drawer__action-btn"
                  onClick={onRegenerateExplain}
                  disabled={loadingAi}
                  aria-label="Regenerate explanation, bypassing the cache"
                  title="Regenerate (bypasses the cached result)"
                >
                  Regenerate
                </button>
              )}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span className="ai-chat-drawer__output-title">Summary</span>
                    {explanation.cached && (
                      <span className="ai-chat-drawer__cached-badge" title="Served from the server-side cache">cached</span>
                    )}
                  </div>
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

                {explanation.dependencies?.length ? (
                  <div className="ai-chat-drawer__output-card">
                    <span className="ai-chat-drawer__output-title">Dependencies</span>
                    <ul className="ai-chat-drawer__output-list">
                      {explanation.dependencies.map((d) => <li key={d}>{d}</li>)}
                    </ul>
                  </div>
                ) : null}

                {explanation.risks?.length ? (
                  <div className="ai-chat-drawer__output-card ai-chat-drawer__output-card--risk">
                    <span className="ai-chat-drawer__output-title">Risks</span>
                    <ul className="ai-chat-drawer__output-list">
                      {explanation.risks.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                ) : null}

                {explanation.insights?.length ? (
                  <div className="ai-chat-drawer__output-card">
                    <span className="ai-chat-drawer__output-title">Insights</span>
                    <ul className="ai-chat-drawer__output-list">
                      {explanation.insights.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}

        {/* ── TEACH TAB ── */}
        {activeTab === 'teach' && (activeNodeLabel || activeFilePath) && (
          <>
            <RateLimitBanner until={aiRateLimitedUntil} />
            <div className="ai-chat-drawer__actions">
              <button
                type="button"
                className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                onClick={onTeach}
                disabled={loadingAi}
                aria-label={teachHistory.length === 0 ? 'Ask a Socratic question' : 'Ask a new Socratic question'}
              >
                {loadingAi ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : '🎓'}
                {loadingAi ? 'Loading…' : teachHistory.length === 0 ? 'Ask Socratic Question' : 'New Question'}
              </button>
            </div>

            {loadingAi && teachHistory.length === 0 ? (
              <AiResponseSkeleton />
            ) : teachHistory.length === 0 ? (
              <div className="ai-chat-drawer__output-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
                <p style={{ margin: 0, fontSize: '0.86rem' }}>
                  Click above to get a Socratic teaching prompt about the selected code.
                </p>
              </div>
            ) : (
              <div className="teach-loop">
                {teachHistory.map((exchange, idx) => {
                  const isCurrent = idx === teachHistory.length - 1;
                  return (
                    <div key={exchange.sessionId} className="ai-chat-drawer__output-card teach-exchange">
                      <span className="ai-chat-drawer__output-title">Question {idx + 1}</span>
                      <p className="ai-chat-drawer__output-text" style={{ fontWeight: 500, fontSize: '0.94rem', lineHeight: '1.4' }}>
                        {exchange.question}
                      </p>
                      {exchange.hint && (
                        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                          <span className="ai-chat-drawer__output-title" style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Hint</span>
                          <p className="ai-chat-drawer__output-text" style={{ fontStyle: 'italic', color: 'var(--muted-strong)', fontSize: '0.86rem' }}>
                            {exchange.hint}
                          </p>
                        </div>
                      )}
                      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="navbar__badge" style={{ fontSize: '0.72rem', padding: '3px 8px', background: 'var(--bg-accent)', color: 'var(--text-strong)', borderRadius: '4px' }}>
                          📚 {exchange.conceptFocus}
                        </span>
                        <span className="navbar__badge" style={{ fontSize: '0.72rem', padding: '3px 8px', background: 'var(--bg-accent)', color: 'var(--text-strong)', borderRadius: '4px' }}>
                          ⚡ {exchange.difficulty}
                        </span>
                      </div>

                      {exchange.evaluation ? (
                        <div className={`teach-evaluation ${exchange.evaluation.is_correct ? 'teach-evaluation--correct' : 'teach-evaluation--incorrect'}`}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {exchange.evaluation.is_correct ? <CheckCircle size={14} /> : <Circle size={14} />}
                            <strong>Score: {Math.round(exchange.evaluation.score * 100)}%</strong>
                          </div>
                          <p className="ai-chat-drawer__output-text" style={{ marginTop: 6 }}>{exchange.evaluation.feedback}</p>
                          {exchange.evaluation.ideal_answer && (
                            <p style={{ marginTop: 6, fontSize: '0.82rem', color: 'var(--muted)' }}>
                              <strong>Ideal answer:</strong> {exchange.evaluation.ideal_answer}
                            </p>
                          )}
                          {isCurrent && (
                            <button
                              type="button"
                              className="ai-chat-drawer__action-btn"
                              style={{ marginTop: 10 }}
                              onClick={onTeach}
                              disabled={loadingAi}
                            >
                              Next question
                            </button>
                          )}
                        </div>
                      ) : isCurrent ? (
                        <div style={{ marginTop: '14px' }}>
                          <textarea
                            className="refactor-textarea"
                            value={teachAnswer}
                            onChange={(e) => onTeachAnswerChange(e.target.value)}
                            placeholder="Type your answer…"
                            rows={3}
                            disabled={teachEvaluating}
                          />
                          <button
                            type="button"
                            className="ai-chat-drawer__action-btn ai-chat-drawer__action-btn--primary"
                            style={{ marginTop: 8 }}
                            onClick={onSubmitTeachAnswer}
                            disabled={teachEvaluating || !teachAnswer.trim()}
                          >
                            {teachEvaluating ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                            {teachEvaluating ? 'Evaluating…' : 'Submit answer'}
                          </button>
                          {teachError && (
                            <p style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--danger)' }}>{teachError}</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── REFACTOR TAB ── */}
        {activeTab === 'refactor' && (
          <>
            <RateLimitBanner until={refactorRateLimitedUntil} />
            {/* Stepper */}
            <div className="refactor-stepper">
              {REFACTOR_STEPS.map((step, i) => {
                const currentIdx = REFACTOR_STEP_ORDER.indexOf(refactorStep);
                const isDone   = refactorStep !== 'idle' && i < currentIdx;
                const isActive = (refactorStep === step.key) ||
                  (refactorStep === 'idle' && i === 0);
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
              {proposalSummary && (
                <button
                  type="button"
                  className="ai-chat-drawer__action-btn"
                  onClick={onRegenerateProposal}
                  disabled={loadingRefactor || !goal.trim()}
                  title="Regenerate (bypasses the cached result)"
                >
                  Regenerate
                </button>
              )}
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
              {proposalCached && (
                <span className="ai-chat-drawer__cached-badge" title="Served from the server-side cache">cached</span>
              )}
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
                <DiffView diffText={diffText} />
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

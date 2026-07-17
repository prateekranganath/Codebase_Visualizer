import { AiResponseSkeleton } from '../Skeleton';
import type { ExplainResponseModel, ProviderInfo, TeachingResponseModel } from '../../types/backend';

type AiContextPanelProps = {
  activeNode: string;
  teachingPrompt: string;
  explanation: ExplainResponseModel | null;
  teaching: TeachingResponseModel | null;
  provider: ProviderInfo | null;
  aiMessage: string;
  selectedMode: 'explain' | 'teach';
  onExplain: () => void;
  onTeach: () => void;
  loading?: boolean;
};

export default function AiContextPanel({
  activeNode,
  teachingPrompt,
  explanation,
  teaching,
  provider,
  aiMessage,
  selectedMode,
  onExplain,
  onTeach,
  loading,
}: AiContextPanelProps) {
  return (
    <section className="context-panel">
      <div className="panel-header">
        <div>
          <div className="panel-header__eyebrow">Explain / Teach / Refactor</div>
          <h2>AI context</h2>
        </div>
        <span className="panel-pill">{activeNode}</span>
      </div>

      <div className="context-panel__card context-panel__card--accent">
        <h3>What is selected?</h3>
        <p>{teachingPrompt}</p>
        <div className="context-panel__meta-row">
          <span className={`context-panel__mode context-panel__mode--${selectedMode}`}>{selectedMode}</span>
          <span className="context-panel__status">{aiMessage}</span>
        </div>
      </div>

      <div className="context-panel__grid">
        <button type="button" className="context-panel__tile" onClick={onExplain}>
          <strong>Explain</strong>
          <span>Summarize code and dependencies</span>
        </button>
        <button type="button" className="context-panel__tile" onClick={onTeach}>
          <strong>Teach</strong>
          <span>Ask Socratic questions and hints</span>
        </button>
        <button type="button" className="context-panel__tile">
          <strong>Refactor</strong>
          <span>Propose safe change sets</span>
        </button>
      </div>

      <div className="context-panel__card">
        <h3>Live context</h3>
        <ul className="context-panel__list">
          <li>Open file tree and selected dependency graph node</li>
          <li>Backend context retrieval wired to current selection</li>
          <li>Refactor validation and diff preview surface here</li>
        </ul>
      </div>

      <div className="context-panel__card context-panel__card--output">
        {loading ? (
          <AiResponseSkeleton />
        ) : !explanation && !teaching ? (
          <div style={{ color: '#888', fontSize: '0.9rem', padding: '1rem', textAlign: 'center' }}>
            <p>Click Explain or Teach to load AI response</p>
          </div>
        ) : (
          <>
            <div className="context-panel__output-block">
              <div className="context-panel__output-title">Provider</div>
              <div className="context-panel__output-text">
                {provider ? `${provider.provider ?? 'unknown'} • ${provider.model ?? 'unknown model'}` : 'Provider unavailable'}
              </div>
            </div>
            {explanation && (
              <div className="context-panel__output-block">
                <div className="context-panel__output-title">Explanation</div>
                <p className="context-panel__output-text">{explanation.summary ?? explanation.text ?? 'No explanation text available.'}</p>
                {explanation.responsibilities?.length ? (
                  <div className="context-panel__output-text mt-2 text-sm text-slate-300">
                    <div className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-400">Responsibilities</div>
                    <ul className="mt-1 list-disc pl-5">
                      {explanation.responsibilities.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {explanation.key_components?.length ? (
                  <div className="context-panel__output-text mt-2 text-sm text-slate-300">
                    <div className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-400">Key components</div>
                    <ul className="mt-1 list-disc pl-5">
                      {explanation.key_components.map((item) => (
                        <li key={item.name}>
                          {item.name}: {item.role}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
            {teaching && (
              <div className="context-panel__output-block">
                <div className="context-panel__output-title">Teaching</div>
                <p className="context-panel__output-text">
                  {teaching.guidance ?? teaching.question ?? teaching.hint ?? teaching.explanation ?? 'No teaching response available.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

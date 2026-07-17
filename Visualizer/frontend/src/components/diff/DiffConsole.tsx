type DiffConsoleProps = {
  title: string;
  targetFile: string | null;
  goal: string;
  onGoalChange: (goal: string) => void;
  proposalSummary: string;
  validationSummary: string;
  applySummary: string;
  diffText: string;
  refactorMessage: string;
  loading: boolean;
  onPropose: () => void;
  onValidate: () => void;
  onApply: () => void;
};

export default function DiffConsole({
  title,
  targetFile,
  goal,
  onGoalChange,
  proposalSummary,
  validationSummary,
  applySummary,
  diffText,
  refactorMessage,
  loading,
  onPropose,
  onValidate,
  onApply,
}: DiffConsoleProps) {
  return (
    <section className="diff-console">
      <div className="panel-header">
        <div>
          <div className="panel-header__eyebrow">Diff Viewer / Console</div>
          <h2>{title}</h2>
          <p className="diff-console__subtitle">Target: {targetFile}</p>
        </div>
        <div className="diff-console__actions">
          <button type="button" className="panel-header__button" onClick={onPropose} disabled={loading}>
            Propose
          </button>
          <button type="button" className="panel-header__button" onClick={onValidate} disabled={loading}>
            Validate
          </button>
          <button type="button" className="panel-header__button panel-header__button--primary" onClick={onApply} disabled={loading}>
            Apply refactor
          </button>
        </div>
      </div>

      <div className="diff-console__body">
        <label className="diff-console__goal">
          <span>Refactor goal</span>
          <textarea value={goal} onChange={(event) => onGoalChange(event.target.value)} rows={3} placeholder="Describe the refactor goal" />
        </label>

        <div className="diff-console__summary-grid">
          <div className="diff-console__summary-card">
            <h3>Proposal</h3>
            <pre>{proposalSummary || diffText || 'No proposal generated yet.'}</pre>
          </div>
          <div className="diff-console__summary-card">
            <h3>Validation</h3>
            <pre>{validationSummary || 'Validation will appear here.'}</pre>
          </div>
          <div className="diff-console__summary-card">
            <h3>Apply</h3>
            <pre>{applySummary || 'Apply status will appear here.'}</pre>
          </div>
        </div>

        <div className="diff-console__status">
          <span className={`status-dot ${loading ? 'status-dot--loading' : 'status-dot--success'}`} />
          {refactorMessage}
        </div>
      </div>
    </section>
  );
}

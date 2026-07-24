import type { BackendConnectionState } from '../../store/workspaceStore';

type StatusBarProps = {
  framework?: string;
  language?: string;
  nodeCount: number;
  edgeCount: number;
  syncState: BackendConnectionState;
  syncMessage: string;
  syncing?: boolean;
  lastSynced?: string | null;
};

export default function StatusBar({
  framework,
  language,
  nodeCount,
  edgeCount,
  syncState,
  syncMessage,
  syncing,
  lastSynced,
}: StatusBarProps) {
  const dotClass = syncing
    ? 'status-bar__dot status-bar__dot--syncing'
    : syncState === 'online'
      ? 'status-bar__dot status-bar__dot--online'
      : syncState === 'offline'
        ? 'status-bar__dot status-bar__dot--offline'
        : 'status-bar__dot status-bar__dot--unknown';

  return (
    <div className="status-bar" role="status" aria-label="Workspace status">
      {framework && (
        <div className="status-bar__item">
          <span>Framework</span>
          <span className="status-bar__value">{framework}</span>
        </div>
      )}

      {language && (
        <div className="status-bar__item">
          <span>Language</span>
          <span className="status-bar__value">{language}</span>
        </div>
      )}

      <div className="status-bar__item">
        <span>Nodes</span>
        <span className="status-bar__value">{nodeCount}</span>
      </div>

      <div className="status-bar__item">
        <span>Edges</span>
        <span className="status-bar__value">{edgeCount}</span>
      </div>

      <div className="status-bar__spacer" />

      {lastSynced && (
        <div className="status-bar__item" style={{ color: 'var(--muted)' }}>
          <span>Synced</span>
          <span className="status-bar__value">
            {new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      <div className={`status-bar__item`}>
        <span className={dotClass} />
        <span className="status-bar__value">
          {syncing ? 'Syncing…' : syncMessage}
        </span>
      </div>
    </div>
  );
}

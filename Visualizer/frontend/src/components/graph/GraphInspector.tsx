import { X, GitBranch, ArrowRight, ArrowLeft } from 'lucide-react';
import GraphControls from './GraphControls';
import type { NodeMetadata } from './types';

type GraphInspectorProps = {
  open: boolean;
  nodeId: string | null;
  nodeLabel: string | null;
  nodeKind: string | null;
  nodePath?: string | null;
  metadata?: NodeMetadata | null;
  inEdges?: Array<{ id: string; label: string; kind?: string }>;
  outEdges?: Array<{ id: string; label: string; kind?: string }>;
  onClose: () => void;
  onOpenExplain: () => void;
  onOpenTeach: () => void;
  onOpenRefactor: () => void;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
  onResetFocus?: () => void;
  onExpandNeighborhood?: () => void;
};

function kindClass(kind: string | null | undefined) {
  const k = (kind ?? '').toLowerCase();
  if (k === 'module' || k === 'file' || k === 'package') return 'module';
  if (k === 'class') return 'class';
  if (k === 'function' || k === 'method') return 'function';
  return 'unknown';
}

export default function GraphInspector({
  open,
  nodeId,
  nodeLabel,
  nodeKind,
  nodePath,
  metadata,
  inEdges = [],
  outEdges = [],
  onClose,
  onOpenExplain,
  onOpenTeach,
  onOpenRefactor,
  showMinimap,
  onToggleMinimap,
  onResetFocus,
  onExpandNeighborhood,
}: GraphInspectorProps) {
  const kClass = kindClass(nodeKind);

  return (
    <aside
      className={`graph-inspector ${open ? 'graph-inspector--open' : ''}`}
      aria-label="Node inspector"
      aria-hidden={!open}
    >
      {/* Header */}
<div className="graph-inspector__header">

  <div className="graph-inspector__hero">

    <div
      className={`graph-inspector__hero-icon graph-inspector__hero-icon--${kClass}`}
    >
      <GitBranch size={18} />
    </div>

    <div className="graph-inspector__hero-content">

      <h2 className="graph-inspector__hero-title">
        {nodeLabel ?? "Unknown Node"}
      </h2>

      <div className="graph-inspector__hero-kind">
        {nodeKind ?? "Unknown"}
      </div>

      {nodePath && (
        <div className="graph-inspector__hero-path">
          {nodePath}
        </div>
      )}

    </div>

  </div>

  <button
    type="button"
    className="graph-inspector__close"
    onClick={onClose}
    aria-label="Close inspector"
  >
    <X size={15} />
  </button>

</div>

      {/* Body */}
      <div className="graph-inspector__body">
        
        {/* Overview */}

<div>

  <p className="graph-inspector__section-title">

    Overview

  </p>

  <div className="graph-inspector__overview-grid">

    <div className="graph-inspector__overview-card">

      <span>Complexity</span>

      <strong>

        {metadata?.complexity ?? "—"}

      </strong>

    </div>

    <div className="graph-inspector__overview-card">

      <span>Risk</span>

      <strong>

        {metadata?.risk ?? "Unknown"}

      </strong>

    </div>

    <div className="graph-inspector__overview-card">

      <span>Dependencies</span>

      <strong>

        {outEdges.length}

      </strong>

    </div>

    <div className="graph-inspector__overview-card">

      <span>Dependents</span>

      <strong>

        {inEdges.length}

      </strong>

    </div>

  </div>

</div>

        {/* AI Actions */}
        <div>
          <p className="graph-inspector__section-title">Ask AI</p>
          <div className="graph-inspector__ai-actions">
            <button
              type="button"
              className="graph-inspector__ai-btn graph-inspector__ai-btn--explain"
              onClick={onOpenExplain}
              aria-label="Explain this node"
            >
              <span style={{ fontSize: '1.1em' }}>💡</span>
              <span>Explain this node</span>
            </button>
            <button
              type="button"
              className="graph-inspector__ai-btn graph-inspector__ai-btn--teach"
              onClick={onOpenTeach}
              aria-label="Teach about this node"
            >
              <span style={{ fontSize: '1.1em' }}>🎓</span>
              <span>Teach me how it works</span>
            </button>
            <button
              type="button"
              className="graph-inspector__ai-btn graph-inspector__ai-btn--refactor"
              onClick={onOpenRefactor}
              aria-label="Refactor this node"
            >
              <span style={{ fontSize: '1.1em' }}>⚡</span>
              <span>Suggesting Refactor</span>
            </button>
          </div>
        </div>

        {/* Incoming edges */}
        {inEdges.length > 0 && (
          <div>
            <p className="graph-inspector__section-title">Used By ({inEdges.length})</p>
            <div className="graph-inspector__connections">
              {inEdges.slice(0, 8).map((edge) => (
                <div key={edge.id} className="graph-inspector__conn-item">
                  <span className="graph-inspector__conn-arrow graph-inspector__conn-arrow--in">
                    <ArrowLeft size={9} />
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {edge.label}
                  </span>
                  {edge.kind && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{edge.kind}</span>
                  )}
                </div>
              ))}
              {inEdges.length > 8 && (
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', padding: '0 2px' }}>
                  +{inEdges.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Outgoing edges */}
        {outEdges.length > 0 && (
          <div>
            <p className="graph-inspector__section-title">Uses ({outEdges.length})</p>
            <div className="graph-inspector__connections">
              {outEdges.slice(0, 8).map((edge) => (
                <div key={edge.id} className="graph-inspector__conn-item">
                  <span className="graph-inspector__conn-arrow graph-inspector__conn-arrow--out">
                    <ArrowRight size={9} />
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {edge.label}
                  </span>
                  {edge.kind && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{edge.kind}</span>
                  )}
                </div>
              ))}
              {outEdges.length > 8 && (
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)', padding: '0 2px' }}>
                  +{outEdges.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}
         {/* Details */}

<div>

  <p className="graph-inspector__section-title">
    Details
  </p>

  <div className="graph-inspector__meta-grid">

    {metadata?.language && (
      <div className="graph-inspector__meta-item">
        <span className="graph-inspector__meta-key">
          Language
        </span>

        <span className="graph-inspector__meta-value">
          {metadata.language}
        </span>
      </div>
    )}

    {metadata?.size != null && (
      <div className="graph-inspector__meta-item">
        <span className="graph-inspector__meta-key">
          Size
        </span>

        <span className="graph-inspector__meta-value">
          {metadata.size} B
        </span>
      </div>
    )}

    {metadata?.is_external != null && (
      <div className="graph-inspector__meta-item">
        <span className="graph-inspector__meta-key">
          External
        </span>

        <span className="graph-inspector__meta-value">
          {metadata.is_external ? "Yes" : "No"}
        </span>
      </div>
    )}

  </div>

</div>

        {inEdges.length === 0 && outEdges.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '0.82rem', textAlign: 'center', padding: '8px' }}>
            This node has no architectural relationships.
          </div>
        )}
      </div>

      <div className="graph-inspector__footer">
        <GraphControls
          selectedNodeId={nodeId}
          showMinimap={showMinimap}
          onToggleMinimap={onToggleMinimap}
          onResetFocus={onResetFocus}
          onExpandNeighborhood={onExpandNeighborhood}
        />
      </div>
    </aside>
  );
}

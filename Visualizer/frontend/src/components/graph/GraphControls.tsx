import { useState } from 'react';
import { useReactFlow } from 'reactflow';
import {
  Maximize2,
  Minus,
  Plus,
  ScanSearch,
  Search,
  X,
  Map,
  Crosshair,
  Network,
  AlignCenter,
} from 'lucide-react';
import { useGraphUiStore } from '../../store/graphUiStore';

type GraphToolbarProps = {
  onResetFocus?: () => void;
  onExpandNeighborhood?: () => void;
  selectedNodeId?: string | null;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
};

export default function GraphControls({
  onResetFocus,
  onExpandNeighborhood,
  selectedNodeId,
  showMinimap,
  onToggleMinimap,
}: GraphToolbarProps) {
  const reactFlow = useReactFlow();
  const graphLevel = useGraphUiStore((s) => s.graphLevel);
  const setGraphLevel = useGraphUiStore((s) => s.setGraphLevel);
  const focusedNodeId = useGraphUiStore((s) => s.focusedNodeId);
  const searchQuery = useGraphUiStore((s) => s.searchQuery);
  const setSearchQuery = useGraphUiStore((s) => s.setSearchQuery);

  const [searchOpen, setSearchOpen] = useState(false);

  const handleFocusNode = () => {
    const id = selectedNodeId ?? focusedNodeId;
    if (!id) return;
    const node = reactFlow.getNode(id);
    if (node) {
      reactFlow.setCenter(
        node.position.x + (node.width ?? 160) / 2,
        node.position.y + (node.height ?? 80) / 2,
        { duration: 280, zoom: 1.0 },
      );
    }
  };

  const handleAutoLayout = () => {
    reactFlow.fitView({ padding: 0.18, duration: 400 });
  };

  return (
    <div className="graph-toolbar" aria-label="Graph controls">
      {/* Search bar (toggles inline) */}
      {searchOpen && (
        <div className="graph-toolbar__group" style={{ flexDirection: 'row', alignItems: 'center', padding: '5px 8px' }}>
          <Search size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes…"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: '0.8rem',
              outline: 'none',
              width: 130,
            }}
            aria-label="Search graph nodes"
          />
          <button
            type="button"
            onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
            aria-label="Close search"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* View controls group */}
      <div className="graph-toolbar__group">
        <span className="graph-toolbar__label">View</span>

        <button
          type="button"
          className="graph-toolbar__btn"
          onClick={() => reactFlow.fitView({ padding: 0.18, duration: 320 })}
          title="Fit view (show all nodes)"
          aria-label="Fit view"
        >
          <Maximize2 size={14} />
        </button>

        <button
          type="button"
          className="graph-toolbar__btn"
          onClick={handleFocusNode}
          title="Focus selected node"
          aria-label="Focus node"
          disabled={!selectedNodeId && !focusedNodeId}
        >
          <Crosshair size={14} />
        </button>

        <button
          type="button"
          className="graph-toolbar__btn"
          onClick={handleAutoLayout}
          title="Auto layout"
          aria-label="Auto layout"
        >
          <AlignCenter size={14} />
        </button>

        {onExpandNeighborhood && (
          <button
            type="button"
            className="graph-toolbar__btn"
            onClick={onExpandNeighborhood}
            title="Expand neighborhood"
            aria-label="Expand neighborhood"
            disabled={!selectedNodeId && !focusedNodeId}
          >
            <Network size={14} />
          </button>
        )}

        <div className="graph-toolbar__separator" />

        <button
          type="button"
          className="graph-toolbar__btn"
          onClick={() => reactFlow.zoomIn({ duration: 220 })}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={14} />
        </button>

        <button
          type="button"
          className="graph-toolbar__btn"
          onClick={() => reactFlow.zoomOut({ duration: 220 })}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
      </div>

      {/* Tools group */}
      <div className="graph-toolbar__group">
        <span className="graph-toolbar__label">Tools</span>

        <button
          type="button"
          className={`graph-toolbar__btn ${searchOpen ? 'graph-toolbar__btn--active' : ''}`}
          onClick={() => setSearchOpen((o) => !o)}
          title="Search nodes"
          aria-label="Search nodes"
          aria-pressed={searchOpen}
        >
          <Search size={14} />
        </button>

        {onToggleMinimap && (
          <button
            type="button"
            className={`graph-toolbar__btn ${showMinimap ? 'graph-toolbar__btn--active' : ''}`}
            onClick={onToggleMinimap}
            title="Toggle minimap"
            aria-label="Toggle minimap"
            aria-pressed={showMinimap}
          >
            <Map size={14} />
          </button>
        )}

        {onResetFocus && (
          <button
            type="button"
            className="graph-toolbar__btn"
            onClick={onResetFocus}
            title="Reset focus / show all"
            aria-label="Reset focus"
          >
            <ScanSearch size={14} />
          </button>
        )}

        <div className="graph-toolbar__separator" />

        {/* Graph level */}
        <select
          className="graph-toolbar__select"
          value={graphLevel}
          onChange={(e) => setGraphLevel(Number(e.target.value) as 1 | 2 | 3)}
          aria-label="Graph detail level"
          title="Graph detail level"
        >
          <option value={1}>Modules</option>
          <option value={2}>Symbols</option>
          <option value={3}>Calls</option>
        </select>
      </div>
    </div>
  );
}

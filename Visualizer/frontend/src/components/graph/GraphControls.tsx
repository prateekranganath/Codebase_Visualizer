import { useReactFlow } from 'reactflow';
import { Maximize2, Minus, Plus, ScanSearch } from 'lucide-react';
import { useGraphUiStore } from '../../store/graphUiStore';

type GraphControlsProps = {
  onResetFocus?: () => void;
};

export default function GraphControls({ onResetFocus }: GraphControlsProps) {
  const reactFlow = useReactFlow();
  const graphLevel = useGraphUiStore((state) => state.graphLevel);
  const setGraphLevel = useGraphUiStore((state) => state.setGraphLevel);

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/80 p-2 text-xs text-slate-200 shadow-lg">
      <select
        aria-label="Graph detail level"
        className="h-8 rounded-full border border-slate-700/70 bg-slate-900/80 px-2 text-xs text-slate-200"
        value={graphLevel}
        onChange={(event) => setGraphLevel(Number(event.target.value) as 1 | 2 | 3)}
      >
        <option value={1}>Modules</option>
        <option value={2}>Symbols</option>
        <option value={3}>Calls</option>
      </select>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        className="grid h-8 w-8 place-items-center rounded-full border border-slate-700/70 hover:border-slate-400/70"
        onClick={() => reactFlow.zoomIn({ duration: 220 })}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        className="grid h-8 w-8 place-items-center rounded-full border border-slate-700/70 hover:border-slate-400/70"
        onClick={() => reactFlow.zoomOut({ duration: 220 })}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label="Fit graph"
        title="Fit graph"
        className="grid h-8 w-8 place-items-center rounded-full border border-slate-700/70 hover:border-slate-400/70"
        onClick={() => reactFlow.fitView({ padding: 0.2, duration: 320 })}
      >
        <Maximize2 size={14} />
      </button>
      {onResetFocus ? (
        <button
          type="button"
          aria-label="Reset focus"
          title="Reset focus"
          className="grid h-8 w-8 place-items-center rounded-full border border-slate-700/70 hover:border-slate-400/70"
          onClick={onResetFocus}
        >
          <ScanSearch size={14} />
        </button>
      ) : null}
    </div>
  );
}

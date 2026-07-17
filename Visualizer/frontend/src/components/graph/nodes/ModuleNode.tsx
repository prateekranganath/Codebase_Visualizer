import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';

export default function ModuleNode({ data, selected }: NodeProps<GraphNodeUiData>) {
  const risk = data.metadata?.risk ?? 'low';
  const riskTone =
    risk === 'high'
      ? 'border-red-400/70 text-red-200'
      : risk === 'medium'
        ? 'border-amber-300/70 text-amber-200'
        : 'border-emerald-300/70 text-emerald-200';

  return (
    <div
      className={`h-full w-full rounded-2xl border px-4 py-3 shadow-xl transition ${
        selected ? 'border-violet-300/80 ring-2 ring-violet-400/40' : 'border-slate-700/70'
      } ${data.isDimmed ? 'opacity-35' : 'opacity-100'} bg-transparent`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="rounded-xl border border-slate-800/70 bg-slate-950/80 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-slate-300/70">Module</div>
            <div className="mt-1 text-base font-semibold text-slate-100">{data.label}</div>
          </div>
          <div className={`rounded-full border px-2 py-1 text-xs ${riskTone}`}>{risk}</div>
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-300/70">
          <span>Deps: {data.dependencyCount ?? 0}</span>
          <span>Complexity: {data.metadata?.complexity ?? 0}</span>
        </div>
        <div className="mt-3 text-[0.7rem] uppercase tracking-[0.24em] text-slate-400/70">
          {data.isExpanded ? 'Collapse' : 'Expand'}
        </div>
      </div>
    </div>
  );
}

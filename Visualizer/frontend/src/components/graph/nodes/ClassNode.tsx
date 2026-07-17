import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';

export default function ClassNode({ data, selected }: NodeProps<GraphNodeUiData>) {
  const risk = data.metadata?.risk ?? 'low';
  const riskTone =
    risk === 'high'
      ? 'bg-red-500/15 text-red-200'
      : risk === 'medium'
        ? 'bg-amber-400/15 text-amber-200'
        : 'bg-emerald-400/15 text-emerald-200';

  return (
    <div
      className={`w-56 rounded-xl border px-3 py-2 shadow-lg transition ${
        selected ? 'border-sky-300/80 ring-2 ring-sky-400/40' : 'border-slate-700/70'
      } ${data.isDimmed ? 'opacity-35' : 'opacity-100'}`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        <span className="text-lg">◇</span>
        <div className="text-sm font-semibold text-slate-100">{data.label}</div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-300/70">
        <span className={`rounded-full px-2 py-0.5 ${riskTone}`}>{risk}</span>
        <span>Complexity {data.metadata?.complexity ?? 0}</span>
      </div>
      <div className="mt-2 text-[0.7rem] uppercase tracking-[0.2em] text-slate-400/70">
        {data.isExpanded ? 'Hide methods' : 'Show methods'}
      </div>
    </div>
  );
}

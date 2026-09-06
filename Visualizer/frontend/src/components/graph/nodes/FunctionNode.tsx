import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';

export default function FunctionNode({ data, selected }: NodeProps<GraphNodeUiData>) {
  const risk = data.metadata?.risk ?? 'low';
  const riskTone =
    risk === 'high'
      ? 'bg-red-400/20 text-red-100'
      : risk === 'medium'
        ? 'bg-amber-300/20 text-amber-100'
        : 'bg-emerald-300/20 text-emerald-100';

  return (
    <div
      className={`rounded-full border px-4 py-2 text-xs font-semibold shadow-md transition ${
        selected ? 'border-indigo-300/80 ring-2 ring-indigo-400/40' : 'border-slate-700/70'
      } ${data.isDimmed ? 'opacity-35' : 'opacity-100'}`}
      style={
        data.isSearchMatch
          ? { boxShadow: data.isSearchActive ? '0 0 0 3px rgba(250, 204, 21, 0.95)' : '0 0 0 2px rgba(250, 204, 21, 0.55)' }
          : undefined
      }
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-400">Fn</span>
        <span className="text-slate-100">{data.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[0.65rem] ${riskTone}`}>{risk}</span>
      </div>
    </div>
  );
}

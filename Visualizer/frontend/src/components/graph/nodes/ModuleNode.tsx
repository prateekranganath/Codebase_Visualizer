import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import type { NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';
import { DependencyBadges, NodeShell, riskOf } from './nodeChrome';

/** One source file. The unit users actually think in, so it gets the strongest card. */
export default function ModuleNode(props: NodeProps<GraphNodeUiData>) {
  const { data } = props;
  const Chevron = data.isExpanded ? ChevronDown : ChevronRight;
  const complexity = data.metadata?.complexity ?? 0;

  return (
    <NodeShell {...props} kind="module">
      <div className="gnode__header">
        {data.isContainer ? <Chevron size={13} className="gnode__chevron" /> : <span className="gnode__chevron-spacer" />}
        <FileCode2 size={13} className="gnode__icon" />
        <span className="gnode__title" title={data.path ?? data.label}>
          {data.label}
        </span>
        <DependencyBadges data={data} />
      </div>
      <div className="gnode__meta">
        <span className="gnode__kind">{data.isExternal ? 'external' : 'module'}</span>
        {complexity > 0 && <span className="gnode__stat">cx {complexity}</span>}
        {riskOf(data) !== 'low' && <span className="gnode__risk">{riskOf(data)}</span>}
        {!data.isExpanded && data.childCount ? <span className="gnode__count">{data.childCount}</span> : null}
      </div>
    </NodeShell>
  );
}

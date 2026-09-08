import { ChevronDown, ChevronRight, Box } from 'lucide-react';
import type { NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';
import { DependencyBadges, NodeShell, riskOf } from './nodeChrome';

export default function ClassNode(props: NodeProps<GraphNodeUiData>) {
  const { data } = props;
  const Chevron = data.isExpanded ? ChevronDown : ChevronRight;

  return (
    <NodeShell {...props} kind="class">
      <div className="gnode__header">
        {data.isContainer ? <Chevron size={12} className="gnode__chevron" /> : <span className="gnode__chevron-spacer" />}
        <Box size={12} className="gnode__icon" />
        <span className="gnode__title" title={data.label}>
          {data.label}
        </span>
        <DependencyBadges data={data} />
      </div>
      <div className="gnode__meta">
        <span className="gnode__kind">class</span>
        {riskOf(data) !== 'low' && <span className="gnode__risk">{riskOf(data)}</span>}
        {!data.isExpanded && data.childCount ? <span className="gnode__count">{data.childCount}</span> : null}
      </div>
    </NodeShell>
  );
}

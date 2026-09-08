import type { NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';
import { DependencyBadges, NodeShell } from './nodeChrome';

/** A leaf symbol. Pill-shaped so it never reads as a container. */
export default function FunctionNode(props: NodeProps<GraphNodeUiData>) {
  const { data } = props;

  return (
    <NodeShell {...props} kind="function">
      <div className="gnode__header">
        <span className="gnode__sigil">f</span>
        <span className="gnode__title" title={data.path ?? data.label}>
          {data.label}
        </span>
        <DependencyBadges data={data} />
      </div>
    </NodeShell>
  );
}

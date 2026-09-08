import { ChevronDown, ChevronRight, Folder, Package } from 'lucide-react';
import type { NodeProps } from 'reactflow';
import type { GraphNodeUiData } from '../types';
import { DependencyBadges, NodeShell } from './nodeChrome';

/**
 * A directory frame. Synthesized from module paths -- the backend has no
 * concept of one -- and drawn as a dashed container so it reads as a region
 * rather than as another box competing with the modules inside it.
 */
export default function FolderNode(props: NodeProps<GraphNodeUiData>) {
  const { data } = props;
  const Chevron = data.isExpanded ? ChevronDown : ChevronRight;
  const Icon = data.isExternal ? Package : Folder;

  return (
    <NodeShell {...props} kind="folder">
      <div className="gnode__header">
        <Chevron size={13} className="gnode__chevron" />
        <Icon size={13} className="gnode__icon" />
        <span className="gnode__title" title={data.path ?? data.label}>
          {data.label}
        </span>
        {!data.isExpanded && data.childCount ? (
          <span className="gnode__count">{data.childCount}</span>
        ) : null}
        <DependencyBadges data={data} />
      </div>
    </NodeShell>
  );
}

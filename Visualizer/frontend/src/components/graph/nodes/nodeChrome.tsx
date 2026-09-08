/**
 * Shared chrome for every canvas node.
 *
 * Kind is carried by shape and colour, so folder / module / class / function
 * stay distinguishable at any zoom: a dashed frame, a solid card with an accent
 * spine, a smaller card, and a pill. Risk is demoted to that spine instead of
 * competing with the name for attention, which is what the old badge did.
 */

import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { CanvasNodeKind, GraphNodeUiData, NodeRisk } from '../types';

export const KIND_LABEL: Record<CanvasNodeKind, string> = {
  folder: 'Folder',
  module: 'Module',
  class: 'Class',
  function: 'Function',
  unknown: 'Symbol',
};

export function riskOf(data: GraphNodeUiData): NodeRisk {
  return (data.metadata?.risk as NodeRisk) ?? 'low';
}

/** Class list every node shares, so state styling lives in exactly one place. */
export function shellClassName(kind: CanvasNodeKind, data: GraphNodeUiData, selected: boolean) {
  return [
    'gnode',
    `gnode--${kind}`,
    `gnode--risk-${riskOf(data)}`,
    selected || data.isSelected ? 'gnode--selected' : '',
    data.isDimmed ? 'gnode--dimmed' : '',
    data.isFocused ? 'gnode--focused' : '',
    data.isSearchMatch ? 'gnode--match' : '',
    data.isSearchActive ? 'gnode--match-active' : '',
    data.isExternal ? 'gnode--external' : '',
    data.isExpanded ? 'gnode--open' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

type NodeShellProps = NodeProps<GraphNodeUiData> & {
  kind: CanvasNodeKind;
  children: ReactNode;
};

export function NodeShell({ kind, data, selected, children }: NodeShellProps) {
  return (
    <div className={shellClassName(kind, data, Boolean(selected))}>
      <Handle type="target" position={Position.Top} className="gnode__handle" />
      <Handle type="source" position={Position.Bottom} className="gnode__handle" />
      {children}
    </div>
  );
}

/** Small in/out dependency counters, shown only when there is something to show. */
export function DependencyBadges({ data }: { data: GraphNodeUiData }) {
  const incoming = data.dependentCount ?? 0;
  const outgoing = data.dependencyCount ?? 0;
  if (incoming === 0 && outgoing === 0) return null;

  return (
    <span className="gnode__deps">
      {incoming > 0 && (
        <span className="gnode__dep gnode__dep--in" title={`${incoming} dependents`}>
          ←{incoming}
        </span>
      )}
      {outgoing > 0 && (
        <span className="gnode__dep gnode__dep--out" title={`${outgoing} dependencies`}>
          →{outgoing}
        </span>
      )}
    </span>
  );
}

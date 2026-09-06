import { useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import GraphCanvas from './GraphCanvas';
import GraphInspector from './GraphInspector';
import type { GraphNodeData, GraphEdgeData } from '../../types/backend';
import type { AIChatDrawerTab } from '../panels/AIChatDrawer';
import type { NodeMetadata } from './types';
import { useGraphUiStore } from '../../store/graphUiStore';

type GraphWorkspaceProps = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string, nodePath?: string) => void;
  onNodeOpen?: (nodeId: string) => void;
  loading?: boolean;
  onExpandNeighborhood?: (nodeId: string) => void;

  // Inspector open callback for AI chat
  onOpenAiDrawer: (tab: AIChatDrawerTab) => void;
};

function getMetadata(nodes: GraphNodeData[], nodeId: string | null): NodeMetadata | null {
  if (!nodeId) return null;
  const node = nodes.find((n) => n.id === nodeId);
  return (node?.metadata ?? null) as NodeMetadata | null;
}

function getNodeInfo(nodes: GraphNodeData[], nodeId: string | null) {
  if (!nodeId) return { label: null, kind: null, path: null };
  const node = nodes.find((n) => n.id === nodeId);
  return {
    label: node?.label ?? null,
    kind: node?.kind ?? null,
    path: node?.path ?? null,
  };
}

function buildEdgeLists(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[],
  nodeId: string | null,
) {
  if (!nodeId) return { inEdges: [], outEdges: [] };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const inEdges = edges
    .filter((e) => e.target === nodeId)
    .map((e) => ({
      id: e.id ?? `${e.source}-${e.target}`,
      label: nodeMap.get(e.source)?.label ?? e.source,
      kind: e.type ?? undefined,
    }));

  const outEdges = edges
    .filter((e) => e.source === nodeId)
    .map((e) => ({
      id: e.id ?? `${e.source}-${e.target}`,
      label: nodeMap.get(e.target)?.label ?? e.target,
      kind: e.type ?? undefined,
    }));

  return { inEdges, outEdges };
}

export default function GraphWorkspace({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  onNodeOpen,
  loading,
  onExpandNeighborhood,
  onOpenAiDrawer,
}: GraphWorkspaceProps) {
  const [showMinimap, setShowMinimap] = useState(false);
  const resetFocus = useGraphUiStore((s) => s.resetFocus);

  const inspectorOpen = Boolean(selectedNodeId);
  const { label, kind, path } = getNodeInfo(nodes, selectedNodeId);
  const metadata = getMetadata(nodes, selectedNodeId);
  const { inEdges, outEdges } = buildEdgeLists(nodes, edges, selectedNodeId);

  const handleExpandNeighborhood = selectedNodeId && onExpandNeighborhood
    ? () => onExpandNeighborhood(selectedNodeId)
    : undefined;

  const handleCloseInspector = () => {
    // Deselect node by calling onNodeSelect with empty — use pane click pattern
    // We'll just notify the parent to clear selection
    onNodeSelect('', undefined);
  };

  return (
    <ReactFlowProvider>
      <div className="graph-workspace">
        {/* Full-canvas graph */}
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
          onNodeOpen={onNodeOpen}
          loading={loading}
          showMinimap={showMinimap}
          onToggleMinimap={() => setShowMinimap((v) => !v)}
          onExpandNeighborhood={handleExpandNeighborhood}
        />

        {/* Contextual inspector — slides in from right on node select */}
        <GraphInspector
          open={inspectorOpen}
          nodeId={selectedNodeId}
          nodeLabel={label}
          nodeKind={kind}
          nodePath={path}
          metadata={metadata}
          inEdges={inEdges}
          outEdges={outEdges}
          onClose={handleCloseInspector}
          onOpenExplain={() => onOpenAiDrawer('explain')}
          onOpenTeach={() => onOpenAiDrawer('teach')}
          onOpenRefactor={() => onOpenAiDrawer('refactor')}
          showMinimap={showMinimap}
          onToggleMinimap={() => setShowMinimap((v) => !v)}
          onResetFocus={resetFocus}
          onExpandNeighborhood={handleExpandNeighborhood}
        />
      </div>
    </ReactFlowProvider>
  );
}

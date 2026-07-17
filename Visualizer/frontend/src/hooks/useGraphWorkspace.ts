import { useCallback, useEffect, useMemo, useState } from 'react';
import { exportGraph } from '../api';
import type { GraphEdgeData, GraphNodeData } from '../types/backend';
import { useWorkspaceStore } from '../store/workspaceStore';

type RawGraphNode = GraphNodeData & {
  type?: string;
  display_name?: string;
  risk?: string;
  complexity?: number;
  coupling?: number;
  is_external?: boolean;
};

type RawGraphEdge = Partial<GraphEdgeData> & {
  from?: string;
  to?: string;
  kind?: string;
};

export type GraphWorkspaceData = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  graphMessage: string;
};

function normalizeNodes(nodes: RawGraphNode[]): GraphNodeData[] {
  return nodes.map((node) => {
    const metadata = {
      ...(node.metadata ?? {}),
      risk: node.risk ?? node.metadata?.risk,
      complexity: node.complexity ?? node.metadata?.complexity,
      coupling: node.coupling ?? node.metadata?.coupling,
      is_external: node.is_external ?? node.metadata?.is_external,
    };

    return {
      ...node,
      label: node.label ?? node.display_name ?? node.id,
      kind: node.kind ?? node.type,
      metadata,
    };
  });
}

function normalizeEdgeKind(kind?: string) {
  const normalized = String(kind ?? '').toLowerCase();
  if (normalized === 'imports') {
    return 'import';
  }
  if (normalized === 'calls') {
    return 'call';
  }
  return normalized || undefined;
}

function normalizeEdges(edges: RawGraphEdge[]): GraphEdgeData[] {
  return edges
    .map((edge) => {
      const source = edge.source ?? edge.from ?? '';
      const target = edge.target ?? edge.to ?? '';
      const type = normalizeEdgeKind(edge.type ?? edge.kind) ?? 'unknown';
      return {
        id: edge.id ?? `${source}->${target}:${type}`,
        source,
        target,
        type,
        label: edge.label,
        weight: edge.weight,
      };
    })
    .filter((edge) => Boolean(edge.source && edge.target));
}

export function useGraphWorkspace(projectRoot: string, selectedNodeId: string | null, graphLevel: 1 | 2 | 3) {
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const [nodes, setNodes] = useState<GraphNodeData[]>([]);
  const [edges, setEdges] = useState<GraphEdgeData[]>([]);
  const [graphMessage, setGraphMessage] = useState('Graph not loaded yet');

  useEffect(() => {
    let active = true;

    async function loadGraph() {
      if (!projectRoot) {
        setNodes([]);
        setEdges([]);
        setGraphMessage('Set VITE_PROJECT_ROOT to load graph data.');
        return;
      }

      setLoading('graph', true);

      try {
        const response = await exportGraph(projectRoot, graphLevel);
        const sourceNodes = normalizeNodes((response.nodes ?? []) as RawGraphNode[]);
        const sourceEdges = normalizeEdges((response.edges ?? []) as RawGraphEdge[]);
        if (!active) {
          return;
        }

        setNodes(sourceNodes);
        setEdges(sourceEdges);
        setGraphMessage(
          `Loaded level ${response.graph_level ?? graphLevel} graph with ${sourceNodes.length} nodes and ${sourceEdges.length} edges`,
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setNodes([]);
        setEdges([]);
        setGraphMessage(error instanceof Error ? error.message : 'Failed to load graph data');
      } finally {
        if (active) {
          setLoading('graph', false);
        }
      }
    }

    void loadGraph();

    return () => {
      active = false;
    };
  }, [projectRoot, graphLevel, setLoading]);

  const selectedGraphNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null,
    [nodes, selectedNodeId],
  );

  const refreshGraph = useCallback(async () => {
    if (!projectRoot) {
      setGraphMessage('Cannot refresh: project root not configured');
      return;
    }

    setLoading('graph', true);
    setGraphMessage('Refreshing graph...');

    try {
      const response = await exportGraph(projectRoot, graphLevel);
      const sourceNodes = normalizeNodes((response.nodes ?? []) as RawGraphNode[]);
      const sourceEdges = normalizeEdges((response.edges ?? []) as RawGraphEdge[]);
      setNodes(sourceNodes);
      setEdges(sourceEdges);
      setGraphMessage(
        `Graph refreshed at level ${response.graph_level ?? graphLevel} with ${sourceNodes.length} nodes and ${sourceEdges.length} edges`,
      );
    } catch (error) {
      setGraphMessage(error instanceof Error ? error.message : 'Failed to refresh graph');
    } finally {
      setLoading('graph', false);
    }
  }, [projectRoot, graphLevel, setLoading]);

  return {
    nodes,
    edges,
    graphMessage,
    selectedGraphNode,
    refreshGraph,
  };
}

import { useEffect, useMemo } from 'react';
import 'reactflow/dist/style.css';
import ReactFlow, {
  Background,
  MarkerType,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
} from 'reactflow';
import dagre from 'dagre';
import type { GraphEdgeData, GraphNodeData } from '../../types/backend';
import { GraphSkeleton } from '../Skeleton';
import ModuleNode from './nodes/ModuleNode';
import ClassNode from './nodes/ClassNode';
import FunctionNode from './nodes/FunctionNode';
import GraphControls from './GraphControls';
import GraphLegend from './GraphLegend';
import GraphFilters from './GraphFilters';
import MinimapPanel from './MinimapPanel';
import type { GraphNodeKind, GraphNodeUiData, NodeMetadata } from './types';
import { useGraphUiStore } from '../../store/graphUiStore';

type GraphCanvasProps = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string, nodePath?: string) => void;
  onNodeOpen?: (nodeId: string) => void;
  loading?: boolean;
};

const nodeTypes = {
  module: ModuleNode,
  class: ClassNode,
  function: FunctionNode,
};

const NODE_SIZES: Record<string, { width: number; height: number }> = {
  module: { width: 520, height: 220 },
  class: { width: 220, height: 120 },
  function: { width: 160, height: 70 },
};

const MODULE_KINDS = new Set(['module', 'file', 'package']);
const CLASS_KINDS = new Set(['class']);
const FUNCTION_KINDS = new Set(['function', 'method']);
const CONTAINMENT_KINDS = new Set(['contains', 'containment', 'owns']);
const INHERITANCE_KINDS = new Set(['inherits', 'inheritance']);

function toKind(value?: string | null): GraphNodeKind {
  const normalized = String(value ?? '').toLowerCase();
  if (MODULE_KINDS.has(normalized)) {
    return 'module';
  }
  if (CLASS_KINDS.has(normalized)) {
    return 'class';
  }
  if (FUNCTION_KINDS.has(normalized)) {
    return 'function';
  }
  return 'unknown';
}

function getMetadata(node: GraphNodeData): NodeMetadata | undefined {
  return (node.metadata ?? {}) as NodeMetadata;
}

function isExternal(node: GraphNodeData) {
  return Boolean(getMetadata(node)?.is_external);
}

function isHighComplexity(node: GraphNodeData) {
  const complexity = getMetadata(node)?.complexity ?? 0;
  return complexity >= 10;
}

function matchesRiskFilter(node: GraphNodeData, riskFilter: 'all' | 'low' | 'medium' | 'high') {
  if (riskFilter === 'all') {
    return true;
  }

  const risk = getMetadata(node)?.risk ?? 'low';
  return risk === riskFilter;
}

function isModuleNode(node: GraphNodeData) {
  return toKind(node.kind) === 'module';
}

function isClassNode(node: GraphNodeData) {
  return toKind(node.kind) === 'class';
}

function isFunctionNode(node: GraphNodeData) {
  return toKind(node.kind) === 'function';
}

function findModuleAncestor(nodeId: string, parentById: Map<string, string>, nodeMap: Map<string, GraphNodeData>) {
  let currentId: string | undefined = nodeId;
  while (currentId) {
    const node = nodeMap.get(currentId);
    if (node && isModuleNode(node)) {
      return currentId;
    }
    currentId = parentById.get(currentId);
  }
  return null;
}

function layoutModules(
  moduleIds: string[],
  sizeById: Map<string, { width: number; height: number }>,
  edges: Array<{ source: string; target: string }>,
) {
  // Deduplicate edges — dagre can choke on parallel edges between the same pair.
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const key = `${e.source}||${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueEdges.length === 0) {
    return new Map(
      moduleIds.map((id, index) => {
        const cols = Math.max(1, Math.ceil(Math.sqrt(moduleIds.length)));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const size = sizeById.get(id) ?? NODE_SIZES.module;
        return [id, { x: col * (size.width + 80), y: row * (size.height + 60) }];
      }),
    );
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', ranksep: 120, nodesep: 80 });

  moduleIds.forEach((id) => {
    const size = sizeById.get(id) ?? NODE_SIZES.module;
    graph.setNode(id, { width: size.width, height: size.height });
  });

  uniqueEdges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  try {
    dagre.layout(graph);
  } catch {
    // Fall through to grid fallback below.
  }

  return new Map(
    moduleIds.map((id, index) => {
      const layout = graph.node(id);
      if (!layout || !Number.isFinite(layout.x) || !Number.isFinite(layout.y)) {
        const cols = Math.max(1, Math.ceil(Math.sqrt(moduleIds.length)));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const size = sizeById.get(id) ?? NODE_SIZES.module;
        return [id, { x: col * (size.width + 80), y: row * (size.height + 60) }];
      }
      const size = sizeById.get(id) ?? NODE_SIZES.module;
      return [id, { x: layout.x - size.width / 2, y: layout.y - size.height / 2 }];
    }),
  );
}

function layoutSubgraph(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
  nodeMap: Map<string, GraphNodeData>,
  options?: {
    sizeOverrides?: Map<string, { width: number; height: number }>;
    excludeIds?: Set<string>;
  },
) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 50 });

  nodeIds.forEach((id) => {
    const override = options?.sizeOverrides?.get(id);
    const node = nodeMap.get(id);
    const size = override ?? sizeForKind(node ? toKind(node.kind) : 'function');
    graph.setNode(id, { width: size.width, height: size.height });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;

  nodeIds.forEach((id) => {
    if (options?.excludeIds?.has(id)) {
      return;
    }
    const override = options?.sizeOverrides?.get(id);
    const node = nodeMap.get(id);
    const size = override ?? sizeForKind(node ? toKind(node.kind) : 'function');
    const layout = graph.node(id);
    const x = layout ? layout.x - size.width / 2 : 0;
    const y = layout ? layout.y - size.height / 2 : 0;
    positions.set(id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  });

  if (positions.size === 0) {
    minX = 0;
    minY = 0;
  }

  return {
    positions,
    bounds: {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
      minX,
      minY,
    },
  };
}

function sizeForKind(kind: GraphNodeKind) {
  if (kind === 'module') {
    return NODE_SIZES.module;
  }
  if (kind === 'class') {
    return NODE_SIZES.class;
  }
  return NODE_SIZES.function;
}

function buildNeighborhood(
  startId: string,
  edges: GraphEdgeData[],
  depth = 2,
) {
  const adjacency = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const from = edge.source;
    const to = edge.target;
    if (!from || !to) {
      return;
    }
    if (!adjacency.has(from)) {
      adjacency.set(from, new Set());
    }
    if (!adjacency.has(to)) {
      adjacency.set(to, new Set());
    }
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
  });

  const visited = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);

  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>();
    frontier.forEach((nodeId) => {
      const neighbors = adjacency.get(nodeId);
      if (!neighbors) {
        return;
      }
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      });
    });
    frontier = next;
  }

  return visited;
}

function buildParentMap(nodes: GraphNodeData[], edges: GraphEdgeData[]) {
  const parentById = new Map<string, string>();

  nodes.forEach((node) => {
    const metadataParent = getMetadata(node)?.parent_id;
    if (metadataParent) {
      parentById.set(node.id, metadataParent);
    }
  });

  edges.forEach((edge) => {
    const type = String(edge.type ?? "").toLowerCase();

    if (!CONTAINMENT_KINDS.has(type)) return;

    if (!parentById.has(edge.target)) {
        parentById.set(edge.target, edge.source);
    }
  });

  nodes.forEach((node) => {
    if (!parentById.has(node.id) && node.group) {
      parentById.set(node.id, node.group);
    }
  });

  return parentById;
}

function buildChildrenMap(parentById: Map<string, string>) {
  const children = new Map<string, string[]>();
  parentById.forEach((parentId, childId) => {
    const existing = children.get(parentId) ?? [];
    existing.push(childId);
    children.set(parentId, existing);
  });
  return children;
}

function GraphFlow({ nodes, edges, selectedNodeId, onNodeSelect, onNodeOpen }: GraphCanvasProps) {
  const {
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    highComplexityOnly,
    riskFilter,
    showExternal,
    searchQuery,
    expandedModules,
    expandedClasses,
    focusedNodeId,
    initializeGraphView,
    toggleModule,
    toggleClass,
    setFocusedNodeId,
    resetFocus,
  } = useGraphUiStore();
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    initializeGraphView(nodes);
  }, [initializeGraphView, nodes]);

  const { flowNodes, flowEdges } = useMemo(() => {
    const parentById = buildParentMap(nodes, edges);
    const childrenByParent = buildChildrenMap(parentById);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    const eligibleNodes = nodes.filter((node) => (showExternal ? true : !isExternal(node)));
    const eligibleMap = new Map(eligibleNodes.map((node) => [node.id, node]));

    const moduleNodes = eligibleNodes.filter((node) => {
      return isModuleNode(node);
    });
    const moduleIds = moduleNodes.map((node) => node.id);

    const candidateIds = new Set<string>(moduleIds);

    moduleNodes.forEach((moduleNode) => {
      if (!expandedModules[moduleNode.id]) {
        return;
      }

      const children = childrenByParent.get(moduleNode.id) ?? [];
      children.forEach((childId) => {
        const child = eligibleMap.get(childId);
        if (!child) {
          return;
        }

        const kind = toKind(child.kind);
        if (kind === 'function' && !showFunctions) {
          return;
        }

        candidateIds.add(childId);

        if (kind === 'class' && expandedClasses[childId]) {
          (childrenByParent.get(childId) ?? []).forEach((grandchildId) => {
            const grandchild = eligibleMap.get(grandchildId);
            if (!grandchild) {
              return;
            }
            const grandchildKind = toKind(grandchild.kind);
            if (grandchildKind === 'function' && !showFunctions) {
              return;
            }
            candidateIds.add(grandchildId);
          });
        }
      });
    });

    if (highComplexityOnly) {
      const highComplexityIds = new Set(
        eligibleNodes.filter((node) => isHighComplexity(node)).map((node) => node.id),
      );
      candidateIds.forEach((id) => {
        if (highComplexityIds.has(id)) {
          return;
        }
        const parentId = parentById.get(id);
        if (!parentId || !highComplexityIds.has(parentId)) {
          candidateIds.delete(id);
        }
      });
    }

    if (riskFilter !== 'all') {
      candidateIds.forEach((id) => {
        const node = eligibleMap.get(id);
        if (!node || !matchesRiskFilter(node, riskFilter)) {
          candidateIds.delete(id);
        }
      });
    }

    if (searchQuery.trim()) {
      const normalized = searchQuery.trim().toLowerCase();
      const searchMatches = new Set<string>();
      eligibleNodes.forEach((node) => {
        if (String(node.label ?? node.id).toLowerCase().includes(normalized)) {
          searchMatches.add(node.id);
        }
      });

      const expandedMatches = new Set<string>();
      searchMatches.forEach((id) => {
        expandedMatches.add(id);
        let parent = parentById.get(id);
        while (parent) {
          expandedMatches.add(parent);
          parent = parentById.get(parent);
        }
      });

      candidateIds.forEach((id) => {
        if (!expandedMatches.has(id)) {
          candidateIds.delete(id);
        }
      });
    }

    const visibleNodes = eligibleNodes.filter((node) => candidateIds.has(node.id));
    const filteredEdges = edges.filter((edge) => {
      const kind = String(edge.type ?? '').toLowerCase();
      const isImport = kind === 'import';
      const isCall = kind === 'call';
      const isInheritance = INHERITANCE_KINDS.has(kind);
      const isContainment = CONTAINMENT_KINDS.has(kind);

      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      const isSystemEdge =
        Boolean(sourceNode && targetNode && isModuleNode(sourceNode) && isModuleNode(targetNode)) &&
        (isImport || isInheritance);

      if (isImport && !showImports && !isSystemEdge) {
        return false;
      }
      if (isCall && !showCalls) {
        return false;
      }
      if (isInheritance && !showInheritance && !isSystemEdge) {
        return false;
      }

      if (!(isContainment || isInheritance || isImport || isCall)) {
        return false;
      }

      return candidateIds.has(edge.source) &&
       candidateIds.has(edge.target);
    });

    const related = focusedNodeId ? buildNeighborhood(focusedNodeId, filteredEdges, 2) : new Set<string>();

    let finalNodes = visibleNodes;
    let finalEdges = filteredEdges;
    if (focusedNodeId) {
      const focusOnlyIds = new Set<string>(related);
      related.forEach((id) => {
        let parent = parentById.get(id);
        while (parent) {
          focusOnlyIds.add(parent);
          parent = parentById.get(parent);
        }
      });
      finalNodes = visibleNodes.filter((node) => focusOnlyIds.has(node.id));
      finalEdges = filteredEdges.filter(
        (edge) => focusOnlyIds.has(edge.source) && focusOnlyIds.has(edge.target),
      );
    }

    const dependencyCounts = new Map<string, number>();
    finalEdges.forEach((edge) => {
      dependencyCounts.set(edge.source, (dependencyCounts.get(edge.source) ?? 0) + 1);
    });

    const moduleNodeIds = new Set(moduleIds);
    const moduleEdges: Array<{ source: string; target: string }> = [];
    edges.forEach((edge) => {
      const kind = String(edge.type ?? '').toLowerCase();
      const isImport = kind === 'import';
      const isInheritance = INHERITANCE_KINDS.has(kind);
      if (!isImport && !isInheritance) {
        return;
      }
      const fromModule = findModuleAncestor(edge.source, parentById, nodeMap);
      const toModule = findModuleAncestor(edge.target, parentById, nodeMap);
      if (!fromModule || !toModule || fromModule === toModule) {
        return;
      }
      if (!moduleNodeIds.has(fromModule) || !moduleNodeIds.has(toModule)) {
        return;
      }
      moduleEdges.push({ source: fromModule, target: toModule });
    });

    const moduleSizeById = new Map<string, { width: number; height: number }>();
    const moduleInternalLayout = new Map<
      string,
      {
        positions: Map<string, { x: number; y: number }>;
        bounds: { width: number; height: number; minX: number; minY: number };
      }
    >();

    moduleIds.forEach((moduleId) => {
      if (!expandedModules[moduleId]) {
        moduleSizeById.set(moduleId, { ...NODE_SIZES.module });
        return;
      }

      const internalNodeIds: string[] = [];
      const internalEdges: Array<{ source: string; target: string }> = [];

      (childrenByParent.get(moduleId) ?? []).forEach((childId) => {
        const child = eligibleMap.get(childId);
        if (!child) {
          return;
        }
        if (isFunctionNode(child) && !showFunctions) {
          return;
        }
        internalNodeIds.push(childId);

        if (isClassNode(child) && expandedClasses[childId]) {
          (childrenByParent.get(childId) ?? []).forEach((methodId) => {
            const method = eligibleMap.get(methodId);
            if (!method || !isFunctionNode(method) || !showFunctions) {
              return;
            }
            internalNodeIds.push(methodId);
          });
        }
      });

      const internalNodeSet = new Set(internalNodeIds);
      edges.forEach((edge) => {
        const kind = String(edge.type ?? '').toLowerCase();
        const isContainment = CONTAINMENT_KINDS.has(kind);
        const isCall = kind === 'call';
        const isInheritance = INHERITANCE_KINDS.has(kind);
        if (!(isContainment || isCall || isInheritance)) {
          return;
        }
        if (!internalNodeSet.has(edge.source) || !internalNodeSet.has(edge.target)) {
          return;
        }
        internalEdges.push({ source: edge.source, target: edge.target });
      });

      const virtualRootId = `${moduleId}::__root`;
      const incomingCount = new Map<string, number>();
      internalNodeIds.forEach((id) => incomingCount.set(id, 0));
      internalEdges.forEach((edge) => {
        incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
      });
      const rootEdges = internalNodeIds
        .filter((id) => (incomingCount.get(id) ?? 0) === 0)
        .map((id) => ({ source: virtualRootId, target: id }));

      const layout = layoutSubgraph(
        [...internalNodeIds, virtualRootId],
        [...internalEdges, ...rootEdges],
        nodeMap,
        {
          sizeOverrides: new Map([[virtualRootId, { width: 16, height: 16 }]]),
          excludeIds: new Set([virtualRootId]),
        },
      );
      moduleInternalLayout.set(moduleId, layout);

      const paddingX = 32;
      const paddingTop = 90;
      const paddingBottom = 28;
      const width = Math.max(layout.bounds.width + paddingX * 2, NODE_SIZES.module.width);
      const height = Math.max(layout.bounds.height + paddingTop + paddingBottom, NODE_SIZES.module.height);
      moduleSizeById.set(moduleId, { width, height });
    });

    const modulePositions = layoutModules(moduleIds, moduleSizeById, moduleEdges);
    const shouldDim = focusedNodeId ? (id: string) => !related.has(id) : () => false;
    const flowNodes: Node<GraphNodeUiData>[] = [];

    finalNodes.forEach((node) => {
      if (!moduleNodeIds.has(node.id)) {
        return;
      }

      const data: GraphNodeUiData = {
        label: node.label ?? node.id,
        kind: 'module',
        path: node.path,
        dependencyCount: dependencyCounts.get(node.id) ?? 0,
        isExpanded: Boolean(expandedModules[node.id]),
        isFocused: focusedNodeId === node.id,
        isRelated: related.has(node.id),
        isDimmed: shouldDim(node.id),
        metadata: getMetadata(node),
      };
      const position = modulePositions.get(node.id) ?? { x: 0, y: 0 };
      const size = moduleSizeById.get(node.id) ?? NODE_SIZES.module;
      flowNodes.push({
        id: node.id,
        type: 'module',
        data,
        position,
        draggable: false,
        selectable: true,
        selected: node.id === selectedNodeId,
        style: { width: size.width, height: size.height },
      });

      if (!expandedModules[node.id]) {
        return;
      }

      const layout = moduleInternalLayout.get(node.id);
      if (!layout) {
        return;
      }

      const paddingX = 32;
      const paddingTop = 90;
      const offsetX = paddingX - layout.bounds.minX;
      const offsetY = paddingTop - layout.bounds.minY;

      layout.positions.forEach((pos, childId) => {
        const child = eligibleMap.get(childId);
        if (!child) {
          return;
        }

        const kind = toKind(child.kind);
        const data: GraphNodeUiData = {
          label: child.label ?? child.id,
          kind,
          path: child.path,
          isExpanded: kind === 'class' ? Boolean(expandedClasses[child.id]) : undefined,
          isFocused: focusedNodeId === child.id,
          isRelated: related.has(child.id),
          isDimmed: shouldDim(child.id),
          metadata: getMetadata(child),
        };

        flowNodes.push({
          id: child.id,
          type: kind === 'class' ? 'class' : 'function',
          parentNode: node.id,
          extent: 'parent',
          data,
          position: { x: pos.x + offsetX, y: pos.y + offsetY },
          draggable: false,
          selectable: true,
          selected: child.id === selectedNodeId,
        });
      });
    });

    const flowEdges: Edge[] = finalEdges
      .map((edge) => {
        const kind = String(edge.type ?? '').toLowerCase();
        const isContainment = CONTAINMENT_KINDS.has(kind);
        const isImport = kind === 'import';
        const isCall = kind === 'call';
        const isInheritance = INHERITANCE_KINDS.has(kind);

        const isFocusedEdge = focusedNodeId != null && (edge.source === focusedNodeId || edge.target === focusedNodeId);

        return {
          id: edge.id ?? `${edge.source}-${edge.target}-${kind}`,
          source: edge.source ,
          target: edge.target,
          type: 'smoothstep',
          animated: isImport || isCall,
          markerEnd: isContainment
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                color: isImport
                  ? '#a5f3fc'
                  : isInheritance
                    ? '#e9a8ff'
                    : '#6ee7b7',
              },
          style: {
            stroke: isImport
              ? '#a5f3fc'
              : isInheritance
                ? '#e9a8ff'
                : isContainment
                  ? 'rgba(186, 201, 222, 0.85)'
                  : '#6ee7b7',
            strokeWidth: isContainment ? 2 : isCall ? 2.2 : 2.8,
            strokeDasharray: isImport ? '6 6' : isContainment ? '2 6' : undefined,
            opacity: isContainment ? 0.85 : isFocusedEdge ? 1 : 0.95,
            filter: isContainment ? 'none' : 'drop-shadow(0 0 8px rgba(165, 243, 252, 0.55))',
          },
        } as Edge;
      })
      .filter(Boolean) as Edge[];

    return { flowNodes, flowEdges };
  }, [
    nodes,
    edges,
    expandedModules,
    expandedClasses,
    focusedNodeId,
    highComplexityOnly,
    riskFilter,
    searchQuery,
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    showExternal,
    selectedNodeId,
  ]);

  const viewportKey = useMemo(
    () => `${flowNodes.map((node) => node.id).join('|')}::${flowEdges.map((edge) => edge.id).join('|')}`,
    [flowNodes, flowEdges],
  );

  useEffect(() => {
    if (!nodesInitialized || flowNodes.length === 0) {
      return;
    }

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.2, duration: 320 });
      });
      return;
    }

    reactFlow.fitView({ padding: 0.2, duration: 320 });
  }, [viewportKey, flowNodes.length, nodesInitialized, reactFlow]);

  const handleNodeClick = (_: unknown, node: Node<GraphNodeUiData>) => {
    onNodeSelect(node.id, node.data.path);
    const kind = node.data.kind;
    if (kind === 'module') {
      toggleModule(node.id);
    }
    if (kind === 'class') {
      toggleClass(node.id);
    }
    setFocusedNodeId(node.id);
    const target = reactFlow.getNode(node.id);
    if (target) {
      reactFlow.setCenter(target.position.x + 120, target.position.y + 80, { duration: 280, zoom: 0.9 });
    }
  };

  const handleNodeDoubleClick = (_: unknown, node: Node<GraphNodeUiData>) => {
    onNodeOpen?.(node.id);
  };

  return (
    <div className="absolute inset-0 min-h-0 min-w-0" style={{ width: '100%', height: '100%' }}>
      <div className="absolute left-6 right-6 top-6 z-20 flex flex-wrap items-center justify-between gap-3">
        <GraphFilters />
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-slate-700/70 bg-slate-950/80 px-3 py-1 text-xs text-slate-300">
            Nodes {flowNodes.length} · Edges {flowEdges.length}
          </div>
          <GraphControls onResetFocus={resetFocus} />
        </div>
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <GraphLegend />
      </div>

      <div className="absolute bottom-6 right-6 z-20">
        <MinimapPanel />
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={resetFocus}
        style={{ width: '100%', height: '100%' }}
      >
        <Background gap={24} color="rgba(124, 92, 255, 0.14)" />
      </ReactFlow>
    </div>
  );
}

export default function GraphCanvas({ nodes, edges, selectedNodeId, onNodeSelect, onNodeOpen, loading }: GraphCanvasProps) {
  if (loading) {
    return (
      <section className="graph-canvas">
        <div className="panel-header">
          <div>
            <div className="panel-header__eyebrow">Interactive Node Graph</div>
            <h2>Dependency map</h2>
          </div>
        </div>
        <div className="graph-canvas__surface">
          <GraphSkeleton />
        </div>
      </section>
    );
  }

  if (nodes.length === 0) {
    return (
      <section className="graph-canvas">
        <div className="panel-header">
          <div>
            <div className="panel-header__eyebrow">Interactive Node Graph</div>
            <h2>Dependency map</h2>
          </div>
        </div>
        <div className="graph-canvas__surface flex items-center justify-center text-center text-slate-400">
          <div>
            <p className="mb-2 text-sm">No graph data available</p>
            <p className="text-xs text-slate-500">Select a file or refresh the project</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="graph-canvas">
      <div className="panel-header">
        <div>
          <div className="panel-header__eyebrow">Interactive Node Graph</div>
          <h2>Dependency map</h2>
        </div>
      </div>

      <div className="graph-canvas__surface graph-flow">
        <ReactFlowProvider>
          <GraphFlow
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onNodeSelect={onNodeSelect}
            onNodeOpen={onNodeOpen}
          />
        </ReactFlowProvider>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'reactflow/dist/style.css';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
} from 'reactflow';
import { ChevronRight, Home } from 'lucide-react';
import type { GraphEdgeData, GraphNodeData } from '../../types/backend';
import ModuleNode from './nodes/ModuleNode';
import ClassNode from './nodes/ClassNode';
import FunctionNode from './nodes/FunctionNode';
import FolderNode from './nodes/FolderNode';
import GraphControls from './GraphControls';
import GraphLegend from './GraphLegend';
import GraphFilters from './GraphFilters';
import MinimapPanel from './MinimapPanel';
import type { GraphNodeUiData, NodeMetadata } from './types';
import { useGraphUiStore } from '../../store/graphUiStore';
import { buildGraphModel, type GraphModel, type ModelNode } from './layout/graphModel';
import { collapsedSize, layoutGraph } from './layout/layoutGraph';

type GraphCanvasProps = {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string, nodePath?: string) => void;
  onNodeOpen?: (nodeId: string) => void;
  loading?: boolean;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
  onExpandNeighborhood?: () => void;
};

const nodeTypes = {
  folder: FolderNode,
  module: ModuleNode,
  class: ClassNode,
  function: FunctionNode,
};

const EDGE_COLOR = {
  import: '#67e8f9',
  inherits: '#e9a8ff',
  call: '#6ee7b7',
} as const;

/** Auto-expanding every module is what made the first render the widest one. */
const AUTO_EXPAND_MODULE_LIMIT = 18;

/**
 * How deep to open folders on load, by project size. A large repo opened to the
 * same depth as a small one renders thousands of cards at a zoom where none of
 * them are readable, so big projects open as a shallower overview and the user
 * drills in from there.
 */
function autoExpandDepth(moduleCount: number): number {
  if (moduleCount <= 150) return 3;
  if (moduleCount <= 500) return 2;
  return 1;
}

/** Above this, hand off culling to React Flow instead of mounting everything. */
const VIRTUALIZE_ABOVE = 400;

function isHighComplexity(metadata: NodeMetadata) {
  return (metadata.complexity ?? 0) >= 10;
}

/**
 * Folders open, modules closed. The graph opens as an architecture overview and
 * the user drills in, rather than dumping every symbol on screen at once.
 */
function defaultExpansion(model: GraphModel): string[] {
  const expanded: string[] = [];
  const moduleCount = Array.from(model.nodes.values()).filter(
    (node) => node.kind === 'module' && !node.isExternal,
  ).length;
  const folderDepth = autoExpandDepth(moduleCount);

  const walk = (ids: string[], depth: number) => {
    ids.forEach((id) => {
      const node = model.nodes.get(id);
      if (!node) return;
      if (node.kind === 'folder' && depth < folderDepth) {
        expanded.push(id);
        walk(node.childIds, depth + 1);
      } else if (node.kind === 'module' && moduleCount <= AUTO_EXPAND_MODULE_LIMIT) {
        expanded.push(id);
      }
    });
  };

  walk(model.rootIds, 0);
  return expanded;
}

function GraphFlow({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  onNodeOpen,
  showMinimap,
  onToggleMinimap,
  onExpandNeighborhood,
}: GraphCanvasProps) {
  const {
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    highComplexityOnly,
    riskFilter,
    showExternal,
    searchQuery,
    searchActiveIndex,
    expanded,
    focusRootId,
    focusedNodeId,
    focusDepth,
    dimNonFocused,
    layoutNonce,
    toggleExpanded,
    setExpanded,
    expandAll,
    setFocusRootId,
    setFocusedNodeId,
    resetFocus,
    setSearchMatches,
  } = useGraphUiStore();

  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);

  // The packer targets the viewport's shape, so it has to know that shape.
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => buildGraphModel(nodes, edges), [nodes, edges]);

  // Identity of the underlying graph, not of the current view of it.
  const modelKey = useMemo(
    () => `${nodes.length}:${edges.length}:${nodes[0]?.id ?? ''}:${nodes[nodes.length - 1]?.id ?? ''}`,
    [nodes, edges],
  );

  useEffect(() => {
    if (model.nodes.size === 0) return;
    setExpanded(defaultExpansion(model));
  }, [modelKey, model, setExpanded]);

  const computed = useMemo(() => {
    const { nodes: modelNodes } = model;

    const passesOwnFilters = (node: ModelNode): boolean => {
      if (!showExternal && node.isExternal) return false;
      if (node.kind === 'folder') return true;
      if (!showFunctions && node.kind === 'function') return false;
      if (highComplexityOnly && !isHighComplexity(node.metadata)) return false;
      if (riskFilter !== 'all' && (node.metadata.risk ?? 'low') !== riskFilter) return false;
      return true;
    };

    // A folder earns its place only if something inside it survived the filters.
    const hasKeeper = new Map<string, boolean>();
    const subtreeHasKeeper = (id: string): boolean => {
      const cached = hasKeeper.get(id);
      if (cached !== undefined) return cached;
      const node = modelNodes.get(id);
      if (!node) return false;
      hasKeeper.set(id, false); // guard against a malformed cycle
      const keeper =
        (node.kind !== 'folder' && passesOwnFilters(node)) ||
        node.childIds.some(subtreeHasKeeper);
      hasKeeper.set(id, keeper);
      return keeper;
    };

    const scopeRoots = focusRootId && modelNodes.has(focusRootId) ? [focusRootId] : model.rootIds;

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const searchMatches = new Set<string>();
    if (normalizedQuery) {
      modelNodes.forEach((node) => {
        if (!passesOwnFilters(node)) return;
        if (node.label.toLowerCase().includes(normalizedQuery)) searchMatches.add(node.id);
      });
    }

    // Search reveals matches by opening whatever is hiding them, and never by
    // deleting the surrounding context.
    const effectiveExpanded = new Set(
      Object.entries(expanded)
        .filter(([, isOpen]) => isOpen)
        .map(([id]) => id),
    );
    if (focusRootId) effectiveExpanded.add(focusRootId);
    searchMatches.forEach((id) => {
      model.ancestorsOf(id).forEach((ancestorId) => effectiveExpanded.add(ancestorId));
    });

    const visible = new Set<string>();
    const descend = (ids: string[]) => {
      ids.forEach((id) => {
        const node = modelNodes.get(id);
        if (!node) return;
        if (node.kind === 'folder') {
          if (!showExternal && node.isExternal) return;
          if (!subtreeHasKeeper(id)) return;
        } else if (!passesOwnFilters(node)) {
          return;
        }
        visible.add(id);
        if (effectiveExpanded.has(id)) descend(node.childIds);
      });
    };
    descend(scopeRoots);

    const layout = layoutGraph({
      model,
      visible,
      expanded: effectiveExpanded,
      aspect,
    });

    // --- edges -------------------------------------------------------------
    const kindAllowed = (kind: 'import' | 'call' | 'inherits') => {
      if (kind === 'import') return showImports;
      if (kind === 'call') return showCalls;
      return showInheritance;
    };

    const isAncestorOf = (ancestorId: string, id: string) =>
      model.ancestorsOf(id).includes(ancestorId);

    type Aggregated = {
      source: string;
      target: string;
      kind: 'import' | 'call' | 'inherits';
      count: number;
    };
    const aggregated = new Map<string, Aggregated>();
    const outDegree = new Map<string, number>();
    const inDegree = new Map<string, number>();

    model.deps.forEach((dep) => {
      if (!kindAllowed(dep.kind)) return;
      const source = model.resolveVisible(dep.source, visible);
      const target = model.resolveVisible(dep.target, visible);
      if (!source || !target || source === target) return;
      // Containment is shown by nesting; an arrow from a box to something
      // drawn inside that same box is noise.
      if (isAncestorOf(source, target) || isAncestorOf(target, source)) return;

      const key = `${source}->${target}:${dep.kind}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      aggregated.set(key, { source, target, kind: dep.kind, count: 1 });
      outDegree.set(source, (outDegree.get(source) ?? 0) + 1);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    });

    // --- focus neighborhood ------------------------------------------------
    const related = new Set<string>();
    if (focusedNodeId && visible.has(focusedNodeId)) {
      const adjacency = new Map<string, Set<string>>();
      aggregated.forEach(({ source, target }) => {
        if (!adjacency.has(source)) adjacency.set(source, new Set());
        if (!adjacency.has(target)) adjacency.set(target, new Set());
        adjacency.get(source)!.add(target);
        adjacency.get(target)!.add(source);
      });
      related.add(focusedNodeId);
      let frontier = new Set([focusedNodeId]);
      for (let step = 0; step < focusDepth; step += 1) {
        const next = new Set<string>();
        frontier.forEach((id) => {
          adjacency.get(id)?.forEach((neighbor) => {
            if (!related.has(neighbor)) {
              related.add(neighbor);
              next.add(neighbor);
            }
          });
        });
        frontier = next;
      }
    }

    const orderedMatches = Array.from(searchMatches).filter((id) => visible.has(id));
    const activeMatchId = searchActiveIndex >= 0 ? orderedMatches[searchActiveIndex] : null;

    const shouldDim = (id: string) => {
      if (focusedNodeId && dimNonFocused && related.size > 0 && !related.has(id)) return true;
      if (searchMatches.size > 0 && !searchMatches.has(id)) return true;
      return false;
    };

    // --- react flow nodes, parents before children -------------------------
    const flowNodes: Node<GraphNodeUiData>[] = [];
    const emit = (id: string) => {
      const node = modelNodes.get(id);
      const position = layout.positions.get(id);
      if (!node || !position) return;

      const size = layout.sizes.get(id) ?? collapsedSize(node.kind);
      const parentId = node.parentId && visible.has(node.parentId) ? node.parentId : undefined;
      const isOpen = effectiveExpanded.has(id) && node.childIds.some((c) => visible.has(c));

      flowNodes.push({
        id,
        type: node.kind === 'unknown' ? 'function' : node.kind,
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        position,
        style: { width: size.width, height: size.height },
        draggable: false,
        selectable: true,
        selected: id === selectedNodeId,
        // Containers must not eat clicks meant for the children drawn on them.
        data: {
          label: node.label,
          kind: node.kind,
          path: node.path,
          dependencyCount: outDegree.get(id) ?? 0,
          dependentCount: inDegree.get(id) ?? 0,
          childCount: node.childIds.filter((childId) => {
            const child = modelNodes.get(childId);
            return child ? showExternal || !child.isExternal : false;
          }).length,
          isContainer: node.childIds.length > 0,
          isExpanded: isOpen,
          isExternal: node.isExternal,
          isFocused: focusedNodeId === id,
          isRelated: related.has(id),
          isDimmed: shouldDim(id),
          isSearchMatch: searchMatches.has(id),
          isSearchActive: activeMatchId === id,
          isSelected: id === selectedNodeId,
          metadata: node.metadata,
        },
      });

      node.childIds.forEach((childId) => {
        if (visible.has(childId)) emit(childId);
      });
    };
    scopeRoots.forEach(emit);

    const flowEdges: Edge[] = Array.from(aggregated.values()).map((edge) => {
      const color = EDGE_COLOR[edge.kind];
      const isFocusEdge =
        focusedNodeId != null && (edge.source === focusedNodeId || edge.target === focusedNodeId);
      const dimmed = shouldDim(edge.source) && shouldDim(edge.target);
      // Thickness reads as weight: a folder-to-folder arrow standing in for
      // twelve imports should not look like a single one.
      const width = Math.min(6, 1.4 + Math.log2(edge.count + 1));

      return {
        id: `${edge.source}->${edge.target}:${edge.kind}`,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: isFocusEdge,
        label: edge.count > 1 ? String(edge.count) : undefined,
        labelShowBg: false,
        labelStyle: { fill: color, fontSize: 10, opacity: 0.75 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: {
          stroke: color,
          strokeWidth: isFocusEdge ? width + 1 : width,
          strokeDasharray: edge.kind === 'inherits' ? '7 5' : undefined,
          opacity: dimmed ? 0.12 : isFocusEdge ? 1 : 0.55,
        },
      } as Edge;
    });

    return {
      flowNodes,
      flowEdges,
      searchMatchIds: orderedMatches,
      bounds: layout.bounds,
      visibleCount: visible.size,
      totalCount: modelNodes.size,
    };
  }, [
    model,
    aspect,
    expanded,
    focusRootId,
    focusedNodeId,
    focusDepth,
    dimNonFocused,
    highComplexityOnly,
    riskFilter,
    searchQuery,
    searchActiveIndex,
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    showExternal,
    selectedNodeId,
  ]);

  const { flowNodes, flowEdges } = computed;

  useEffect(() => {
    setSearchMatches(computed.searchMatchIds);
  }, [computed.searchMatchIds, setSearchMatches]);

  /**
   * Refit only when the graph's *structure* changes -- a new project, a new
   * depth level, a different filter. Refitting on every expand/collapse threw
   * the viewport around while the user was reading, and raced the pan that the
   * click handler had just started.
   */
  const structureKey = [
    modelKey,
    focusRootId,
    showExternal,
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    highComplexityOnly,
    riskFilter,
    layoutNonce,
  ].join('|');

  useEffect(() => {
    if (flowNodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.14, duration: 400, maxZoom: 1.1 });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, flowNodes.length > 0]);

  // Panning can never lose the graph: the reachable area is the content plus
  // one screen of margin on each side.
  const translateExtent = useMemo(() => {
    const margin = 1200;
    const width = Math.max(computed.bounds.width, 800);
    const height = Math.max(computed.bounds.height, 600);
    return [
      [-margin, -margin],
      [width + margin, height + margin],
    ] as [[number, number], [number, number]];
  }, [computed.bounds.width, computed.bounds.height]);

  const focusOnNode = useCallback(
    (nodeId: string) => {
      window.requestAnimationFrame(() => {
        const target = reactFlow.getNode(nodeId);
        if (!target) return;
        // positionAbsolute accounts for every parent frame; `position` is
        // relative to the parent and pans to the wrong place for nested nodes.
        const origin = target.positionAbsolute ?? target.position;
        const width = Number(target.style?.width ?? target.width ?? 240);
        const height = Number(target.style?.height ?? target.height ?? 90);
        reactFlow.fitBounds(
          { x: origin.x, y: origin.y, width, height },
          { padding: 0.45, duration: 380 },
        );
      });
    },
    [reactFlow],
  );

  // Track node IDs that were just clicked on the canvas so we don't double-pan.
  const lastClickedRef = useRef<string | null>(null);

  // When selectedNodeId changes externally (e.g. sidebar file click), pan to
  // the node. We do NOT call setFocusedNodeId here — that activates the
  // dim-non-focused mode which makes most edges invisible (opacity: 0.12).
  // Sidebar selection just highlights the node via its `selected` prop and pans.
  useEffect(() => {
    if (!selectedNodeId) return;
    if (lastClickedRef.current === selectedNodeId) {
      // This change came from a canvas click — we already panned. Skip.
      lastClickedRef.current = null;
      return;
    }
    // Expand all ancestor containers so the node is visible before panning.
    const ancestors = model.ancestorsOf(selectedNodeId);
    if (ancestors.length > 0) {
      expandAll(ancestors);
    }
    // Give layout one frame to settle after expanding, then pan.
    window.requestAnimationFrame(() => focusOnNode(selectedNodeId));
  }, [selectedNodeId, model, expandAll, focusOnNode]);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node<GraphNodeUiData>) => {
      // Mark as internally clicked so the effect above does not double-pan.
      lastClickedRef.current = node.id;
      onNodeSelect(node.id, node.data.path);
      setFocusedNodeId(node.id);
      if (node.data.isContainer) {
        toggleExpanded(node.id);
        if (!node.data.isExpanded) focusOnNode(node.id);
      }
    },
    [onNodeSelect, setFocusedNodeId, toggleExpanded, focusOnNode],
  );

  const handleNodeDoubleClick = useCallback(
    (_: unknown, node: Node<GraphNodeUiData>) => {
      if (node.data.isContainer) {
        setFocusRootId(node.id);
        return;
      }
      onNodeOpen?.(node.id);
    },
    [onNodeOpen, setFocusRootId],
  );

  // Esc steps out of a drill-down, matching the breadcrumb.
  useEffect(() => {
    if (!focusRootId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const parentId = model.nodes.get(focusRootId)?.parentId ?? null;
      setFocusRootId(parentId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusRootId, model, setFocusRootId]);

  const breadcrumb = useMemo(() => {
    if (!focusRootId) return [];
    const chain = [...model.ancestorsOf(focusRootId)].reverse();
    return [...chain, focusRootId]
      .map((id) => model.nodes.get(id))
      .filter((node): node is ModelNode => Boolean(node));
  }, [focusRootId, model]);

  return (
    <div ref={wrapperRef} className="absolute inset-0 min-h-0 min-w-0" style={{ width: '100%', height: '100%' }}>
      <div className="graph-filters-bar">
        <GraphFilters />
      </div>

      {breadcrumb.length > 0 && (
        <nav className="graph-breadcrumb" aria-label="Graph drill-down">
          <button type="button" className="graph-breadcrumb__crumb" onClick={() => setFocusRootId(null)}>
            <Home size={12} />
            <span>All</span>
          </button>
          {breadcrumb.map((node, index) => (
            <span key={node.id} className="graph-breadcrumb__segment">
              <ChevronRight size={12} className="graph-breadcrumb__sep" />
              <button
                type="button"
                className={`graph-breadcrumb__crumb ${
                  index === breadcrumb.length - 1 ? 'graph-breadcrumb__crumb--current' : ''
                }`}
                onClick={() => setFocusRootId(node.id)}
              >
                {node.label}
              </button>
            </span>
          ))}
          <span className="graph-breadcrumb__hint">Esc to go up</span>
        </nav>
      )}

      <div className="absolute bottom-6 left-14 z-20">
        <GraphLegend />
      </div>

      {showMinimap && (
        <div className="absolute bottom-20 right-6 z-20">
          <MinimapPanel />
        </div>
      )}

      <GraphControls
        onResetFocus={resetFocus}
        onExpandNeighborhood={onExpandNeighborhood}
        selectedNodeId={selectedNodeId}
        showMinimap={showMinimap}
        onToggleMinimap={onToggleMinimap}
      />

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        minZoom={0.02}
        maxZoom={2.5}
        translateExtent={translateExtent}
        nodesDraggable={false}
        nodesConnectable={false}
        elevateNodesOnSelect={false}
        onlyRenderVisibleElements={flowNodes.length > VIRTUALIZE_ABOVE}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.14, maxZoom: 1.1 }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={resetFocus}
        style={{ width: '100%', height: '100%' }}
      >
        <Background gap={26} size={1} color="rgba(124, 92, 255, 0.14)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export default function GraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  onNodeSelect,
  onNodeOpen,
  loading,
  showMinimap,
  onToggleMinimap,
  onExpandNeighborhood,
}: GraphCanvasProps) {
  if (loading) {
    return (
      <div className="graph-canvas">
        <div className="graph-canvas__surface">
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__overlay-icon">
              <span style={{ fontSize: '1.4rem' }}>⬡</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>Building dependency graph…</p>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)', opacity: 0.7 }}>
              Analyzing project structure
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="graph-canvas">
        <div className="graph-canvas__surface">
          <div className="graph-canvas__overlay">
            <div className="graph-canvas__overlay-icon">
              <span style={{ fontSize: '1.4rem' }}>◇</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text)' }}>No project loaded</p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', maxWidth: 320 }}>
              Upload a folder or a .zip archive and the dependency graph will be built from it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-canvas">
      <div className="graph-canvas__surface graph-flow">
        <GraphFlow
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          onNodeSelect={onNodeSelect}
          onNodeOpen={onNodeOpen}
          showMinimap={showMinimap}
          onToggleMinimap={onToggleMinimap}
          onExpandNeighborhood={onExpandNeighborhood}
        />
      </div>
    </div>
  );
}

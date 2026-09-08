/**
 * Recursive, aspect-aware layout for the dependency graph.
 *
 * The previous layout handed every top-level module to a single dagre pass. A
 * module with no cross-module import lands on dagre rank 0, and with `rankdir:
 * TB` rank 0 is one horizontal row -- so a repo whose imports did not resolve
 * (i.e. every repo) rendered as a single strip tens of thousands of pixels
 * wide, which no amount of zooming out could fit.
 *
 * Two rules here make that outcome structurally impossible:
 *
 *   1. dagre only ever sees a *connected component*, so unrelated nodes can
 *      never share a rank.
 *   2. the resulting component boxes are shelf-packed toward the viewport's
 *      aspect ratio, so the laid-out area always stays roughly screen-shaped.
 */

import dagre from 'dagre';
import type { GraphModel } from './graphModel';

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const COLLAPSED_SIZE: Record<string, Size> = {
  folder: { width: 268, height: 96 },
  module: { width: 248, height: 86 },
  class: { width: 200, height: 64 },
  function: { width: 180, height: 46 },
  unknown: { width: 180, height: 46 },
};

/** Inner padding of an expanded container; `top` leaves room for its header. */
const PADDING: Record<string, { x: number; top: number; bottom: number }> = {
  folder: { x: 24, top: 50, bottom: 24 },
  module: { x: 18, top: 56, bottom: 18 },
  class: { x: 14, top: 44, bottom: 14 },
  root: { x: 0, top: 0, bottom: 0 },
};

export function collapsedSize(kind: string): Size {
  return COLLAPSED_SIZE[kind] ?? COLLAPSED_SIZE.module;
}

const SPACING: Record<string, { rank: number; node: number; gap: number }> = {
  root: { rank: 96, node: 64, gap: 72 },
  folder: { rank: 72, node: 44, gap: 48 },
  module: { rank: 52, node: 32, gap: 32 },
  class: { rank: 40, node: 24, gap: 24 },
};

export type LayoutInput = {
  model: GraphModel;
  /** Ids allowed to render at all (after filters). */
  visible: Set<string>;
  /** Container ids whose children should render. */
  expanded: Set<string>;
  /** Viewport width / height, used as the packing target ratio. */
  aspect: number;
};

export type LayoutResult = {
  /** Position relative to the parent node, per React Flow's convention. */
  positions: Map<string, Point>;
  sizes: Map<string, Size>;
  bounds: Size;
};

type Rect = { id: string; width: number; height: number };

function weaklyConnectedComponents(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
): string[][] {
  const parent = new Map<string, string>(ids.map((id) => [id, id]));

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression keeps this near-linear on wide graphs.
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  edges.forEach(({ source, target }) => {
    if (!parent.has(source) || !parent.has(target)) return;
    const a = find(source);
    const b = find(target);
    if (a !== b) parent.set(a, b);
  });

  const groups = new Map<string, string[]>();
  ids.forEach((id) => {
    const root = find(id);
    const bucket = groups.get(root);
    if (bucket) bucket.push(id);
    else groups.set(root, [id]);
  });

  return Array.from(groups.values());
}

/** Lay out one connected component with dagre, normalized to a (0,0) origin. */
function layoutComponent(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
  sizeOf: (id: string) => Size,
  spacing: { rank: number; node: number },
): { positions: Map<string, Point>; width: number; height: number } {
  const positions = new Map<string, Point>();

  if (ids.length === 1) {
    const size = sizeOf(ids[0]);
    positions.set(ids[0], { x: 0, y: 0 });
    return { positions, width: size.width, height: size.height };
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'TB',
    ranksep: spacing.rank,
    nodesep: spacing.node,
    marginx: 0,
    marginy: 0,
  });

  ids.forEach((id) => {
    const size = sizeOf(id);
    graph.setNode(id, { width: size.width, height: size.height });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));

  try {
    dagre.layout(graph);
  } catch {
    // Fall through to the grid fallback below.
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let usable = true;

  ids.forEach((id) => {
    const placed = graph.node(id);
    const size = sizeOf(id);
    if (!placed || !Number.isFinite(placed.x) || !Number.isFinite(placed.y)) {
      usable = false;
      return;
    }
    const x = placed.x - size.width / 2;
    const y = placed.y - size.height / 2;
    positions.set(id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  });

  if (!usable) {
    // dagre gave up; fall back to a square-ish grid rather than a row.
    positions.clear();
    const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    let width = 0;
    let height = 0;
    ids.forEach((id, index) => {
      const size = sizeOf(id);
      const x = (index % columns) * (size.width + spacing.node);
      const y = Math.floor(index / columns) * (size.height + spacing.rank);
      positions.set(id, { x, y });
      width = Math.max(width, x + size.width);
      height = Math.max(height, y + size.height);
    });
    return { positions, width, height };
  }

  positions.forEach((point, id) => {
    positions.set(id, { x: point.x - minX, y: point.y - minY });
  });

  return { positions, width: maxX - minX, height: maxY - minY };
}

/**
 * Shelf-pack boxes toward a target aspect ratio. Tallest first, which keeps
 * shelves dense, and wrapping is driven by the area the boxes actually need
 * rather than by a fixed column count.
 */
function packRects(
  rects: Rect[],
  aspect: number,
  gap: number,
): { positions: Map<string, Point>; width: number; height: number } {
  const positions = new Map<string, Point>();
  if (rects.length === 0) return { positions, width: 0, height: 0 };

  const totalArea = rects.reduce(
    (sum, rect) => sum + (rect.width + gap) * (rect.height + gap),
    0,
  );
  const widest = rects.reduce((max, rect) => Math.max(max, rect.width), 0);
  const targetAspect = Math.max(0.5, aspect);
  const baseWidth = Math.max(widest, Math.sqrt(totalArea * targetAspect));

  const ordered = [...rects].sort(
    (a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id),
  );

  const shelvesAt = (maxWidth: number) => {
    const placed = new Map<string, Point>();
    let cursorX = 0;
    let cursorY = 0;
    let shelfHeight = 0;
    let width = 0;

    ordered.forEach((rect) => {
      if (cursorX > 0 && cursorX + rect.width > maxWidth) {
        cursorX = 0;
        cursorY += shelfHeight + gap;
        shelfHeight = 0;
      }
      placed.set(rect.id, { x: cursorX, y: cursorY });
      cursorX += rect.width + gap;
      shelfHeight = Math.max(shelfHeight, rect.height);
      width = Math.max(width, cursorX - gap);
    });

    return { positions: placed, width, height: cursorY + shelfHeight };
  };

  // A single very tall component fixes its whole shelf's height, so the first
  // guess at a target width can still come out badly off-ratio. Try a spread of
  // widths and keep whichever packs closest to the viewport's aspect.
  let best = shelvesAt(baseWidth);
  let bestScore = Number.POSITIVE_INFINITY;

  [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2, 2.5].forEach((factor) => {
    const candidate = shelvesAt(Math.max(widest, baseWidth * factor));
    if (candidate.height <= 0 || candidate.width <= 0) return;
    const score = Math.abs(Math.log(candidate.width / candidate.height / targetAspect));
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  best.positions.forEach((point, id) => positions.set(id, point));
  return { positions, width: best.width, height: best.height };
}

export function layoutGraph(input: LayoutInput): LayoutResult {
  const { model, visible, expanded, aspect } = input;

  const positions = new Map<string, Point>();
  const sizes = new Map<string, Size>();

  const visibleChildrenOf = (id: string | null): string[] => {
    const childIds = id === null ? model.rootIds : (model.nodes.get(id)?.childIds ?? []);
    return childIds.filter((childId) => visible.has(childId));
  };

  const isExpanded = (id: string): boolean =>
    expanded.has(id) && visibleChildrenOf(id).length > 0;

  /**
   * Hoist a dependency endpoint up to whichever sibling in `siblings` contains
   * it. This is what lets a collapsed folder still show the aggregate arrows of
   * everything inside it.
   */
  const hoist = (endpoint: string, siblings: Set<string>): string | null => {
    if (siblings.has(endpoint)) return endpoint;
    for (const ancestorId of model.ancestorsOf(endpoint)) {
      if (siblings.has(ancestorId)) return ancestorId;
    }
    return null;
  };

  const siblingEdges = (siblings: Set<string>): Array<{ source: string; target: string }> => {
    const seen = new Set<string>();
    const edges: Array<{ source: string; target: string }> = [];
    model.deps.forEach((dep) => {
      const source = hoist(dep.source, siblings);
      const target = hoist(dep.target, siblings);
      if (!source || !target || source === target) return;
      const key = `${source}|${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target });
    });
    return edges;
  };

  /** Lay out one container's children and return the size of its content box. */
  const layoutContainer = (containerId: string | null, kindKey: string): Size => {
    const childIds = visibleChildrenOf(containerId);
    if (childIds.length === 0) return { width: 0, height: 0 };

    // Depth first: a child must know its own size before it can be placed.
    childIds.forEach((childId) => {
      const child = model.nodes.get(childId)!;
      if (isExpanded(childId)) {
        const padding = PADDING[child.kind] ?? PADDING.module;
        const content = layoutContainer(childId, child.kind);
        sizes.set(childId, {
          width: Math.max(content.width + padding.x * 2, collapsedSize(child.kind).width),
          height: Math.max(
            content.height + padding.top + padding.bottom,
            collapsedSize(child.kind).height,
          ),
        });
      } else {
        sizes.set(childId, { ...collapsedSize(child.kind) });
      }
    });

    const sizeOf = (id: string) => sizes.get(id) ?? collapsedSize('module');
    const siblings = new Set(childIds);
    const edges = siblingEdges(siblings);
    const spacing = SPACING[kindKey] ?? SPACING.module;

    const components = weaklyConnectedComponents(childIds, edges);
    const componentEdges = new Map<string, Array<{ source: string; target: string }>>();
    const componentOf = new Map<string, string>();
    components.forEach((members) => {
      const key = members[0];
      members.forEach((memberId) => componentOf.set(memberId, key));
      componentEdges.set(key, []);
    });
    edges.forEach((edge) => {
      const key = componentOf.get(edge.source);
      if (key && key === componentOf.get(edge.target)) {
        componentEdges.get(key)!.push(edge);
      }
    });

    const laidOut = components.map((members) => {
      const key = members[0];
      const result = layoutComponent(
        members,
        componentEdges.get(key) ?? [],
        sizeOf,
        spacing,
      );
      return { key, ...result };
    });

    const packed = packRects(
      laidOut.map((component) => ({
        id: component.key,
        width: component.width,
        height: component.height,
      })),
      aspect,
      spacing.gap,
    );

    const padding = PADDING[kindKey] ?? PADDING.root;
    laidOut.forEach((component) => {
      const origin = packed.positions.get(component.key) ?? { x: 0, y: 0 };
      component.positions.forEach((point, memberId) => {
        positions.set(memberId, {
          x: padding.x + origin.x + point.x,
          y: padding.top + origin.y + point.y,
        });
      });
    });

    return { width: packed.width, height: packed.height };
  };

  const rootContent = layoutContainer(null, 'root');

  return { positions, sizes, bounds: rootContent };
}

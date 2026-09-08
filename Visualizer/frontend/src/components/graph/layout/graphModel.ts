/**
 * Turns the backend's flat node/edge payload into a navigable hierarchy:
 *
 *   folder -> folder -> module -> class -> function
 *
 * The backend describes containment with `parent_id` (and, for older stores,
 * `contains` edges), but it has no concept of a directory -- every module
 * arrives as a peer. Folder nodes are synthesized here from each module's
 * `path`, which is what gives the canvas its top-level visual structure.
 */

import type { GraphEdgeData, GraphNodeData } from '../../../types/backend';
import type { CanvasNodeKind, NodeMetadata } from '../types';

export const EXTERNAL_FOLDER_ID = 'folder::__external__';

export type ModelNodeKind = CanvasNodeKind;

export type ModelNode = {
  id: string;
  kind: ModelNodeKind;
  label: string;
  /** Repo-relative path; folders carry their directory, modules their file. */
  path?: string;
  parentId: string | null;
  childIds: string[];
  isExternal: boolean;
  metadata: NodeMetadata;
  /** Backing payload node, absent for synthesized folders. */
  source?: GraphNodeData;
};

export type DepEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'import' | 'call' | 'inherits';
};

export type GraphModel = {
  nodes: Map<string, ModelNode>;
  rootIds: string[];
  deps: DepEdge[];
  /** Nearest ancestor of `id` present in `candidates` (or `id` itself). */
  resolveVisible: (id: string, candidates: Set<string>) => string | null;
  ancestorsOf: (id: string) => string[];
};

const MODULE_KINDS = new Set(['module', 'file', 'package']);
const CLASS_KINDS = new Set(['class']);
const FUNCTION_KINDS = new Set(['function', 'method']);
const CONTAINMENT_KINDS = new Set(['contains', 'containment', 'owns']);
const INHERITANCE_KINDS = new Set(['inherits', 'inheritance']);

export function toKind(value?: string | null): CanvasNodeKind {
  const normalized = String(value ?? '').toLowerCase();
  if (MODULE_KINDS.has(normalized)) return 'module';
  if (CLASS_KINDS.has(normalized)) return 'class';
  if (FUNCTION_KINDS.has(normalized)) return 'function';
  return 'unknown';
}

function metadataOf(node: GraphNodeData): NodeMetadata {
  return (node.metadata ?? {}) as NodeMetadata;
}

function directoryOf(path?: string | null): string {
  if (!path) return '';
  const normalized = String(path).replace(/\\/g, '/');
  const cut = normalized.lastIndexOf('/');
  return cut <= 0 ? '' : normalized.slice(0, cut);
}

/**
 * Parent id for a payload node, most trustworthy source first.
 *
 * `parent_id` is authoritative but only exists on newer backends; `contains`
 * edges are the legacy signal; the dotted id prefix is the last resort, and
 * works because ids are strictly `module[.Class][.func]`.
 */
function buildParentMap(nodes: GraphNodeData[], edges: GraphEdgeData[]): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentById = new Map<string, string>();

  nodes.forEach((node) => {
    const declared =
      (metadataOf(node).parent_id as string | undefined) ??
      (node as { parent_id?: string }).parent_id;
    if (declared && byId.has(declared) && declared !== node.id) {
      parentById.set(node.id, declared);
    }
  });

  edges.forEach((edge) => {
    if (!CONTAINMENT_KINDS.has(String(edge.type ?? '').toLowerCase())) return;
    if (parentById.has(edge.target)) return;
    if (!byId.has(edge.source) || edge.source === edge.target) return;
    parentById.set(edge.target, edge.source);
  });

  nodes.forEach((node) => {
    if (parentById.has(node.id)) return;
    if (toKind(node.kind) === 'module') return;
    const parts = node.id.split('.');
    for (let stop = parts.length - 1; stop > 0; stop -= 1) {
      const candidate = parts.slice(0, stop).join('.');
      if (byId.has(candidate)) {
        parentById.set(node.id, candidate);
        return;
      }
    }
  });

  return parentById;
}

/**
 * Create the folder chain for a directory path, returning the deepest folder id.
 * Folders are made lazily, so only directories that hold modules exist at all.
 */
function ensureFolderChain(directory: string, nodes: Map<string, ModelNode>): string | null {
  if (!directory) return null;

  const segments = directory.split('/').filter(Boolean);
  let parentId: string | null = null;

  segments.forEach((segment, index) => {
    const folderPath = segments.slice(0, index + 1).join('/');
    const id = `folder::${folderPath}`;
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind: 'folder',
        label: segment,
        path: folderPath,
        parentId,
        childIds: [],
        isExternal: false,
        metadata: {},
      });
      if (parentId) {
        nodes.get(parentId)!.childIds.push(id);
      }
    }
    parentId = id;
  });

  return parentId;
}

/**
 * Merge folders that exist only to hold one other folder, so a deep but narrow
 * tree ("src/main/java/com/acme") renders as one frame instead of five nested
 * ones that carry no information.
 */
function collapseFolderChains(nodes: Map<string, ModelNode>, rootIds: string[]): string[] {
  const collapseFrom = (id: string): string => {
    const node = nodes.get(id);
    if (!node || node.kind !== 'folder') return id;

    node.childIds = node.childIds.map(collapseFrom);

    while (node.childIds.length === 1) {
      const onlyChild = nodes.get(node.childIds[0]);
      if (!onlyChild || onlyChild.kind !== 'folder') break;

      node.label = `${node.label}/${onlyChild.label}`;
      node.path = onlyChild.path;
      node.childIds = onlyChild.childIds;
      node.childIds.forEach((grandchildId) => {
        const grandchild = nodes.get(grandchildId);
        if (grandchild) grandchild.parentId = node.id;
      });
      nodes.delete(onlyChild.id);
    }

    return node.id;
  };

  return rootIds.map(collapseFrom);
}

export function buildGraphModel(
  payloadNodes: GraphNodeData[],
  payloadEdges: GraphEdgeData[],
): GraphModel {
  const nodes = new Map<string, ModelNode>();
  const parentById = buildParentMap(payloadNodes, payloadEdges);

  // Pass 1: every payload node becomes a model node.
  payloadNodes.forEach((node) => {
    const metadata = metadataOf(node);
    nodes.set(node.id, {
      id: node.id,
      kind: toKind(node.kind),
      label: node.label ?? node.display_name ?? node.id,
      path: node.path,
      parentId: null,
      childIds: [],
      isExternal: Boolean(
        metadata.is_external ?? (node as { is_external?: boolean }).is_external,
      ),
      metadata,
      source: node,
    });
  });

  // Pass 2: link symbols to their owning module/class.
  nodes.forEach((node) => {
    if (node.kind === 'folder') return;
    const parentId = parentById.get(node.id);
    if (parentId && nodes.has(parentId)) {
      node.parentId = parentId;
      nodes.get(parentId)!.childIds.push(node.id);
    }
  });

  // Pass 3: hang every remaining orphan under its synthesized directory.
  const rootIds: string[] = [];
  Array.from(nodes.values()).forEach((node) => {
    if (node.parentId || node.kind === 'folder') return;

    if (node.isExternal) {
      if (!nodes.has(EXTERNAL_FOLDER_ID)) {
        nodes.set(EXTERNAL_FOLDER_ID, {
          id: EXTERNAL_FOLDER_ID,
          kind: 'folder',
          label: 'External packages',
          parentId: null,
          childIds: [],
          isExternal: true,
          metadata: {},
        });
      }
      node.parentId = EXTERNAL_FOLDER_ID;
      nodes.get(EXTERNAL_FOLDER_ID)!.childIds.push(node.id);
      return;
    }

    const folderId = ensureFolderChain(directoryOf(node.path), nodes);
    if (folderId) {
      node.parentId = folderId;
      nodes.get(folderId)!.childIds.push(node.id);
    } else {
      rootIds.push(node.id);
    }
  });

  nodes.forEach((node) => {
    if (node.kind === 'folder' && !node.parentId && !rootIds.includes(node.id)) {
      rootIds.push(node.id);
    }
  });

  const collapsedRoots = collapseFolderChains(nodes, rootIds).filter((id) => nodes.has(id));

  const deps: DepEdge[] = [];
  const seenDeps = new Set<string>();
  payloadEdges.forEach((edge) => {
    const raw = String(edge.type ?? '').toLowerCase();
    let kind: DepEdge['kind'] | null = null;
    if (raw === 'import' || raw === 'imports') kind = 'import';
    else if (raw === 'call' || raw === 'calls') kind = 'call';
    else if (INHERITANCE_KINDS.has(raw)) kind = 'inherits';
    if (!kind) return;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) return;
    if (edge.source === edge.target) return;

    const id = `${edge.source}->${edge.target}:${kind}`;
    if (seenDeps.has(id)) return;
    seenDeps.add(id);
    deps.push({ id, source: edge.source, target: edge.target, kind });
  });

  const ancestorsOf = (id: string): string[] => {
    const chain: string[] = [];
    let current = nodes.get(id)?.parentId ?? null;
    while (current) {
      chain.push(current);
      current = nodes.get(current)?.parentId ?? null;
    }
    return chain;
  };

  const resolveVisible = (id: string, candidates: Set<string>): string | null => {
    if (candidates.has(id)) return id;
    for (const ancestorId of ancestorsOf(id)) {
      if (candidates.has(ancestorId)) return ancestorId;
    }
    return null;
  };

  return { nodes, rootIds: collapsedRoots, deps, resolveVisible, ancestorsOf };
}

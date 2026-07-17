import dagre from 'dagre';
import { Node, Edge, Position } from 'reactflow';
import { GraphPayload } from '../types/graph';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    // Determine node dimensions based on type (rough estimates)
    let width = 250;
    let height = 80;
    
    if (node.data.type === 'module') {
      width = 300;
      height = 90;
    } else if (node.data.type === 'function') {
      width = 220;
      height = 70;
    }

    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    // We are shifting the dagre node position (anchor=center center) to the top left
    // so it matches the React Flow node anchor point (top left).
    const width = nodeWithPosition.width || 250;
    const height = nodeWithPosition.height || 80;
    node.targetPosition = isHorizontal ? Position.Left : Position.Top;
    node.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

    node.position = {
      x: nodeWithPosition.x - width / 2,
      y: nodeWithPosition.y - height / 2,
    };


    return node;
  });

  return { nodes, edges };
};

/**
 * Computes which nodes and edges should be visible based on the set of collapsed node IDs.
 * A node is hidden if any of its ancestors (via 'contains' edges) are collapsed.
 */
export const getVisibleGraph = (
  payload: GraphPayload,
  collapsedNodeIds: Set<string>
): { visibleNodes: string[]; visibleEdges: string[] } => {
  const containsEdges = payload.edges.filter((e) => e.type === 'contains');
  
  // Build parent mapping
  const parentMap = new Map<string, string>();
  containsEdges.forEach((e) => {
    parentMap.set(e.target, e.source);
  });

  const visibleNodes = new Set<string>();

  payload.nodes.forEach((node) => {
    let isHidden = false;
    let currentId = node.id;

    // Traverse up the tree
    while (parentMap.has(currentId)) {
      const parentId = parentMap.get(currentId)!;
      if (collapsedNodeIds.has(parentId)) {
        isHidden = true;
        break;
      }
      currentId = parentId;
    }

    if (!isHidden) {
      visibleNodes.add(node.id);
    }
  });

  const visibleEdges = new Set<string>();
  payload.edges.forEach((edge) => {
    // Only show edge if both source and target are visible
    if (visibleNodes.has(edge.source) && visibleNodes.has(edge.target)) {
      visibleEdges.add(edge.id);
    }
  });

  return {
    visibleNodes: Array.from(visibleNodes),
    visibleEdges: Array.from(visibleEdges),
  };
};

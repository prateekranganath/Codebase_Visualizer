import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap, 
  Node, 
  Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
  Panel
} from 'reactflow';
import 'reactflow/dist/style.css';

import CodeNode from './CodeNode';
import { GraphPayload } from '../../types/graph';
import { getLayoutedElements, getVisibleGraph } from '../../utils/layout';

const nodeTypes = {
  customCodeNode: CodeNode,
};

interface CodeGraphProps {
  payload: GraphPayload;
}

export default function CodeGraph({ payload }: CodeGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  // Track which nodes are explicitly collapsed by the user
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());

  // Determine which nodes have children (targets of 'contains' edges)
  const parents = useMemo(() => {
    const parentSet = new Set<string>();
    payload.edges.forEach(e => {
      if (e.type === 'contains') {
        parentSet.add(e.source);
      }
    });
    return parentSet;
  }, [payload.edges]);

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Update layout whenever payload or collapsed state changes
  useEffect(() => {
    const { visibleNodes, visibleEdges } = getVisibleGraph(payload, collapsedNodeIds);
    const visibleNodesSet = new Set(visibleNodes);

    const initialNodes: Node[] = payload.nodes
      .filter((n) => visibleNodesSet.has(n.id))
      .map((node) => ({
        id: node.id,
        type: 'customCodeNode',
        data: {
          ...node,
          hasChildren: parents.has(node.id),
          isCollapsed: collapsedNodeIds.has(node.id),
          onToggleCollapse: toggleCollapse,
        },
        position: { x: 0, y: 0 }, // Dagre will position this
      }));

    const initialEdges: Edge[] = payload.edges
      .filter((e) => visibleEdges.includes(e.id))
      .map((edge) => {
        let style = { stroke: '#94a3b8', strokeWidth: 1 };
        let animated = false;
        let markerEnd = undefined;
        let strokeDasharray = undefined;

        switch (edge.type) {
          case 'contains':
            style = { stroke: '#475569', strokeWidth: 2 }; // Solid, structural structural gray
            break;
          case 'calls':
            style = { stroke: '#3b82f6', strokeWidth: 2 }; // Blue
            animated = true;
            markerEnd = { type: MarkerType.ArrowClosed, color: '#3b82f6' };
            break;
          case 'inherits':
            style = { stroke: '#f59e0b', strokeWidth: 2 }; // Amber
            strokeDasharray = '5,5';
            markerEnd = { type: MarkerType.ArrowClosed, color: '#f59e0b' };
            break;
          case 'imports':
            style = { stroke: '#64748b', strokeWidth: 1 }; // Light gray
            strokeDasharray = '2,2';
            markerEnd = { type: MarkerType.Arrow, color: '#64748b' };
            break;
        }

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          animated,
          style,
          markerEnd,
        };
      });

    // Run Dagre layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges,
      'TB'
    );

    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
  }, [payload, collapsedNodeIds, parents, toggleCollapse, setNodes, setEdges]);

  return (
    <div className="w-full h-full bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="code-graph"
        minZoom={0.1}
        maxZoom={1.5}
      >
        <Background color="#334155" gap={16} />
        <Controls className="bg-slate-800 border-slate-700 fill-slate-300" />
        <MiniMap 
          nodeColor={(n) => {
            if (n.data?.type === 'module') return '#1e293b';
            if (n.data?.type === 'class') return '#312e81';
            return '#0f172a';
          }}
          maskColor="rgba(2, 6, 23, 0.7)"
          className="bg-slate-900 border border-slate-800 rounded-lg"
        />
        <Panel position="top-right" className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 backdrop-blur-sm text-slate-200 text-sm shadow-xl">
          <h4 className="font-semibold mb-2">Legend</h4>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2"><div className="w-4 h-[2px] bg-[#475569]"></div> Contains</div>
            <div className="flex items-center gap-2"><div className="w-4 h-[2px] bg-[#3b82f6] border-dashed"></div> Calls</div>
            <div className="flex items-center gap-2"><div className="w-4 h-[2px] bg-[#f59e0b] border-dashed"></div> Inherits</div>
            <div className="flex items-center gap-2"><div className="w-4 h-[2px] bg-[#64748b] border-dotted"></div> Imports</div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

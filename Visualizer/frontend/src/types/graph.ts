export interface GraphNodePayload {
  id: string;
  display_name: string;
  type: "module" | "class" | "function";
  risk: "low" | "medium" | "high";
  complexity?: number;
  coupling?: number;
  language?: string;
  path: string;
}

export interface GraphEdgePayload {
  id: string;
  source: string;
  target: string;
  type: "imports" | "contains" | "inherits" | "calls";
}

export interface GraphPayload {
  graph_level?: number;
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
}

export type CodeNodeData = GraphNodePayload & {
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
};

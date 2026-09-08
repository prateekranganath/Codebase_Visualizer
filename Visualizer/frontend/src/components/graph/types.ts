export type GraphNodeKind = 'module' | 'class' | 'function' | 'method' | 'file' | 'unknown';

/** Node kinds the canvas can render, including synthesized directory frames. */
export type CanvasNodeKind = 'folder' | 'module' | 'class' | 'function' | 'unknown';

export type NodeRisk = 'low' | 'medium' | 'high';

export type NodeMetadata = {
  complexity?: number;
  coupling?: number;
  risk?: NodeRisk;
  parent_id?: string;
  is_external?: boolean;
  language?: string;
  size?: number;
  [key: string]: unknown;
};

export type GraphNodeUiData = {
  label: string;
  kind: CanvasNodeKind;
  path?: string;
  /** Outgoing dependencies from this node or anything inside it. */
  dependencyCount?: number;
  /** Incoming dependencies, i.e. how many things rely on this. */
  dependentCount?: number;
  /** Direct children in the hierarchy, shown as a badge when collapsed. */
  childCount?: number;
  /** True when this node can be opened to reveal children. */
  isContainer?: boolean;
  isExpanded?: boolean;
  isExternal?: boolean;
  isFocused?: boolean;
  isRelated?: boolean;
  isDimmed?: boolean;
  isSearchMatch?: boolean;
  isSearchActive?: boolean;
  isSelected?: boolean;
  metadata?: NodeMetadata;
};

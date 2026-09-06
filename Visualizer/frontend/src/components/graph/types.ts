export type GraphNodeKind = 'module' | 'class' | 'function' | 'method' | 'file' | 'unknown';

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
  kind: GraphNodeKind;
  path?: string;
  dependencyCount?: number;
  isExpanded?: boolean;
  isFocused?: boolean;
  isRelated?: boolean;
  isDimmed?: boolean;
  isSearchMatch?: boolean;
  isSearchActive?: boolean;
  metadata?: NodeMetadata;
};

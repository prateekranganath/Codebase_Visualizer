export interface ApiErrorResponse {
  detail?: string;
  message?: string;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
}

export interface ProjectPathRequest {
  root_dir: string;
  relative_path?: string;
}

export interface ProjectFileWriteRequest {
  root_dir: string;
  relative_path: string;
  content: string;
}

export interface ProjectFileEntry {
  name: string;
  path: string;
  kind?: string;
  is_dir?: boolean;
  size?: number;
  modified_at?: string;
  language?: string;
  status?: string;
  active?: boolean;
}

export interface ProjectListResponse {
  files: Array<ProjectFileEntry | string>;
  root_dir?: string;
  relative_path?: string;
}

export interface ProjectFileResponse {
  path: string;
  content: string;
}

export interface ProjectMetadataResponse {
  path: string;
  exists?: boolean;
  size?: number;
  modified_at?: string;
  kind?: string;
  language?: string;
  checksum?: string;
}

export interface ParseResponse {
  path?: string;
  module?: string;
  imports?: string[];
  functions?: string[];
  classes?: string[];
  docstring?: string | null;
  [key: string]: unknown;
}

export interface UpdateResponse {
  success?: boolean;
  message?: string;
  chunks_added?: number;
  chunks_removed?: number;
  chunks_updated?: number;
  embeddings_refreshed?: boolean;
  graph_rebuilt?: boolean;
  details?: Record<string, unknown>;
}

export interface UploadWorkspaceResponse {
  workspace_id: string;
  root_path: string;
  graph_rebuilt?: boolean;
  parse_result?: Record<string, unknown>;
  sync_result?: Record<string, unknown>;
}

export interface QueryRequest {
  query: string;
  top_k?: number;
  mode?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ExplainRequest {
  root_dir?: string;
  file_path: string;
  top_k?: number;
  max_tokens?: number;
  temperature?: number | null;
}

export interface ExplainKeyComponent {
  name: string;
  role: string;
}

export interface ExplainResponseModel {
  text?: string;
  mode: 'explain';
  provider?: string;
  model?: string;
  context?: Record<string, unknown>;
  summary: string;
  responsibilities: string[];
  key_components: ExplainKeyComponent[];
  dependencies: string[];
  risks: string[];
  insights: string[];
}

export interface TeachingRequest {
  root_dir?: string;
  user_id: string;
  query: string;
  top_k?: number;
  escalate_on_repeat?: boolean;
  max_tokens?: number;
}

export interface LLMResponseModel {
  text: string;
  provider?: string;
  model?: string;
  context?: string[];
  metadata?: Record<string, unknown>;
}

export interface TeachingResponseModel {
  guidance?: string;
  question?: string;
  hint?: string;
  explanation?: string;
  profile?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderInfo {
  provider?: string;
  model?: string;
  base_url?: string;
  capabilities?: string[];
  [key: string]: unknown;
}

export interface GraphNodeData {
  id: string;
  label: string;
  display_name?: string;
  kind?: string;
  type?: string;
  color?: string;
  group?: string;
  path?: string;
  x?: number;
  y?: number;
  size?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeData {
  id: string;

  source: string;
  target: string;

  type: string;

  label?: string;
  weight?: number;
  metadata?: Record<string, any>;
}

export interface GraphExportResponse {
  graph_level?: number;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  metadata?: Record<string, unknown>;
}

export interface GraphNodeResponse {
  id?: string;
  data: GraphNodeData;
}

export interface GraphDependencyResponse {
  node_name?: string;
  root_dir?: string;
  dependencies: GraphNodeData[];
}

export interface GraphSubgraphResponse {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  centers?: string[];
  depth?: number;
  graph_level?: number;
}

export interface RefactorProposalRequest {
  file_path: string;
  goal: string;
  top_k?: number;
}

export interface RefactorProposalResponse {
  suggested_code?: string;
  diff?: string;
  reasoning?: string;
  risks?: string[];
  estimate?: string;
  metadata?: Record<string, unknown>;
}

export interface RefactorValidateRequest {
  file_path: string;
  original_code: string;
  refactored_code: string;
}

export interface RefactorValidationResponse {
  valid?: boolean;
  syntax_ok?: boolean;
  imports_ok?: boolean;
  breaking_changes?: string[];
  affected_dependents?: string[];
  details?: Record<string, unknown>;
}

export interface RefactorApplyRequest {
  file_path: string;
  new_code: string;
  create_backup?: boolean;
}

export interface RefactorApplyResponse {
  success?: boolean;
  backup_path?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface RefactorChangeItem {
  file_path: string;
  new_code: string;
}

export interface BatchRefactorRequest {
  changes: RefactorChangeItem[];
}

export interface BatchRefactorResponse {
  success?: boolean;
  results?: Array<Record<string, unknown>>;
  rolled_back?: boolean;
  summary?: string;
}

export interface ImpactResponse {
  impact?: string;
  affected_nodes?: string[];
  affected_files?: string[];
  details?: Record<string, unknown>;
}

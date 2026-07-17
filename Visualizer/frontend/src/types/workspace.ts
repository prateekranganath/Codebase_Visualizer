export type WorkspaceFileRecord = {
  name: string;
  path: string;
  kind: string;
  detail?: string;
  active?: boolean;
};

export type WorkspaceGraphNode = {
  id: string;
  label: string;
  kind: string;
  color: string;
  x: number;
  y: number;
  size: number;
};

import type {
  HealthResponse,
  ParseResponse,
  ProjectFileResponse,
  ProjectFileWriteRequest,
  ProjectListResponse,
  ProjectMetadataResponse,
  ProjectPathRequest,
  UpdateResponse,
  UploadWorkspaceResponse,
} from '../types/backend';
import { request } from './http';

export function getHealth() {
  return request<HealthResponse>('/health');
}

export function listProjectFiles(params: ProjectPathRequest) {
  return request<ProjectListResponse>('/project/files', { query: { ...params } });
}

export function readProjectFile(params: ProjectPathRequest) {
  return request<ProjectFileResponse>('/project/file', { query: { ...params } });
}

export function writeProjectFile(payload: ProjectFileWriteRequest) {
  return request<ProjectMetadataResponse>('/project/file', {
    method: 'POST',
    body: payload,
  });
}

export function getProjectMetadata(params: ProjectPathRequest) {
  return request<ProjectMetadataResponse>('/project/metadata', { query: { ...params } });
}

export function parseProjectFile(params: ProjectPathRequest) {
  return request<ParseResponse>('/project/parse', { query: { ...params } });
}

export function syncProjectFile(payload: ProjectPathRequest) {
  return request<UpdateResponse>('/project/sync', {
    method: 'POST',
    body: payload,
  });
}

export function parseCodebase(root_dir: string) {
  return request<Record<string, unknown>>('/project/parse-codebase', {
    method: 'POST',
    body: { root_dir },
  });
}

export function uploadProjectWorkspace(formData: FormData) {
  return request<UploadWorkspaceResponse>('/project/upload', {
    method: 'POST',
    body: formData,
  });
}

import type {
  GraphDependencyResponse,
  GraphExportResponse,
  GraphNodeResponse,
  GraphSubgraphResponse,
} from '../types/backend';
import { request } from './http';

export function exportGraph(root_dir: string, graph_level = 3) {
  return request<GraphExportResponse>('/graph/export', { query: { root_dir, graph_level } });
}

export function getGraphNode(root_dir: string, node_name: string) {
  return request<GraphNodeResponse>('/graph/node', { query: { root_dir, node_name } });
}

export function getGraphDependencies(root_dir: string, node_name: string) {
  return request<GraphDependencyResponse>('/graph/dependencies', { query: { root_dir, node_name } });
}

export function getGraphDependents(root_dir: string, node_name: string) {
  return request<GraphDependencyResponse>('/graph/dependents', { query: { root_dir, node_name } });
}

export function getGraphSubgraph(root_dir: string, centers: string[], depth = 2) {
  return request<GraphSubgraphResponse>('/graph/subgraph', {
    query: { root_dir, centers, depth },
  });
}

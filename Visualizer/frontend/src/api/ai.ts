import type {
  ExplainRequest,
  ExplainResponseModel,
  LLMResponseModel,
  ProviderInfo,
  QueryRequest,
  TeachEvaluateRequest,
  TeachEvaluateResponseModel,
  TeachingRequest,
  TeachingResponseModel,
} from '../types/backend';
import { request } from './http';

export function queryAi(payload: QueryRequest) {
  return request<LLMResponseModel>('/ai/query', {
    method: 'POST',
    body: payload,
  });
}

export function explainFile(payload: ExplainRequest) {
  return request<ExplainResponseModel>('/ai/explain', {
    method: 'POST',
    body: payload,
  });
}

export function teachAi(payload: TeachingRequest) {
  return request<TeachingResponseModel>('/ai/teach', {
    method: 'POST',
    body: payload,
  });
}

export function teachEvaluate(payload: TeachEvaluateRequest) {
  return request<TeachEvaluateResponseModel>('/ai/teach/evaluate', {
    method: 'POST',
    body: payload,
  });
}

export function getAiProvider() {
  return request<ProviderInfo>('/ai/provider');
}

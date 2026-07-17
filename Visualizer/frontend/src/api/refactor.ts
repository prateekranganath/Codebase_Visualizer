import type {
  BatchRefactorRequest,
  BatchRefactorResponse,
  ImpactResponse,
  RefactorApplyRequest,
  RefactorApplyResponse,
  RefactorProposalRequest,
  RefactorProposalResponse,
  RefactorValidateRequest,
  RefactorValidationResponse,
} from '../types/backend';
import { request } from './http';

export function proposeRefactor(payload: RefactorProposalRequest) {
  return request<RefactorProposalResponse>('/refactor/propose', {
    method: 'POST',
    body: payload,
  });
}

export function validateRefactor(payload: RefactorValidateRequest) {
  return request<RefactorValidationResponse>('/refactor/validate', {
    method: 'POST',
    body: payload,
  });
}

export function applyRefactor(payload: RefactorApplyRequest) {
  return request<RefactorApplyResponse>('/refactor/apply', {
    method: 'POST',
    body: payload,
  });
}

export function applyBatchRefactor(payload: BatchRefactorRequest) {
  return request<BatchRefactorResponse>('/refactor/batch', {
    method: 'POST',
    body: payload,
  });
}

export function estimateRefactorImpact(file_path: string, changes: Record<string, unknown>) {
  return request<ImpactResponse>('/refactor/impact', {
    method: 'POST',
    body: { file_path, changes },
  });
}

import type { ApiErrorResponse } from '../types/backend';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, body?: ApiErrorResponse | string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (body && typeof body === 'object' && body.detail && typeof body.detail === 'object') {
      this.retryAfterSeconds = body.detail.retry_after_seconds ?? undefined;
    }
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

function buildUrl(path: string, query?: ApiRequestOptions['query']) {
  const url = new URL(path, API_BASE_URL);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
        return;
      }

      url.searchParams.set(key, String(value));
    });
  }

  return url;
}

function readErrorMessage(error: ApiErrorResponse | string | undefined) {
  if (!error) {
    return 'Request failed';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error.detail && typeof error.detail === 'object') {
    const seconds = error.detail.retry_after_seconds;
    return seconds
      ? `Rate limit reached. Try again in ${Math.ceil(seconds)}s.`
      : 'Rate limit reached. Please wait a moment and try again.';
  }

  return error.detail ?? error.message ?? error.error ?? 'Request failed';
}

export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as BodyInit)
          : (JSON.stringify(options.body) as BodyInit),
    signal: options.signal,
  });

  if (!response.ok) {
    let errorBody: ApiErrorResponse | string | undefined;

    try {
      errorBody = (await response.json()) as ApiErrorResponse;
    } catch {
      errorBody = await response.text();
    }

    throw new ApiError(readErrorMessage(errorBody), response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export { API_BASE_URL };

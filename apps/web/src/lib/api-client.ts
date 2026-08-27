import { ErrorCode, type ApiResponse } from '@saarthi/shared';

/**
 * Single HTTP client for the VorldX Saarthi API.
 *
 * Security posture: the access token is kept in memory only (never in
 * localStorage, so an XSS payload cannot read it), while the long-lived refresh
 * token lives in an httpOnly cookie the browser attaches automatically. A 401
 * triggers exactly one refresh attempt, shared by all concurrent requests.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages produced by backend validation. */
  get fieldErrors(): Record<string, string[]> {
    const fields = this.details?.fields;
    return typeof fields === 'object' && fields !== null
      ? (fields as Record<string, string[]>)
      : {};
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === ErrorCode.UNAUTHENTICATED ||
      this.code === ErrorCode.TOKEN_EXPIRED ||
      this.code === ErrorCode.TOKEN_INVALID
    );
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Is this URL one the current page could never reach?
 *
 * Two combinations are unreachable no matter what the server is doing, and both
 * arise from the same mistake — a base URL pinned to the machine that wrote the
 * `.env`:
 *
 *   * A loopback host from a page that is not itself on loopback. `localhost`
 *     on a phone is the phone; the API is on somebody's desktop.
 *   * A plain-http target from an https page. The browser blocks it as mixed
 *     content before the request is ever sent, so it fails with no status and
 *     no CORS error to read.
 *
 * Both surface as an unexplained network failure, which is a miserable thing to
 * debug from a phone at the roadside. Detecting them here lets the client fall
 * back to a same-origin relative path, which the dev proxy forwards — so a
 * stale `.env` degrades to working rather than to broken.
 */
export function unreachableFromThisPage(url: string): boolean {
  if (typeof window === 'undefined' || !url) return false;

  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;
  const pageIsLoopback = loopback.test(window.location.hostname);

  try {
    const target = new URL(url, window.location.href);
    if (loopback.test(target.hostname) && !pageIsLoopback) return true;
    if (window.location.protocol === 'https:' && target.protocol === 'http:') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Where the API lives, as seen from the browser.
 *
 * Empty means same-origin and relative, which is the configuration that works
 * everywhere: Vite's dev proxy forwards `/api` and `/ws` to the API, and in
 * production the two are served from one origin. It is also what makes the app
 * reachable through a dev tunnel or from a phone on the LAN, and it sidesteps
 * CORS and cookie-partitioning entirely because nothing is cross-origin.
 *
 * A configured `VITE_API_URL` is honoured, unless the page could not reach it.
 */
const API_BASE = (() => {
  const configured = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
  return configured && !unreachableFromThisPage(configured) ? configured : '';
})();

/** The resolved origin, for callers that build their own request URLs. */
export function apiBase(): string {
  return API_BASE;
}

export const API_PREFIX = '/api/v1';

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when a refresh attempt fails, so the app can clear session state. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

function buildUrl(path: string, query?: QueryParams): string {
  const base = `${API_BASE}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined | (string | number)[]
>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry (used by the auth endpoints). */
  skipAuthRetry?: boolean;
  headers?: Record<string, string>;
}

async function readEnvelope<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  if (!text) {
    return response.ok
      ? ({ success: true, data: null as T } satisfies ApiResponse<T>)
      : {
          success: false,
          error: {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'The server returned an empty response.',
          },
        };
  }
  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'The server returned an unexpected response.',
      },
    };
  }
}

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const envelope = await readEnvelope<{ accessToken: string }>(response);
      if (!response.ok || !envelope.success) return null;
      accessToken = envelope.data.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      // Allow a future refresh once this attempt settles.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

async function performRequest<T>(
  path: string,
  options: RequestOptions,
  retry: boolean,
): Promise<T> {
  const { method = 'GET', body, query, signal, headers = {} } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const requestHeaders: Record<string, string> = { accept: 'application/json', ...headers };
  if (!isFormData && body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (accessToken) requestHeaders.authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers: requestHeaders,
      ...(body !== undefined
        ? { body: isFormData ? (body as FormData) : JSON.stringify(body) }
        : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Unable to reach the VorldX Saarthi server. Check that the API is running and try again.',
    );
  }

  const envelope = await readEnvelope<T>(response);

  if (response.ok && envelope.success) return envelope.data;

  const error = envelope.success
    ? { code: ErrorCode.INTERNAL_ERROR, message: 'Unexpected response from the server.' }
    : envelope.error;

  // One transparent refresh-and-retry for an expired access token.
  if (response.status === 401 && retry && !options.skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return performRequest<T>(path, options, false);
    accessToken = null;
    onUnauthenticated?.();
  }

  throw new ApiError(response.status, error.code, error.message, error.details);
}

export function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return performRequest<T>(path, options, true);
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>(path, {
      method: 'GET',
      ...(query ? { query } : {}),
      ...(signal ? { signal } : {}),
    }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  refresh: refreshAccessToken,
};

/** Absolute URL for a document/file endpoint (used by download links). */
export function absoluteApiUrl(path: string): string {
  return `${API_BASE}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

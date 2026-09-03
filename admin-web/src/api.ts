/**
 * Birhan Admin — API client for Better Auth backend.
 *
 * Mirrors the mobile app's src/lib/api.ts. Every request goes through apiFetch:
 * attaches the JWT, normalises the { error: { code, message } } envelope,
 * and throws ApiError on non-2xx responses.
 */

const API_BASE = import.meta.env.VITE_API_URL;

if (!API_BASE) {
  throw new Error(
    'Missing VITE_API_URL. Set it in .env.local to the Birhan API base URL, ' +
    'e.g. https://api.birhan.online',
  );
}

const TOKEN_KEY = 'birhan_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type FetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function apiFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers: extraHeaders, signal } = opts;

  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: any = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }

  if (!res.ok) {
    throw new ApiError(
      payload?.error?.message || `Request failed (${res.status})`,
      res.status,
      payload?.error?.code || 'UNKNOWN',
    );
  }

  return payload as T;
}

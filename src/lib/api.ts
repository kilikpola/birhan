import * as SecureStore from 'expo-secure-store';
import { reportError } from './errors';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL && __DEV__) {
  // In development, warn loudly but don't crash — the error will surface
  // on the first apiFetch call anyway.
  console.warn('[api] EXPO_PUBLIC_API_URL not set — network requests will fail');
}

/**
 * NO COLON. expo-secure-store validates keys against /^[\w.-]+$/ and throws
 * `Invalid key provided to SecureStore` on anything else — a colon is not in
 * that set. This key used to be `birhan:auth_token`, which meant every
 * setItemAsync threw: sign-in failed, and a signup created the account
 * server-side and then could not store the session, stranding the user on
 * "your account was created" with no way forward.
 */
const TOKEN_KEY = 'birhan_auth_token';

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (err) {
    // A keychain that cannot be read is the same as having no session. Never
    // let it throw into the launch path.
    reportError(err, 'api:getToken', undefined, false);
    return null;
  }
}

/**
 * Persists the session token. Returns whether it actually stuck.
 *
 * Deliberately does not throw. Whether the token reaches the keychain and
 * whether the user is signed in are two different questions: a failure here
 * should cost them persistence across restarts, not the session they just
 * paid for with a signup.
 */
export async function setToken(token: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return true;
  } catch (err) {
    reportError(err, 'api:setToken', undefined, false);
    return false;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (err) {
    reportError(err, 'api:clearToken', undefined, false);
  }
}

/** The backend rejected the request — `{error:{code,message}}`, unwrapped. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** `fetch` itself never got a response — no connectivity, not a server rejection. */
export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach `Authorization: Bearer <token>`. Default true. */
  auth?: boolean;
};

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;

  if (!API_URL) {
    throw new Error('EXPO_PUBLIC_API_URL is not configured. Check your environment variables.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // No response at all — DNS/TLS/connection failure, i.e. offline. Distinct
    // from the server answering with an error status.
    throw new OfflineError();
  }

  // 204 No Content and similar have no body to parse.
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const code = json?.error?.code ?? 'UNKNOWN_ERROR';
    const message = json?.error?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message);
  }

  return json as T;
}

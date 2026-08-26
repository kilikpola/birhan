import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import { apiFetch, getToken, setToken, clearToken, ApiError, OfflineError } from './api';

/**
 * Claims minted by backend/src/routes/auth.ts `createToken()` — the app's own
 * JWT, issued by /api/v1/auth/login and /signup. Not the separate Better Auth
 * plugin JWT (a different token, for a different purpose); this one is what
 * the app actually receives and decodes.
 */
type JwtClaims = {
  user_id: string;
  church_id: string | null;
  role: string;
  branch_id: string | null;
  email: string | null;
  email_verified: boolean;
  iat: number;
  exp: number;
};

export type Session = {
  token: string;
  user: {
    id: string;
    email: string | null;
    church_id: string | null;
    role: string;
    branch_id: string | null;
    email_verified: boolean;
  };
};

/**
 * Flat, snake_case shape — deliberately matches what explore.tsx, index.tsx,
 * and resources.ts already read (profile.church_id, profile.display_name,
 * profile.church_name_am, profile.branch_name, ...). Normalized here, once,
 * from the backend's camelCase GET /api/v1/me response (nested `church` /
 * `branch` relations) so those call sites don't need to change.
 */
export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  church_id: string;
  branch_id: string | null;
  role: string;
  language: 'am' | 'en';
  church_role: string | null;
  church_name_am: string | null;
  church_name_en: string | null;
  branch_name: string | null;
  email: string | null;
  email_verified: boolean;
};

export type SignUpParams = {
  email?: string;
  phone?: string;
  password: string;
  displayName: string;
  churchId: string;
  branchId?: string | null;
  /** Accepted and forwarded, but the backend's signup schema currently
   * ignores it — unknown fields are stripped, not rejected. Kept here only
   * because the existing call site (auth.tsx) already computes and sends it. */
  branchName?: string;
  churchRole?: string | null;
  language: 'am' | 'en';
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  /** True once the on-disk session has been read. Offline, no network call. */
  ready: boolean;
  isPastor: boolean;
  isSuperAdmin: boolean;
  signIn: (identifier: string, password: string) => Promise<{ error?: string }>;
  signUp: (params: SignUpParams) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

function sessionFromToken(token: string): Session | null {
  let claims: JwtClaims;
  try {
    claims = jwtDecode<JwtClaims>(token);
  } catch {
    return null;
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    return null; // expired — treat as signed out
  }
  return {
    token,
    user: {
      id: claims.user_id,
      email: claims.email,
      church_id: claims.church_id,
      role: claims.role,
      branch_id: claims.branch_id,
      email_verified: claims.email_verified,
    },
  };
}

/**
 * GET /api/v1/me returns Drizzle's camelCase shape with nested `church` /
 * `branch` relations: {..., displayName, churchId, branchId, church: {nameAm,
 * nameEn, ...}, branch: {nameAm, nameEn, ...} | null, email, emailVerified}.
 * Flattened to snake_case here to match the pre-existing call sites.
 */
function normalizeProfile(raw: any): Profile {
  return {
    id: raw.id,
    display_name: raw.displayName,
    phone: raw.phone ?? null,
    church_id: raw.churchId,
    branch_id: raw.branchId ?? null,
    role: raw.role,
    language: raw.language,
    church_role: raw.churchRole ?? null,
    church_name_am: raw.church?.nameAm ?? null,
    church_name_en: raw.church?.nameEn ?? null,
    // branch.nameEn exists on the backend too, but every current call site
    // (explore.tsx) reads a single `branch_name` with no language switch, so
    // only one can be carried through without inventing a field.
    branch_name: raw.branch?.nameAm ?? null,
    email: raw.email ?? null,
    email_verified: raw.emailVerified ?? false,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof OfflineError) {
    return 'No connection — please check your internet connection.';
  }
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  // Launch: read the token from disk only — no network call, so the app opens
  // offline. The JWT's own claims are enough to gate the UI immediately;
  // the richer profile loads opportunistically once there's connectivity.
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        const s = sessionFromToken(token);
        if (s) {
          setSession(s);
        } else {
          await clearToken(); // expired or corrupt — don't keep a dead token
        }
      }
      setReady(true);
    })();
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const raw = await apiFetch<any>('/api/v1/me');
      setProfile(normalizeProfile(raw));
    } catch (err) {
      // Offline or a transient failure: keep whatever is already in state
      // rather than blanking a screen that was rendering fine a moment ago.
      if (!(err instanceof OfflineError)) throw err;
    }
  }, []);

  useEffect(() => {
    if (session) {
      refreshProfile().catch(() => {});
    } else {
      setProfile(null);
    }
  }, [session, refreshProfile]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    try {
      const res = await apiFetch<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        body: { identifier, password },
        auth: false,
      });
      await setToken(res.token);
      setSession(sessionFromToken(res.token));
      return {};
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }, []);

  const signUp = useCallback(async (params: SignUpParams) => {
    try {
      const res = await apiFetch<{ token: string }>('/api/v1/auth/signup', {
        method: 'POST',
        body: {
          email: params.email,
          phone: params.phone,
          password: params.password,
          displayName: params.displayName,
          churchId: params.churchId,
          branchId: params.branchId ?? null,
          branchName: params.branchName,
          churchRole: params.churchRole ?? null,
          language: params.language,
        },
        auth: false,
      });
      await setToken(res.token);
      setSession(sessionFromToken(res.token));
      return {};
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort — a stateless JWT means there's nothing server-side that
    // must succeed for sign-out to be real; clearing the local token is what
    // actually signs the device out.
    apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    await clearToken();
    setSession(null);
    setProfile(null);
  }, []);

  // profile.role (fresh from GET /me) wins whenever it's available — the JWT
  // claim is a snapshot from whenever the token was minted, so it can go
  // stale for up to its 30-day life if a role changes mid-session (a pastor
  // demoted, an account frozen). The JWT claim is the fallback only for the
  // offline cold-launch window before the first refreshProfile() completes.
  const role = profile?.role ?? session?.user.role;
  const isPastor = role === 'pastor' || role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';

  return (
    <Ctx.Provider
      value={{ session, profile, ready, isPastor, isSuperAdmin, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </Ctx.Provider>
  );
}

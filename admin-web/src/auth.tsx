import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch, ApiError, getToken, setToken as persistToken, clearToken } from './api';
import { isConsoleRole, type Profile } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AuthState = {
  /** Non-null when signed in. The JWT string is the proof of session. */
  session: { token: string } | null;
  profile: Profile | null;
  /** False while we still do not know enough to choose a screen. */
  ready: boolean;
  authorized: boolean;
  /**
   * Set when the profile could not be loaded for a reason that is *not* "your
   * session is invalid" — a 500, a CORS failure, an offline moment. Distinct
   * from `authorized: false`, which is a real answer about a real account.
   */
  profileError: string | null;
  retryProfile: () => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be inside AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  // Load persisted token on mount
  useEffect(() => {
    const stored = getToken();
    if (stored) setToken(stored);
    setBootstrapped(true);
  }, []);

  // Fetch profile from the backend /api/v1/me.
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const data = await apiFetch<Profile>('/api/v1/me');
      setProfile(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The session really is no good. Back to the login form.
        clearToken();
        setToken(null);
        setProfile(null);
      } else {
        // Everything else — a 500, a CORS failure, a dropped connection — says
        // nothing about who this account is. Swallowing it used to leave
        // `profile` null, which reads as `authorized === false`, which put a
        // legitimate super admin on the "this isn't a super admin" screen with
        // no way back. Say what happened and offer the retry.
        setProfileError(err instanceof Error ? err.message : 'Could not load your profile');
        setProfile(null);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Reload profile when the token changes, or when a retry is asked for.
  useEffect(() => {
    if (token) {
      loadProfile();
    } else {
      setProfile(null);
      setProfileError(null);
    }
  }, [token, loadProfile, retryTick]);

  const retryProfile = useCallback(() => setRetryTick((n) => n + 1), []);

  // Sign in via the backend API
  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiFetch<{ token: string }>('/api/v1/auth/login', {
        method: 'POST',
        auth: false,
        body: { identifier: email, password },
      });
      persistToken(data.token);
      setToken(data.token);
      return {};
    } catch (err) {
      if (err instanceof ApiError) return { error: err.message };
      return { error: 'Network error. Please try again.' };
    }
  }, []);

  // Sign out — clear local token, no server call needed
  const signOut = useCallback(async () => {
    if (tokenRef.current) {
      try {
        await apiFetch('/api/v1/auth/logout', { method: 'POST' });
      } catch { /* ignore */ }
    }
    clearToken();
    setToken(null);
    setProfile(null);
  }, []);

  const authorized = !!profile && isConsoleRole(profile.role);

  // Not ready until the profile question is actually settled. Flipping this on
  // as soon as the token was restored meant the first render after a reload had
  // a session but no profile yet, and the app rendered the access-denied screen
  // in that gap — a flash at best, and permanent whenever the request failed.
  const ready = bootstrapped && !profileLoading;

  return (
    <Ctx.Provider
      value={{
        session: token ? { token } : null,
        profile,
        ready,
        authorized,
        profileError,
        retryProfile,
        signIn,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
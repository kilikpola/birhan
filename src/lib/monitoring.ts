import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

/**
 * Error + performance monitoring (Sentry) for the mobile client.
 *
 * Design rules:
 * - **Fails safe.** Without a DSN (local dev, Expo Go, CI, tests) every function
 *   here is a no-op. The offline Bible must never be blocked by monitoring.
 * - **No PII.** We attach only the user's id — never name, email, church, or
 *   phone. See `setMonitoringUser`.
 * - **Context on every event:** environment, release (commit SHA), and — once a
 *   user signs in — their id.
 *
 * Source maps are uploaded at build time by the `@sentry/react-native/expo`
 * config plugin (see app.json) using SENTRY_AUTH_TOKEN; see docs/MONITORING.md.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Environment: explicit EXPO_PUBLIC_ENV wins; otherwise dev vs production.
const ENVIRONMENT =
  process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production');

// Release = the commit SHA injected at build time, falling back to the app
// version + native build id so events are always tied to *something*.
const RELEASE =
  process.env.EXPO_PUBLIC_COMMIT_SHA ??
  `${Constants.expoConfig?.version ?? '0.0.0'}`;

let initialized = false;

/**
 * expo-router navigation instrumentation. Exported so the root layout can
 * register the navigation container ref for route/transaction naming.
 */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

/** Initialise Sentry once, as early as possible. No-op without a DSN. */
export function initMonitoring(): void {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    // Keep events lean and PII-free; we set the user id ourselves.
    sendDefaultPii: false,
    // Capture unhandled JS errors and native crashes (defaults on). Performance
    // sampled modestly — dial via env without a code change.
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.2),
    integrations: [navigationIntegration],
  });
  initialized = true;
}

/** Attach the signed-in user's id to every subsequent event. Id only — no PII. */
export function setMonitoringUser(userId: string): void {
  if (!initialized) return;
  Sentry.setUser({ id: userId });
}

/** Clear the user on sign-out so events aren't misattributed. */
export function clearMonitoringUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

/**
 * Report a caught error to Sentry with a context tag. Safe to call always;
 * no-op until `initMonitoring` has run with a DSN. `reportError` (errors.ts)
 * calls this for production events.
 */
export function captureMonitoringError(error: unknown, context: string): void {
  if (!initialized) return;
  Sentry.captureException(error, { tags: { context } });
}

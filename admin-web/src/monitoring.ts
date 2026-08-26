import * as Sentry from '@sentry/react';

/**
 * Error + performance monitoring (Sentry) for the admin console.
 *
 * Same rules as the mobile client: fails safe without a DSN, attaches only the
 * user id (no PII), and tags every event with environment + release. Source
 * maps are uploaded by @sentry/vite-plugin at build time (see vite.config.ts).
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENVIRONMENT = (import.meta.env.VITE_ENV as string | undefined) ?? import.meta.env.MODE;
const RELEASE = import.meta.env.VITE_COMMIT_SHA as string | undefined;

let initialized = false;

/** Initialise Sentry once. No-op without a DSN (local dev / preview). */
export function initMonitoring(): void {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.2),
  });
  initialized = true;
}

/** Attach the signed-in admin's user id (id only — no PII). */
export function setMonitoringUser(userId: string): void {
  if (!initialized) return;
  Sentry.setUser({ id: userId });
}

/** Clear the user on sign-out. */
export function clearMonitoringUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

/** Report a caught error with a context tag. Safe to call always. */
export function captureMonitoringError(error: unknown, context: string): void {
  if (!initialized) return;
  Sentry.captureException(error, { tags: { context } });
}

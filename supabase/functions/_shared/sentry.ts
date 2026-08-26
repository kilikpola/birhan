// Shared Sentry helper for Edge Functions (Deno runtime).
//
// Fails safe: without SENTRY_DSN every wrapper is a pass-through, so functions
// run identically whether or not monitoring is configured. Each request gets a
// request id (tagged on every event and returned in error responses) plus
// environment + release tags. Set these as Edge Function secrets:
//   SENTRY_DSN, SENTRY_ENVIRONMENT (staging|production), SENTRY_RELEASE (SHA).
import * as Sentry from 'npm:@sentry/deno@^8';

const DSN = Deno.env.get('SENTRY_DSN');
const ENVIRONMENT = Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production';
const RELEASE = Deno.env.get('SENTRY_RELEASE');

let initialized = false;
function ensureInit(): void {
  if (initialized || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    tracesSampleRate: Number(Deno.env.get('SENTRY_TRACES_RATE') ?? 0.2),
  });
  initialized = true;
}
ensureInit();

function err500(requestId: string): Response {
  return new Response(JSON.stringify({ error: 'internal', request_id: requestId }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
  });
}

type Handler = (req: Request, requestId: string) => Promise<Response>;

/**
 * Wrap an Edge Function handler so any *unhandled* throw is reported to Sentry
 * (with request id / function / environment tags) and returned as a 500 that
 * carries the request id. Expected control-flow responses (400/401/403 the
 * handler returns itself) are untouched — they're not errors.
 */
export function withSentry(fnName: string, handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    ensureInit();
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

    if (!DSN) {
      try {
        return await handler(req, requestId);
      } catch (err) {
        console.error(`[${fnName}] ${requestId}`, err);
        return err500(requestId);
      }
    }

    return await Sentry.withScope(async (scope) => {
      scope.setTag('function', fnName);
      scope.setTag('request_id', requestId);
      scope.setTag('environment', ENVIRONMENT);
      try {
        return await handler(req, requestId);
      } catch (err) {
        Sentry.captureException(err);
        await Sentry.flush(2000);
        console.error(`[${fnName}] ${requestId}`, err);
        return err500(requestId);
      }
    });
  };
}

/**
 * Report an error to Sentry without changing the response — for handlers that
 * must return a specific status on failure (e.g. the Telegram webhook must
 * always answer 200 so Telegram doesn't retry). Call inside a withSentry
 * handler so the request tags apply.
 */
export function captureError(err: unknown): void {
  if (!DSN) return;
  Sentry.captureException(err);
  // fire-and-forget flush; don't block the response
  Sentry.flush(2000).catch(() => {});
}

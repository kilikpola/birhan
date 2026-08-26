// debug-error — deliberate test error to verify the Edge Function Sentry
// pipeline end to end. Gated behind DEBUG_ERROR_SECRET so it can't be spammed
// publicly. Deploy only where you intend to test; safe to leave deployed since
// it's a no-op without the secret.
//
//   curl -X POST 'https://<REF>.functions.supabase.co/debug-error' \
//     -H 'x-debug-secret: <DEBUG_ERROR_SECRET>'          # throws -> 500, captured
//   ...?mode=message                                      # captureMessage -> 200
//
// Deploy:  supabase functions deploy debug-error
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';

const DEBUG_SECRET = Deno.env.get('DEBUG_ERROR_SECRET');

serve(
  withSentry('debug-error', async (req, requestId) => {
    const url = new URL(req.url);
    const provided = req.headers.get('x-debug-secret') ?? url.searchParams.get('secret');

    // Fail closed: without the secret configured, or on mismatch, look like 404.
    if (!DEBUG_SECRET || provided !== DEBUG_SECRET) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if ((url.searchParams.get('mode') ?? 'throw') === 'throw') {
      // withSentry captures this and returns a 500 carrying the request id.
      throw new Error(`Birhan edge Sentry test: deliberate throw (request ${requestId})`);
    }

    return new Response(JSON.stringify({ ok: true, request_id: requestId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
    });
  }),
);

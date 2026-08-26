// health — liveness + DB-connectivity probe for deploy gating and uptime checks.
//
// Returns 200 {status:"ok"} when the function can reach Postgres, else 503.
// The deploy workflow polls this after deploying; a non-200 fails the deploy
// and triggers rollback. Public (no JWT) so uptime monitors can hit it — deploy
// with `--no-verify-jwt` (or set verify_jwt=false in config.toml).
//
// Deploy:  supabase functions deploy health --no-verify-jwt
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ENVIRONMENT = Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production';

serve(
  withSentry('health', async (_req, requestId) => {
    const started = Date.now();
    const headers = { 'Content-Type': 'application/json', 'x-request-id': requestId };

    try {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      // Cheapest possible round-trip that proves DB connectivity + RLS bypass.
      const { error } = await supabase.from('churches').select('id', { head: true, count: 'exact' });
      if (error) throw error;

      return new Response(
        JSON.stringify({ status: 'ok', environment: ENVIRONMENT, db_ms: Date.now() - started }),
        { status: 200, headers },
      );
    } catch (err) {
      // Return 503 (not a thrown 500) so the deploy gate reads it as "unhealthy"
      // rather than "crashed", but the error still reaches Sentry via the caller.
      return new Response(
        JSON.stringify({ status: 'error', error: String(err), environment: ENVIRONMENT }),
        { status: 503, headers },
      );
    }
  }),
);

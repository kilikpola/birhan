// notify-announcement — Expo push fan-out for a new announcement.
//
// Invoked by a Database Webhook on INSERT into `announcements` (see
// supabase/PUSH_SETUP.md). Looks up every member of the church that has a push
// token and sends them the announcement via the Expo push service, which
// delivers over FCM on Android. Uses the service role (auto-injected into
// deployed functions) so it can read tokens across the church, which RLS
// would otherwise hide.
//
// Deploy:  supabase functions deploy notify-announcement

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { withSentry } from '../_shared/sentry.ts';

type AnnouncementRecord = {
  id?: string;
  church_id?: string;
  author_id?: string;
  title_am?: string | null;
  title_en?: string | null;
  body?: string | null;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// This function fans a push out to an ENTIRE church. It is a server-to-server
// hook (the Database Webhook on `announcements` INSERT), never called by the
// app, so it must reject anything that isn't the trusted caller — otherwise any
// authenticated user could spam every member of any church. We fail CLOSED:
// the request is accepted only if it carries either the service-role key (which
// the dashboard webhook already sends) or a configured shared secret.
function isTrustedCaller(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (serviceKey && bearer === serviceKey) return true;

  const secret = Deno.env.get('NOTIFY_WEBHOOK_SECRET');
  if (secret && req.headers.get('x-webhook-secret') === secret) return true;

  return false;
}

Deno.serve(withSentry('notify-announcement', async (req) => {
  try {
    if (!isTrustedCaller(req)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const payload = await req.json();
    // Accept both a Database-Webhook payload ({ record }) and a direct call.
    const record: AnnouncementRecord = payload.record ?? payload;
    const churchId = record.church_id;

    if (!churchId) {
      return json({ error: 'missing church_id' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Tokens live in `push_tokens` (see 15_security_hardening.sql). Join to
    // profiles to scope by church; the service role bypasses RLS so it reads
    // every member's token for the fan-out.
    let query = supabase
      .from('push_tokens')
      .select('token, user_id, profiles!inner(church_id)')
      .eq('profiles.church_id', churchId);

    // Don't notify the pastor who just posted it.
    if (record.author_id) query = query.neq('user_id', record.author_id);

    const { data: rows, error } = await query;
    if (error) throw error;

    const tokens = (rows ?? [])
      .map((r) => (r as { token?: string }).token as string)
      .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));

    if (tokens.length === 0) return json({ sent: 0 });

    const title = record.title_am || record.title_en || 'New announcement';
    const body = (record.body ?? '').slice(0, 178);

    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      channelId: 'announcements',
      data: { type: 'announcement', announcement_id: record.id, church_id: churchId },
    }));

    // Expo accepts up to 100 messages per request.
    const receipts: unknown[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      receipts.push(await res.json());
    }

    return json({ sent: tokens.length, receipts });
  } catch (err) {
    // withSentry captures and returns a 500 with a request id.
    throw err;
  }
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

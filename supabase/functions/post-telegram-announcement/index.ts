import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/sentry.ts';
import { escapeHtml } from '../_shared/html.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// Service-role client: bypasses RLS for the lookups we do AFTER we've
// authorized the caller ourselves. Never trust the request body's churchId
// without first proving the caller is a pastor of that church.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const jsonHeaders = { 'Content-Type': 'application/json' };
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

async function sendTelegramMessageWithBackoff(chatId: string, text: string, maxRetries = 3): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });

    if (res.ok) {
      return true;
    }

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retryAfter = (data?.parameters?.retry_after || 2) * 1000;
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      continue;
    }

    const errBody = await res.text().catch(() => '');
    console.error(`Telegram send failed [${res.status}]:`, errBody);
    return false;
  }

  return false;
}

serve(withSentry('post-telegram-announcement', async (req) => {
  try {
    // ---- 1. Authenticate the caller from their JWT ----
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return json({ error: 'Missing Authorization bearer token' }, 401);
    }

    // Resolve the token to a user WITHOUT service-role privileges.
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired session' }, 401);
    }
    const callerId = userData.user.id;

    // ---- 2. Parse & validate the payload ----
    const { announcementId, churchId, title, body } = await req.json();
    if (!announcementId || !churchId || !body) {
      return json({ error: 'Missing required payload parameters' }, 400);
    }

    // ---- 3. Authorize: caller must be a pastor/admin OF THIS church ----
    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('role, church_id')
      .eq('id', callerId)
      .single();

    if (pErr || !profile) {
      return json({ error: 'Profile not found' }, 403);
    }
    const canPost = ['pastor', 'admin', 'super_admin'].includes(profile.role);
    const ownsChurch = profile.church_id === churchId || profile.role === 'super_admin';
    if (!canPost || !ownsChurch) {
      return json({ error: 'Not authorized to post for this church' }, 403);
    }

    // ---- 4. The announcement must actually exist and belong to this church ----
    const { data: ann, error: aErr } = await admin
      .from('announcements')
      .select('id, church_id')
      .eq('id', announcementId)
      .single();
    if (aErr || !ann || ann.church_id !== churchId) {
      return json({ error: 'Announcement does not belong to this church' }, 400);
    }

    // ---- 5. Look up the linked Telegram chat ----
    const { data: church, error: cErr } = await admin
      .from('churches')
      .select('telegram_chat_id')
      .eq('id', churchId)
      .single();

    if (cErr || !church?.telegram_chat_id) {
      return json({ error: 'Church has no linked Telegram group' }, 400);
    }

    // ---- 6. Format (escaped) and send ----
    const formattedTitle = title ? `<b>${escapeHtml(title)}</b>\n\n` : '';
    const attribution = '\n\n— ከብርሃን መተግበሪያ የተላከ / Posted via Birhan';
    const messageText = `${formattedTitle}${escapeHtml(body)}${attribution}`;

    const success = await sendTelegramMessageWithBackoff(church.telegram_chat_id, messageText);

    if (success) {
      await admin
        .from('announcements')
        .update({ posted_to_telegram: true })
        .eq('id', announcementId);

      return json({ ok: true, posted: true }, 200);
    }
    return json({ error: 'Failed to post message to Telegram API' }, 502);
  } catch (err) {
    // Let withSentry capture the unexpected error and return a 500 with a
    // request id. Expected control-flow responses above already returned.
    throw err;
  }
}));

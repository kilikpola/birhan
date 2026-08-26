import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry, captureError } from '../_shared/sentry.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(withSentry('telegram-webhook', async (req) => {
  // 1. Verify the Telegram webhook secret (header or URL query param).
  // FAIL CLOSED: if no secret is configured, reject every request. Without this
  // gate an attacker could POST a forged update and, by brute-forcing a short
  // BIRHAN-XXXX link code inside its 10-minute window, repoint a church's
  // telegram_chat_id at a chat they control — hijacking that church's feed.
  // Set the secret as an Edge Function secret AND pass it to Telegram's
  // setWebhook `secret_token` (see the deploy notes).
  if (!TELEGRAM_WEBHOOK_SECRET) {
    console.error('TELEGRAM_WEBHOOK_SECRET is not set — refusing all webhook calls.');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token');
  const secretQuery = new URL(req.url).searchParams.get('secret');
  if (secretHeader !== TELEGRAM_WEBHOOK_SECRET && secretQuery !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized secret token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const update = await req.json();

    // 2. Strict Filter: Only process link codes matching BIRHAN-XXXX or chat member updates.
    // Discard all other user messages immediately without logging or storing.
    if (update.message && update.message.text) {
      const text = String(update.message.text).trim().toUpperCase();
      const chatId = String(update.message.chat.id);

      // Link code pattern: BIRHAN-XXXX (alphanumeric 4-6 chars)
      if (/^BIRHAN-[A-Z0-9]{4,6}$/.test(text)) {
        // Query active unconsumed link code
        const { data: linkCode, error: codeErr } = await supabase
          .from('telegram_link_codes')
          .select('id, church_id, expires_at')
          .eq('code', text)
          .is('consumed_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();

        if (linkCode && !codeErr) {
          // Mark code as consumed
          await supabase
            .from('telegram_link_codes')
            .update({ consumed_at: new Date().toISOString() })
            .eq('id', linkCode.id);

          // Update church telegram_chat_id and verified timestamp
          await supabase
            .from('churches')
            .update({
              telegram_chat_id: chatId,
              telegram_verified_at: new Date().toISOString(),
            })
            .eq('id', linkCode.church_id);

          // Send Telegram confirmation message
          if (TELEGRAM_BOT_TOKEN) {
            const confirmText =
              '✦ ይህ የቤተ ክርስቲያን የቴሌግራም ግሩፕ ከብርሃን መተግበሪያ ጋር በተሳካ ሁኔታ ተገናኝቷል!\n\nBirhan app has successfully linked to this Telegram group.';
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: confirmText,
              }),
            });
          }
        }
      }
    }

    // Always respond 200 OK to Telegram
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Report the error, but STILL answer 200 — Telegram retries aggressively on
    // any non-2xx and we don't want a redelivery storm.
    captureError(err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}));

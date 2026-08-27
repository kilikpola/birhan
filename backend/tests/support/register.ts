import { eq } from "drizzle-orm";

import { db } from "./pglite-db.js";
import * as schema from "../../src/db/schema.js";

/**
 * Driving the three-step registration from suites where *having an account* is
 * a fixture rather than the thing under test.
 *
 * Signup is no longer one call: details go to /auth/telegram/start, Telegram
 * confirms an identity through the webhook, and only then does /auth/signup
 * create anything. Suites about email verification or mail delivery should not
 * have to care, so they call registerAccount() and get the same shape back that
 * /auth/signup always returned.
 *
 * The Telegram half is written straight to the row here rather than driven
 * through the webhook. That is deliberate: it keeps these suites from needing a
 * Bot API mock they have no other use for. The webhook path itself — which is
 * where the security actually lives — is exercised end to end in
 * telegram-registration.test.ts, against the real deep link.
 */

export type CallFn = (
  path: string,
  opts?: { method?: string; body?: unknown; token?: string; ip?: string; accept?: string },
) => Promise<{ status: number; json: Record<string, any> | null }>;

export type Json = Record<string, any>;

let telegramSeq = 0;

/** Step 3 of the wizard: hand over the details, get a deep link back. */
export function startRegistration(call: CallFn, body: Json) {
  return call("/api/v1/auth/telegram/start", { method: "POST", body });
}

/**
 * Stands in for the webhook having seen this person say hello to the bot.
 *
 * Writes the two columns the webhook writes, and nothing else — if a client
 * could reach this state on its own, the whole feature would be decorative.
 */
export async function confirmTelegram(
  pendingId: string,
  opts: { telegramUserId?: string; telegramUsername?: string | null } = {},
): Promise<string> {
  const telegramUserId = opts.telegramUserId ?? `tg-${++telegramSeq}`;
  await db
    .update(schema.pendingRegistrations)
    .set({
      telegramUserId,
      telegramUsername: opts.telegramUsername ?? `user${telegramSeq}`,
      telegramConfirmedAt: new Date(),
    })
    .where(eq(schema.pendingRegistrations.id, pendingId));
  return telegramUserId;
}

/** The final step. */
export function completeSignup(call: CallFn, pendingRegistrationId: string) {
  return call("/api/v1/auth/signup", {
    method: "POST",
    body: { pendingRegistrationId },
  });
}

/**
 * All three steps. Returns whatever the last one returned, so a caller that
 * used to assert on the /auth/signup response still can.
 *
 * If /telegram/start refuses — a duplicate address, an unknown church — that
 * refusal is returned as-is. The details are validated there now, so that is
 * where those failures surface.
 */
export async function registerAccount(call: CallFn, body: Json): Promise<{
  status: number;
  json: Record<string, any> | null;
  telegramUserId?: string;
}> {
  const started = await startRegistration(call, body);
  if (started.status !== 200 || !started.json?.pendingId) return started;

  const telegramUserId = await confirmTelegram(started.json.pendingId);
  const done = await completeSignup(call, started.json.pendingId);
  return { ...done, telegramUserId };
}

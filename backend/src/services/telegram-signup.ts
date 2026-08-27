import { and, eq, isNull, lt, or } from "drizzle-orm";

import { db } from "../db/index.js";
import { pendingRegistrations, profiles } from "../db/schema.js";
import { config, telegramSignupEnabled, telegramStartLink } from "../config/index.js";
import { logger } from "../middleware/logger.js";
import { Errors } from "../utils/errors.js";
import { issueToken, verifierMatches } from "../utils/tokens.js";

/**
 * Proving that a person controls a Telegram account, before they get a Birhan
 * account at all.
 *
 * This is a different problem from services/telegram.ts, which links a
 * *church's group* to a church. Here the subject is a *person's identity*, and
 * the asymmetry that makes it work is the same one that makes the group flow
 * work: the only way the backend can learn a Telegram user id is for the bot to
 * be told it by Telegram itself. A username typed into a form, an id typed into
 * a form, a phone number — none of those are evidence of anything, because the
 * client is the party being checked. So the client never asserts this state;
 * the webhook does, and the client can only ask what the webhook found.
 *
 * The handshake is Telegram's `?start=` deep link. Unlike the six-character
 * group code — which a human has to retype in front of a congregation, and is
 * therefore short and defended by being single-use and short-lived — this token
 * is never typed by anyone. It travels in a URL, so it can be full strength.
 */

// Telegram allows 1-64 characters in a `start` payload, from [A-Za-z0-9_-].
// A `.` is not in that set, so the selector/verifier pair travels concatenated
// rather than dotted: the selector is a fixed 16 hex chars, which makes the
// split unambiguous without a separator. 16 + 43 = 59 characters.
const SELECTOR_LEN = 16;
const MAX_PAYLOAD_LEN = 64;

function buildPayload(selector: string, verifier: string): string {
  return `${selector}${verifier}`;
}

/** Splits a `/start` payload back into its halves. Null for anything malformed. */
export function parsePayload(payload: string): { selector: string; verifier: string } | null {
  if (typeof payload !== "string") return null;
  const trimmed = payload.trim();
  if (trimmed.length <= SELECTOR_LEN || trimmed.length > MAX_PAYLOAD_LEN) return null;
  // Reject anything outside Telegram's own payload alphabet before it reaches
  // the database — a value that could not have come from us cannot match a row.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;

  const selector = trimmed.slice(0, SELECTOR_LEN);
  const verifier = trimmed.slice(SELECTOR_LEN);
  if (!/^[0-9a-f]{16}$/.test(selector)) return null;

  return { selector, verifier };
}

export interface StartRegistrationInput {
  displayName: string;
  email: string | null;
  phone: string | null;
  /** Already argon2-hashed by the caller. This function never sees a password. */
  passwordHash: string;
  churchId: string;
  branchId: string | null;
  churchRole: string | null;
  language: "am" | "en";
}

export interface StartedRegistration {
  pendingId: string;
  deepLink: string;
  expiresAt: string;
}

/**
 * Sweeps registrations that were abandoned or already used.
 *
 * Called opportunistically from startPendingRegistration rather than on a
 * timer: these rows hold a password hash and contact details for someone who
 * never finished, so they should not outlive their usefulness, but they are also
 * low-volume enough that a dedicated scheduler would be more moving parts than
 * the problem deserves. A cron calling this would be strictly better; nothing
 * here depends on one existing.
 */
export async function sweepExpiredRegistrations(): Promise<void> {
  try {
    await db
      .delete(pendingRegistrations)
      .where(or(
        lt(pendingRegistrations.expiresAt, new Date()),
        // Consumed rows have already produced an account; keeping the hash
        // around afterwards serves nothing.
        lt(pendingRegistrations.consumedAt, new Date()),
      ));
  } catch (err) {
    // Housekeeping must never fail a registration.
    logger.warn({ err, event: "registration.sweep_failed" }, "Could not sweep pending registrations");
  }
}

export async function startPendingRegistration(
  input: StartRegistrationInput,
): Promise<StartedRegistration> {
  if (!telegramSignupEnabled) {
    throw Errors.unavailable(
      "TELEGRAM_DISABLED",
      "Registration is temporarily unavailable on this server.",
    );
  }

  await sweepExpiredRegistrations();

  const expiresAt = new Date(Date.now() + config.pendingRegistrationTtlMinutes * 60 * 1000);

  // `token_selector` is unique, so a collision is a constraint violation rather
  // than one registration silently shadowing another.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const issued = issueToken();
    try {
      const [row] = await db
        .insert(pendingRegistrations)
        .values({
          displayName: input.displayName,
          email: input.email,
          phone: input.phone,
          passwordHash: input.passwordHash,
          churchId: input.churchId,
          branchId: input.branchId,
          churchRole: input.churchRole,
          language: input.language,
          tokenSelector: issued.selector,
          tokenVerifierHash: issued.verifierHash,
          expiresAt,
        })
        .returning();

      const verifier = issued.token.slice(issued.selector.length + 1);
      return {
        pendingId: row.id,
        deepLink: telegramStartLink(buildPayload(issued.selector, verifier)),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      const isUnique =
        typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
      if (!isUnique) throw err;
    }
  }

  throw Errors.internal("Could not start registration");
}

export type PendingStatus =
  | { status: "waiting"; expiresAt: string }
  | { status: "connected"; telegramUsername: string | null; expiresAt: string }
  | { status: "already_linked" }
  | { status: "expired" }
  | { status: "not_found" }
  | { status: "consumed" };

/**
 * What the server actually believes about a pending registration.
 *
 * "already_linked" is reported rather than hidden. It is worth being explicit
 * about why that is not an oracle for "does this Telegram user have an
 * account": reaching it requires that Telegram account to have opened *this*
 * registration's deep link, which needs control of it. Someone who can arrange
 * that already knows the answer — and the bot has just told the account owner
 * the same thing directly. Leaving the app spinning instead would cost a real
 * person a clear explanation to buy nothing.
 */
export async function getPendingRegistrationStatus(pendingId: string): Promise<PendingStatus> {
  const row = await db.query.pendingRegistrations.findFirst({
    where: eq(pendingRegistrations.id, pendingId),
  });
  if (!row) return { status: "not_found" };
  if (row.consumedAt) return { status: "consumed" };
  if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  if (row.rejectedReason === "telegram_taken") return { status: "already_linked" };
  if (row.telegramUserId) {
    return {
      status: "connected",
      telegramUsername: row.telegramUsername,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  return { status: "waiting", expiresAt: row.expiresAt.toISOString() };
}

export type ConfirmOutcome =
  | { status: "confirmed"; displayName: string }
  | { status: "unknown_token" }
  | { status: "expired" }
  | { status: "used" }
  | { status: "already_confirmed" }
  | { status: "not_private" }
  | { status: "telegram_taken" };

export interface ConfirmInput {
  payload: string;
  telegramUserId: string;
  telegramUsername: string | null;
  chatType: string;
}

/**
 * Records a Telegram identity against a pending registration.
 *
 * Called only from the webhook. Every refusal is a distinct status because the
 * bot answers in the chat, and "expired" and "wrong link" have different fixes.
 */
export async function confirmTelegramForRegistration(
  input: ConfirmInput,
): Promise<ConfirmOutcome> {
  // A registration proves that *this person* controls an account. That only
  // means anything in a one-to-one chat: in a group, the bot would be taking
  // the word of whoever pasted the link, not of the account it belongs to.
  if (input.chatType !== "private") return { status: "not_private" };

  const parsed = parsePayload(input.payload);
  if (!parsed) return { status: "unknown_token" };

  const row = await db.query.pendingRegistrations.findFirst({
    where: eq(pendingRegistrations.tokenSelector, parsed.selector),
  });
  if (!row) return { status: "unknown_token" };

  // Constant-time over fixed-length digests — the lookup above was on the
  // public half, so the secret half is never used as a search key.
  if (!verifierMatches(parsed.verifier, row.tokenVerifierHash)) {
    return { status: "unknown_token" };
  }

  if (row.consumedAt) return { status: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  if (row.telegramUserId) {
    return row.telegramUserId === input.telegramUserId
      ? { status: "already_confirmed" }
      : { status: "used" };
  }

  // One Telegram identity, one Birhan account. Checked here so the bot can say
  // so in words; the partial unique index on profiles is what actually holds
  // the line, and signup re-checks it inside its transaction.
  const existing = await db.query.profiles.findFirst({
    where: eq(profiles.telegramUserId, input.telegramUserId),
  });
  if (existing) {
    // Recorded so the app can say the same thing the bot just said in the chat,
    // instead of polling a registration that is never going to complete.
    // Note this does NOT set telegramUserId — the registration stays unverified
    // and signup still refuses it.
    await db
      .update(pendingRegistrations)
      .set({ rejectedReason: "telegram_taken" })
      .where(eq(pendingRegistrations.id, row.id));
    return { status: "telegram_taken" };
  }

  // Conditional on still being unclaimed, so two /start messages racing on one
  // link cannot both win it.
  const claimed = await db
    .update(pendingRegistrations)
    .set({
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername,
      telegramConfirmedAt: new Date(),
    })
    .where(and(
      eq(pendingRegistrations.id, row.id),
      isNull(pendingRegistrations.telegramUserId),
      isNull(pendingRegistrations.consumedAt),
    ))
    .returning();

  if (claimed.length === 0) return { status: "used" };

  logger.info(
    { pendingId: row.id, event: "registration.telegram_confirmed" },
    "Telegram identity confirmed for a pending registration",
  );

  return { status: "confirmed", displayName: row.displayName };
}

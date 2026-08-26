import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, type DB } from "../db/index.js";
import { emailVerificationTokens, users } from "../db/schema.js";
import { config } from "../config/index.js";
import { issueToken, parseToken, verifierMatches } from "../utils/tokens.js";
import { sendVerificationEmail } from "./email.js";
import { logger } from "../middleware/logger.js";

/**
 * Either the pool or an open transaction. Signup issues its token inside the
 * same transaction that creates the user and the profile, so this has to accept
 * both.
 */
type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Transaction;

/** Where a verification link points. Reachable from a phone and from a desktop. */
export function verificationLink(token: string): string {
  return `${config.publicApiUrl}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Mints a token row and returns the plaintext token, which exists only in this
 * return value and in the email. Nothing is sent from here — the caller sends
 * after its transaction commits, so a rolled-back signup never mails a link to
 * an account that does not exist.
 */
export async function issueVerificationToken(
  exec: Executor,
  userId: string,
  email: string,
  opts: { isResend?: boolean } = {}
): Promise<{ token: string; expiresAt: Date; id: string }> {
  const { token, selector, verifierHash } = issueToken();
  const expiresAt = new Date(Date.now() + config.emailTokenTtlHours * 60 * 60 * 1000);

  const [row] = await exec.insert(emailVerificationTokens).values({
    userId,
    selector,
    verifierHash,
    email: email.toLowerCase().trim(),
    expiresAt,
    isResend: opts.isResend ?? false,
  }).returning({ id: emailVerificationTokens.id });

  return { token, expiresAt, id: row.id };
}

export type VerifyResult =
  | { status: "verified"; userId: string; email: string }
  | { status: "already_verified"; userId: string; email: string }
  | { status: "used" }
  | { status: "expired" }
  | { status: "invalid" };

/**
 * Checks a token and, if good, consumes it and marks the account verified.
 *
 * "used" and "expired" are distinct from "invalid" on purpose: both are states
 * a resend can fix, and telling someone their link expired is a far better
 * answer than a flat failure. None of the three reveal whether an address is
 * registered, because reaching any of them requires already holding a token.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyResult> {
  const parsed = parseToken(rawToken);
  if (!parsed) return { status: "invalid" };

  // Lookup is on the public half only.
  const row = await db.query.emailVerificationTokens.findFirst({
    where: eq(emailVerificationTokens.selector, parsed.selector),
  });
  if (!row) return { status: "invalid" };

  // Constant-time on the secret half.
  if (!verifierMatches(parsed.verifier, row.verifierHash)) return { status: "invalid" };

  if (row.consumedAt) return { status: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  return db.transaction(async (tx) => {
    // Single-use has to hold under two clicks landing at once, so consumption
    // is a conditional update rather than a read-then-write: whichever request
    // flips consumed_at first is the one that gets a row back.
    const consumed = await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.consumedAt)))
      .returning();

    if (consumed.length === 0) return { status: "used" } as const;

    const user = await tx.query.users.findFirst({ where: eq(users.id, row.userId) });
    if (!user) return { status: "invalid" } as const;

    // The address may have changed since the link was mailed. A token issued for
    // the old address must not verify the new one.
    const currentEmail = user.email?.toLowerCase().trim() ?? null;
    if (!currentEmail || currentEmail !== row.email) return { status: "invalid" } as const;

    if (user.emailVerified) {
      return { status: "already_verified", userId: user.id, email: currentEmail } as const;
    }

    await tx.update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Any other link still sitting in the inbox is now pointless — retire them
    // so an old mail cannot be replayed later.
    await tx.update(emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(emailVerificationTokens.userId, user.id),
        isNull(emailVerificationTokens.consumedAt),
      ));

    return { status: "verified", userId: user.id, email: currentEmail } as const;
  });
}

/** Resends issued to this account within the last hour. */
export async function countRecentResends(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.userId, userId),
      eq(emailVerificationTokens.isResend, true),
      gt(emailVerificationTokens.createdAt, since),
    ));
  return row?.count ?? 0;
}

export type ResendOutcome =
  | "sent"
  /** Token minted, but the mail endpoint refused it or was unreachable. */
  | "send_failed"
  | "already_verified"
  | "no_email"
  | "rate_limited"
  | "unknown_user";

/**
 * Issues a fresh token and mails it.
 *
 * Returns an outcome rather than throwing so the caller can decide how much to
 * disclose: the account-holder's own resend button gets the real answer, while
 * the by-address form is answered identically whatever happened here.
 */
export async function resendVerification(userId: string): Promise<ResendOutcome> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return "unknown_user";
  if (!user.email) return "no_email";
  if (user.emailVerified) return "already_verified";

  if (await countRecentResends(userId) >= config.emailResendPerHour) return "rate_limited";

  const { token, id } = await issueVerificationToken(db, userId, user.email, { isResend: true });
  const sent = await sendVerificationEmail({ to: user.email, link: verificationLink(token) });
  if (!sent) {
    // The token stays valid — a link that was minted is a link that should work
    // if it ever does reach someone — but it stops counting as a resend.
    //
    // countRecentResends only counts rows flagged isResend, and the route tells
    // the user "please try again shortly". Charging them for an attempt that
    // never reached the endpoint means three obedient retries during a mail
    // outage exhaust the hourly cap, and the fourth is refused for an hour over
    // sends that put nothing in an inbox.
    await db
      .update(emailVerificationTokens)
      .set({ isResend: false })
      .where(eq(emailVerificationTokens.id, id));

    logger.warn({ userId }, "Verification resend could not be delivered");
    return "send_failed";
  }

  return "sent";
}

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { db } from "../db/index.js";
import { passwordResetTokens, users } from "../db/schema.js";
import { config } from "../config/index.js";
import { issueToken, parseToken, verifierMatches } from "../utils/tokens.js";
import { sendPasswordResetEmail } from "./email.js";
import { logger } from "../middleware/logger.js";

/** Where a reset link points — a page a phone or a desktop can both open. */
export function resetLink(token: string): string {
  return `${config.publicApiUrl}/api/v1/auth/reset-password?token=${encodeURIComponent(token)}`;
}

async function issueResetToken(userId: string, email: string): Promise<string> {
  const { token, selector, verifierHash } = issueToken();
  const expiresAt = new Date(Date.now() + config.passwordResetTtlHours * 60 * 60 * 1000);

  await db.insert(passwordResetTokens).values({
    userId,
    selector,
    verifierHash,
    email: email.toLowerCase().trim(),
    expiresAt,
  });

  return token;
}

async function countRecentRequests(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.userId, userId),
      gt(passwordResetTokens.createdAt, since),
    ));
  return row?.count ?? 0;
}

export type ResetRequestOutcome = "sent" | "send_failed" | "no_account" | "no_password" | "rate_limited";

/**
 * Mints a reset token for an address and mails the link.
 *
 * Returns an outcome, but the route deliberately answers every case the same
 * way — otherwise this endpoint becomes a way to ask "does this person have a
 * Birhan account?", which for a congregation is not a stranger's question.
 * A phone-only account (no password-by-email path) is treated as "no_account".
 */
export async function requestPasswordReset(rawEmail: string): Promise<ResetRequestOutcome> {
  const email = rawEmail.toLowerCase().trim();
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (!user) return "no_account";
  // An account with no password hash (should not happen for email accounts) has
  // nothing to reset.
  if (!user.passwordHash) return "no_password";

  if (await countRecentRequests(user.id) >= config.passwordResetPerHour) {
    logger.info({ userId: user.id }, "Password-reset request suppressed by rate limit");
    return "rate_limited";
  }

  const token = await issueResetToken(user.id, email);
  const sent = await sendPasswordResetEmail({
    to: email,
    link: resetLink(token),
    ttlHours: config.passwordResetTtlHours,
  });

  if (!sent) {
    logger.error({ userId: user.id }, "Password-reset email could not be delivered");
    return "send_failed";
  }
  return "sent";
}

export type TokenState = "valid" | "used" | "expired" | "invalid";

/**
 * Reads a token's state without consuming it — what the reset page needs to
 * decide whether to show the form or an explanation.
 */
export async function checkResetToken(rawToken: string): Promise<TokenState> {
  const parsed = parseToken(rawToken);
  if (!parsed) return "invalid";

  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.selector, parsed.selector),
  });
  if (!row) return "invalid";
  if (!verifierMatches(parsed.verifier, row.verifierHash)) return "invalid";
  if (row.consumedAt) return "used";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "valid";
}

export type ResetResult =
  | { status: "reset" }
  | { status: "used" }
  | { status: "expired" }
  | { status: "invalid" };

/**
 * Consumes a token and sets the new password — one transaction, single-use.
 *
 * Consumption is a conditional update so two submits racing cannot both win.
 * On success every other outstanding reset token for the account is retired, so
 * an older link still in an inbox cannot be replayed.
 */
export async function consumeResetToken(rawToken: string, newPassword: string): Promise<ResetResult> {
  const parsed = parseToken(rawToken);
  if (!parsed) return { status: "invalid" };

  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.selector, parsed.selector),
  });
  if (!row) return { status: "invalid" };
  if (!verifierMatches(parsed.verifier, row.verifierHash)) return { status: "invalid" };
  if (row.consumedAt) return { status: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  const newHash = await hash(newPassword);

  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.consumedAt)))
      .returning();
    if (consumed.length === 0) return { status: "used" } as const;

    const user = await tx.query.users.findFirst({ where: eq(users.id, row.userId) });
    if (!user) return { status: "invalid" } as const;

    // The address may have changed since the link was mailed; a token issued for
    // the old address must not reset the account under a new one.
    const currentEmail = user.email?.toLowerCase().trim() ?? null;
    if (!currentEmail || currentEmail !== row.email) return { status: "invalid" } as const;

    await tx.update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Retire any other live reset links for this account.
    await tx.update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.consumedAt),
      ));

    return { status: "reset" } as const;
  });
}

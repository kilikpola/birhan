import { lt } from "drizzle-orm";

import { db } from "../db/index.js";
import { accountRevocations } from "../db/schema.js";
import { logger } from "../middleware/logger.js";

/**
 * Making a stateless token stop working.
 *
 * middleware/auth.ts verifies a JWT's signature and age and never touches the
 * database — that is what lets a read be served without a round trip, which
 * matters a great deal on the connections this app runs on. The price is that
 * deleting rows does not invalidate anything: a token minted before a deletion
 * stays valid for the rest of its 30 days.
 *
 * So revocation is a set, held in memory, checked on every request for the cost
 * of a hash lookup. The database table behind it is the durable copy, read at
 * boot and refreshed periodically. It stays small by construction: one entry
 * per deleted account, dropped once the longest-lived token that account could
 * have minted would have expired on its own.
 *
 * The refresh interval is what makes this correct across more than one process.
 * A revocation written by one instance is visible to the others within
 * REFRESH_MS — not instantly. That window is a deliberate trade against a
 * database read on every authenticated request; if this ever runs behind a load
 * balancer with a stricter requirement than "within a minute", the honest fix is
 * shared cache (Redis) rather than a shorter interval.
 */

const REFRESH_MS = 60_000;

/** Matches the "30d" expiry set in routes/auth.ts createToken(). */
export const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

let revoked = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Whether this user's tokens have been revoked. Hash lookup, no I/O. */
export function isRevoked(userId: string): boolean {
  return revoked.has(userId);
}

/**
 * Writes the durable revocation. Safe to run inside a transaction.
 *
 * Deliberately does NOT touch the in-memory set: if the surrounding transaction
 * rolls back, the row goes with it, and a set that had already been updated
 * would lock a user out of an account whose deletion failed — until the next
 * refresh quietly let them back in. Call markRevokedLocally() after the commit.
 */
export async function revokeUserTokens(
  userId: string,
  tx?: Pick<typeof db, "insert">,
): Promise<void> {
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  await (tx ?? db)
    .insert(accountRevocations)
    .values({ userId, expiresAt })
    .onConflictDoUpdate({
      target: accountRevocations.userId,
      set: { revokedAt: new Date(), expiresAt },
    });
}

/**
 * Applies a committed revocation to this process immediately, rather than
 * leaving it to the next refresh — the token that asked for the deletion is
 * usually the one that must stop working first.
 */
export function markRevokedLocally(userId: string): void {
  revoked.add(userId);
}

/** Reloads the set, dropping entries whose tokens have expired on their own. */
export async function refreshRevocations(): Promise<void> {
  try {
    await db.delete(accountRevocations).where(lt(accountRevocations.expiresAt, new Date()));
    const rows = await db.select({ userId: accountRevocations.userId }).from(accountRevocations);
    revoked = new Set(rows.map((r) => r.userId));
  } catch (err) {
    // Keep whatever is already loaded. Failing open on a transient database
    // error is wrong here, and failing closed would sign everyone out — the
    // last known set is the only safe answer.
    logger.warn({ err, event: "revocation.refresh_failed" }, "Could not refresh revocations");
  }
}

/** Called once at boot. Safe to call twice. */
export async function startRevocationRefresh(): Promise<void> {
  await refreshRevocations();
  if (timer) return;
  timer = setInterval(() => { void refreshRevocations(); }, REFRESH_MS);
  // Never hold the process open for a cache refresh.
  timer.unref?.();
}

/** Test seam. */
export function _resetRevocationsForTest(): void {
  revoked = new Set();
  if (timer) { clearInterval(timer); timer = null; }
}

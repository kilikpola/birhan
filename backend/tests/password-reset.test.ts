import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { verify } from "@node-rs/argon2";

/**
 * Password reset by email link.
 *
 * The claims that must hold, each one careless edit from being false:
 *   1. A link works exactly once, and only within its window.
 *   2. Using it actually changes the stored hash — and the new password verifies.
 *   3. Requesting for an address that has no account is not distinguishable from
 *      one that does (the route stays generic; the service says which internally).
 *   4. A stale link left in an inbox is dead after a successful reset.
 */

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { issueToken } = await import("../src/utils/tokens.js");
const {
  requestPasswordReset,
  checkResetToken,
  consumeResetToken,
} = await import("../src/services/password-reset.js");

let churchId: string;

async function seedUser(email: string) {
  const [u] = await db.insert(schema.users).values({ email, passwordHash: "$argon2-old-hash" }).returning();
  await db.insert(schema.profiles).values({ id: u.id, displayName: "Person", churchId, role: "member" });
  return u.id;
}

/** Mints a token row the way the service does, returning the plaintext token. */
async function mintToken(userId: string, email: string, opts: { expiresInMs?: number } = {}) {
  const { token, selector, verifierHash } = issueToken();
  await db.insert(schema.passwordResetTokens).values({
    userId, selector, verifierHash, email: email.toLowerCase(),
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 3600_000)),
  });
  return token;
}

beforeAll(async () => { await applyMigrations(); });

beforeEach(async () => {
  await truncateAll();
  const [c] = await db.insert(schema.churches).values({ nameAm: "ቤተ", nameEn: "St Gabriel" }).returning();
  churchId = c.id;
});

describe("requestPasswordReset", () => {
  it("reports no_account for an unknown address and mints nothing", async () => {
    const outcome = await requestPasswordReset("stranger@nowhere.co");
    expect(outcome).toBe("no_account");
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.passwordResetTokens);
    expect(count).toBe(0);
  });

  it("mints a token for a real account (case-insensitively)", async () => {
    const userId = await seedUser("real@birhan.et");
    // Email is disabled in the test env, so the outcome is send_failed, but the
    // token is minted either way — that is what the reset flow depends on.
    const outcome = await requestPasswordReset("REAL@birhan.et");
    expect(["sent", "send_failed"]).toContain(outcome);
    const row = await db.query.passwordResetTokens.findFirst({
      where: eq(schema.passwordResetTokens.userId, userId),
    });
    expect(row).toBeTruthy();
  });

  it("rate-limits after the hourly cap", async () => {
    const userId = await seedUser("busy@birhan.et");
    for (let i = 0; i < 3; i++) await mintToken(userId, "busy@birhan.et");
    const outcome = await requestPasswordReset("busy@birhan.et");
    expect(outcome).toBe("rate_limited");
  });
});

describe("checkResetToken", () => {
  it("distinguishes valid / expired / invalid", async () => {
    const userId = await seedUser("a@birhan.et");
    const good = await mintToken(userId, "a@birhan.et");
    const stale = await mintToken(userId, "a@birhan.et", { expiresInMs: -1000 });
    expect(await checkResetToken(good)).toBe("valid");
    expect(await checkResetToken(stale)).toBe("expired");
    expect(await checkResetToken("garbage")).toBe("invalid");
    expect(await checkResetToken("deadbeefdeadbeef.notarealverifier")).toBe("invalid");
  });
});

describe("consumeResetToken", () => {
  it("sets a new password that verifies, and burns the token", async () => {
    const userId = await seedUser("reset@birhan.et");
    const token = await mintToken(userId, "reset@birhan.et");

    const res = await consumeResetToken(token, "brandnewpass9");
    expect(res.status).toBe("reset");

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(await verify(user!.passwordHash!, "brandnewpass9")).toBe(true);

    // Single-use.
    expect(await checkResetToken(token)).toBe("used");
    expect((await consumeResetToken(token, "another12345")).status).toBe("used");
  });

  it("retires other outstanding links for the account on success", async () => {
    const userId = await seedUser("multi@birhan.et");
    const t1 = await mintToken(userId, "multi@birhan.et");
    const t2 = await mintToken(userId, "multi@birhan.et");

    expect((await consumeResetToken(t1, "freshpass1234")).status).toBe("reset");
    // The still-in-the-inbox second link is now dead.
    expect(await checkResetToken(t2)).toBe("used");
  });

  it("refuses an expired token", async () => {
    const userId = await seedUser("late@birhan.et");
    const token = await mintToken(userId, "late@birhan.et", { expiresInMs: -1000 });
    expect((await consumeResetToken(token, "whatever12345")).status).toBe("expired");
  });

  it("refuses a token whose account email changed since it was mailed", async () => {
    const userId = await seedUser("old@birhan.et");
    const token = await mintToken(userId, "old@birhan.et");
    await db.update(schema.users).set({ email: "new@birhan.et" }).where(eq(schema.users.id, userId));
    expect((await consumeResetToken(token, "whatever12345")).status).toBe("invalid");
  });
});

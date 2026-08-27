import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

/**
 * Deleting your own account.
 *
 * Three claims are worth guarding, and each is one careless edit from being
 * false:
 *
 *   1. The account is really gone — the credentials stop working AND the token
 *      already in the phone's keychain stops working. The JWT is stateless, so
 *      the second half does not follow from the first.
 *   2. The threads still make sense. A pastor deleting their account must not
 *      silently take a year of announcements with them.
 *   3. A Telegram failure never blocks the deletion. The person asked to be
 *      deleted; Telegram is a third party having a bad day.
 *
 * The Bot API is exercised through a mocked `fetch` rather than a mocked
 * module, so removeChatMember's actual behaviour — ban, then immediately unban
 * with only_if_banned — is what is under test.
 */

const WEBHOOK_SECRET = "deletion-webhook-secret";
process.env.TELEGRAM_BOT_TOKEN = "123456:deletion-test-token";
process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.TELEGRAM_BOT_USERNAME = "BirhanTestBot";

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { default: app } = await import("../src/index.js");
const { registerAccount, startRegistration, confirmTelegram, completeSignup } =
  await import("./support/register.js");
const { _resetRevocationsForTest } = await import("../src/services/revocation.js");
const { DELETED_AUTHOR_SENTINEL } = await import("../src/services/account-deletion.js");

type Json = Record<string, any>;

let ipCounter = 0;
const freshIp = () => `10.3.0.${++ipCounter % 250}:${ipCounter}`;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? freshIp(),
    accept: "application/json",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const res = await app.request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: Json | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

// --- Bot API stand-in -------------------------------------------------------

type BotCall = { method: string; payload: Json };
let botCalls: BotCall[] = [];
let botBehaviour: (method: string) => { ok: boolean; error_code?: number; description?: string };

const realFetch = globalThis.fetch;

beforeAll(async () => {
  await applyMigrations();
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (!u.includes("api.telegram.org")) return realFetch(url, init);
    const method = u.split("/").pop()!;
    const payload = init?.body ? JSON.parse(init.body) : {};
    botCalls.push({ method, payload });
    const out = botBehaviour(method);
    return {
      ok: true,
      status: 200,
      json: async () => (out.ok ? { ok: true, result: true } : out),
      text: async () => JSON.stringify(out),
    } as any;
  }) as any;
});

let churchId: string;
let seq = 0;

/** A registered, Telegram-verified account. Returns its token and ids. */
async function makeAccount(overrides: Json = {}) {
  seq += 1;
  const email = overrides.email ?? `person${seq}@example.com`;
  const password = overrides.password ?? "a-good-long-password";
  const res = await registerAccount(call, {
    email,
    password,
    displayName: overrides.displayName ?? `Person ${seq}`,
    churchId,
    language: "am",
    ...overrides,
  });
  return {
    token: res.json!.token as string,
    userId: res.json!.user.id as string,
    telegramUserId: res.telegramUserId!,
    email,
    password,
  };
}

async function linkChurchGroup(chatId = "-1001234567890", title = "Debre Birhan Youth") {
  await db.update(schema.churches)
    .set({ telegramChatId: chatId, telegramVerifiedAt: new Date() })
    .where(eq(schema.churches.id, churchId));
  await db.insert(schema.telegramLinkCodes).values({
    churchId,
    createdBy: (await db.select().from(schema.profiles).limit(1))[0].id,
    code: `L${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: new Date(),
    chatId,
    chatTitle: title,
  });
}

beforeEach(async () => {
  await truncateAll();
  _resetRevocationsForTest();
  botCalls = [];
  botBehaviour = () => ({ ok: true });
  const [church] = await db
    .insert(schema.churches)
    .values({ nameAm: "ደብረ ብርሃን", nameEn: "Debre Birhan" })
    .returning();
  churchId = church.id;
});

describe("deletion needs more than an unlocked phone", () => {
  it("refuses without the password", async () => {
    const a = await makeAccount();
    const res = await call("/api/v1/me", { method: "DELETE", token: a.token, body: {} });
    expect(res.status).toBe(400);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, a.userId),
    });
    expect(profile!.deletedAt).toBeNull();
  });

  it("refuses on the wrong password, leaving the account intact", async () => {
    const a = await makeAccount();
    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: "not-the-password" },
    });
    expect(res.status).toBe(401);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, a.userId),
    });
    expect(profile!.deletedAt).toBeNull();
    expect(profile!.displayName).not.toBe(DELETED_AUTHOR_SENTINEL);
  });

  it("refuses without a session at all", async () => {
    const a = await makeAccount();
    const res = await call("/api/v1/me", {
      method: "DELETE",
      body: { password: a.password },
    });
    expect(res.status).toBe(401);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, a.userId),
    });
    expect(profile!.deletedAt).toBeNull();
  });
});

describe("a deleted account is really gone", () => {
  it("tombstones the profile and clears every identifying field", async () => {
    const a = await makeAccount({ phone: "0911234567" });
    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: a.password },
    });
    expect(res.status).toBe(200);
    expect(res.json!.deleted).toBe(true);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, a.userId),
    });
    expect(profile!.deletedAt).not.toBeNull();
    expect(profile!.phone).toBeNull();
    expect(profile!.telegramUserId).toBeNull();
    expect(profile!.telegramUsername).toBeNull();
    expect(profile!.churchRole).toBeNull();
    expect(profile!.displayName).toBe(DELETED_AUTHOR_SENTINEL);

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId) });
    expect(user!.email).toBeNull();
    expect(user!.phone).toBeNull();
    expect(user!.passwordHash).toBeNull();
  });

  it("cannot log in afterwards", async () => {
    const a = await makeAccount();
    await call("/api/v1/me", { method: "DELETE", token: a.token, body: { password: a.password } });

    const res = await call("/api/v1/auth/login", {
      method: "POST",
      body: { identifier: a.email, password: a.password },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("revokes the token already in the app's keychain", async () => {
    const a = await makeAccount();

    // Same token, working, before.
    expect((await call("/api/v1/me", { token: a.token })).status).toBe(200);

    await call("/api/v1/me", { method: "DELETE", token: a.token, body: { password: a.password } });

    // The JWT is still signed and still in date. It must stop working anyway —
    // this is the whole reason services/revocation.ts exists.
    expect((await call("/api/v1/me", { token: a.token })).status).toBe(401);
    expect((await call("/api/v1/announcements", { token: a.token })).status).toBe(401);
  });

  it("frees the email and the Telegram identity for a fresh account", async () => {
    const a = await makeAccount({ email: "returning@example.com" });
    await call("/api/v1/me", { method: "DELETE", token: a.token, body: { password: a.password } });

    // Same address, same Telegram account, brand new registration.
    const started = await startRegistration(call, {
      email: "returning@example.com",
      password: "a-good-long-password",
      displayName: "Returning",
      churchId,
      language: "am",
    });
    expect(started.status).toBe(200);

    await confirmTelegram(started.json!.pendingId, { telegramUserId: a.telegramUserId });
    const done = await completeSignup(call, started.json!.pendingId);
    expect(done.status).toBe(200);
  });

  it("disappears from the church roster and the headcount", async () => {
    const pastorProfileHolder = await makeAccount();
    const leaving = await makeAccount({ displayName: "Leaving Member" });

    await db.update(schema.profiles)
      .set({ role: "pastor" })
      .where(eq(schema.profiles.id, pastorProfileHolder.userId));
    const pastor = await call("/api/v1/auth/login", {
      method: "POST",
      body: { identifier: pastorProfileHolder.email, password: pastorProfileHolder.password },
    });

    const before = await call("/api/v1/members", { token: pastor.json!.token });
    expect(before.json!.total).toBe(2);

    await call("/api/v1/me", {
      method: "DELETE",
      token: leaving.token,
      body: { password: leaving.password },
    });

    const after = await call("/api/v1/members", { token: pastor.json!.token });
    expect(after.json!.total).toBe(1);
    expect(JSON.stringify(after.json)).not.toContain("Leaving Member");
  });
});

describe("the threads still make sense", () => {
  it("keeps announcements and replies, with the author anonymised", async () => {
    const author = await makeAccount({ displayName: "Pastor Dawit" });
    await db.update(schema.profiles)
      .set({ role: "pastor" })
      .where(eq(schema.profiles.id, author.userId));

    const [announcement] = await db.insert(schema.announcements).values({
      churchId,
      authorId: author.userId,
      titleAm: "ማስታወቂያ",
      titleEn: "Sunday service",
      body: "Please come early",
    }).returning();

    await db.insert(schema.replies).values({
      announcementId: announcement.id,
      authorId: author.userId,
      authorName: "Pastor Dawit",
      text: "Bring your family",
    });

    await call("/api/v1/me", {
      method: "DELETE",
      token: author.token,
      body: { password: author.password },
    });

    // The announcement survives — deleting an account must not quietly destroy
    // a church's notice board.
    const [{ count: announcementCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.announcements);
    expect(announcementCount).toBe(1);

    // The reply survives, without the name on it.
    const reply = await db.query.replies.findFirst();
    expect(reply).toBeDefined();
    expect(reply!.text).toBe("Bring your family");
    expect(reply!.authorName).toBe(DELETED_AUTHOR_SENTINEL);
    expect(reply!.authorName).not.toContain("Dawit");
  });
});

describe("removal from the church's Telegram group", () => {
  it("bans then immediately unbans, so they can rejoin later", async () => {
    const a = await makeAccount();
    await linkChurchGroup("-1001234567890", "Debre Birhan Youth");

    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: a.password },
    });
    expect(res.status).toBe(200);

    expect(botCalls.map((b) => b.method)).toEqual(["banChatMember", "unbanChatMember"]);
    expect(botCalls[0].payload).toMatchObject({
      chat_id: "-1001234567890",
      user_id: a.telegramUserId,
    });
    // Without only_if_banned the unban doubles as an invitation.
    expect(botCalls[1].payload).toMatchObject({
      chat_id: "-1001234567890",
      user_id: a.telegramUserId,
      only_if_banned: true,
    });

    expect(res.json!.telegram).toEqual([
      { chatTitle: "Debre Birhan Youth", removed: true },
    ]);
  });

  it("still deletes the account when Telegram refuses, and says which group", async () => {
    const a = await makeAccount();
    await linkChurchGroup("-1009999", "Unmanaged Group");
    // What Telegram answers when the bot is not an administrator there.
    botBehaviour = () => ({ ok: false, error_code: 400, description: "CHAT_ADMIN_REQUIRED" });

    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: a.password },
    });

    expect(res.status).toBe(200);
    expect(res.json!.deleted).toBe(true);
    expect(res.json!.telegram).toEqual([
      { chatTitle: "Unmanaged Group", removed: false, reason: "not_admin" },
    ]);

    // The deletion the person asked for happened regardless.
    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, a.userId),
    });
    expect(profile!.deletedAt).not.toBeNull();
    expect((await call("/api/v1/me", { token: a.token })).status).toBe(401);
  });

  it("does nothing and reports nothing when the church has no linked group", async () => {
    const a = await makeAccount();

    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: a.password },
    });

    expect(res.status).toBe(200);
    expect(res.json!.telegram).toEqual([]);
    expect(botCalls).toHaveLength(0);
  });

  it("never reports anybody else's Telegram identity", async () => {
    const other = await makeAccount({ displayName: "Someone Else" });
    const a = await makeAccount();
    await linkChurchGroup();

    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: a.token,
      body: { password: a.password },
    });

    const body = JSON.stringify(res.json);
    expect(body).not.toContain(other.telegramUserId);
    expect(body).not.toContain("Someone Else");
    // Not even the deleting user's own id needs to be echoed back to them.
    expect(body).not.toContain(a.telegramUserId);
  });
});

describe("only your own account", () => {
  it("ignores a userId in the body — there is no parameter to pass", async () => {
    const victim = await makeAccount({ displayName: "Victim" });
    const attacker = await makeAccount();

    const res = await call("/api/v1/me", {
      method: "DELETE",
      token: attacker.token,
      body: { password: attacker.password, userId: victim.userId, id: victim.userId },
    });
    expect(res.status).toBe(200);

    // The attacker deleted themselves and nobody else.
    const victimProfile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, victim.userId),
    });
    expect(victimProfile!.deletedAt).toBeNull();
    expect(victimProfile!.displayName).toBe("Victim");

    const attackerProfile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, attacker.userId),
    });
    expect(attackerProfile!.deletedAt).not.toBeNull();
  });

  it("cannot be run twice on the same account", async () => {
    const a = await makeAccount();
    expect((await call("/api/v1/me", {
      method: "DELETE", token: a.token, body: { password: a.password },
    })).status).toBe(200);

    // The token is revoked, so the second attempt cannot even authenticate.
    expect((await call("/api/v1/me", {
      method: "DELETE", token: a.token, body: { password: a.password },
    })).status).toBe(401);
  });
});

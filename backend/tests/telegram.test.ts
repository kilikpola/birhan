import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * The Telegram link handshake and announcement mirroring.
 *
 * The Bot API itself is mocked — these tests are about what we do with what
 * Telegram tells us, not about Telegram. What they are really guarding is the
 * set of things that make a six-character code posted into a public room an
 * acceptable credential: it expires, it is single-use, and only a group
 * administrator can redeem it. Each of those is one bad `if` away from letting
 * a stranger attach a church's announcements to a group they control.
 */

const BOT_TOKEN = "123456:test-bot-token";
const WEBHOOK_SECRET = "telegram-webhook-test-secret";

process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.TELEGRAM_CODE_TTL_MINUTES = "10";
process.env.TELEGRAM_CODES_PER_HOUR = "6";

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

// The transport is mocked, not the service above it: the admin check, the
// escaping and the link-clearing on 403 are all ours and stay under test.
const sendTelegramMessage = vi.fn();
const isChatAdministrator = vi.fn();

vi.mock("../src/services/telegram-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/telegram-api.js")>();
  return {
    ...actual,
    sendTelegramMessage: (...args: unknown[]) => sendTelegramMessage(...args),
    isChatAdministrator: (...args: unknown[]) => isChatAdministrator(...args),
  };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { default: app } = await import("../src/index.js");
const { SignJWT } = await import("jose");

type Json = Record<string, any>;

let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter % 250}:${ipCounter}`;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; secret?: string } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": freshIp(),
    accept: "application/json",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.secret !== undefined) headers["x-telegram-bot-api-secret-token"] = opts.secret;

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

async function tokenFor(userId: string, churchId: string, role: string) {
  return new SignJWT({
    user_id: userId, church_id: churchId, role, branch_id: null,
    email: "p@birhan.test", email_verified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

async function seedChurchWithPastor(nameEn = "Debre Birhan") {
  const [church] = await db.insert(schema.churches)
    .values({ nameAm: "ደብረ ብርሃን", nameEn }).returning();
  const [user] = await db.insert(schema.users)
    .values({ email: `${nameEn.replace(/\W/g, "")}@birhan.test`, passwordHash: "x" }).returning();
  await db.insert(schema.profiles).values({
    id: user.id, displayName: "እረኛ", churchId: church.id, role: "pastor", language: "am",
  });
  return { churchId: church.id, userId: user.id, token: await tokenFor(user.id, church.id, "pastor") };
}

/** The shape Telegram actually posts for a message in a group. */
function update(text: string, over: Json = {}) {
  return {
    message: {
      text,
      chat: { id: -1001234567890, type: "supergroup", title: "ደብረ ብርሃን ቡድን", ...(over.chat ?? {}) },
      from: { id: 42, is_bot: false, ...(over.from ?? {}) },
    },
  };
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await truncateAll();
  sendTelegramMessage.mockReset().mockResolvedValue({ ok: true, result: { message_id: 1 } });
  isChatAdministrator.mockReset().mockResolvedValue(true);
});

// ---------------------------------------------------------------------------

describe("issuing a link code", () => {
  it("gives a pastor a six-character code with an expiry", async () => {
    const { token } = await seedChurchWithPastor();

    const res = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    expect(res.status).toBe(201);
    expect(res.json!.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(new Date(res.json!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("never uses a character that can be misread off a phone screen", async () => {
    const { token } = await seedChurchWithPastor();
    for (let i = 0; i < 6; i += 1) {
      const res = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
      expect(res.json!.code).not.toMatch(/[OI01]/);
    }
  });

  it("refuses an ordinary member", async () => {
    const [church] = await db.insert(schema.churches)
      .values({ nameAm: "ደ", nameEn: "D" }).returning();
    const [user] = await db.insert(schema.users)
      .values({ email: "m@birhan.test", passwordHash: "x" }).returning();
    await db.insert(schema.profiles).values({
      id: user.id, displayName: "አባል", churchId: church.id, role: "member", language: "am",
    });
    const token = await tokenFor(user.id, church.id, "member");

    const res = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    expect(res.status).toBe(403);
  });

  it("retires the previous code, so an abandoned one stops working", async () => {
    const { token } = await seedChurchWithPastor();
    const first = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
    await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(first.json!.code),
    });

    const [church] = await db.select().from(schema.churches);
    expect(church.telegramChatId).toBeNull();
  });

  it("stops a church minting codes without limit", async () => {
    const { token } = await seedChurchWithPastor();
    for (let i = 0; i < 6; i += 1) {
      await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
    }
    const over = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
    expect(over.status).toBe(429);
  });
});

describe("the webhook's front door", () => {
  it("ignores an update with no secret header", async () => {
    const { token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    const res = await call("/api/v1/telegram-webhook", { method: "POST", body: update(json!.code) });

    // 200 so a prober learns nothing and Telegram never retry-loops...
    expect(res.status).toBe(200);
    // ...but nothing happened.
    const [church] = await db.select().from(schema.churches);
    expect(church.telegramChatId).toBeNull();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("ignores an update with the wrong secret", async () => {
    const { token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: "not-the-secret", body: update(json!.code),
    });

    const [church] = await db.select().from(schema.churches);
    expect(church.telegramChatId).toBeNull();
  });
});

describe("redeeming a code", () => {
  it("links the group when an administrator posts the code", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBe("-1001234567890");
    expect(church!.telegramVerifiedAt).not.toBeNull();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("accepts the /link command form as well as a bare code", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(`/link@BirhanBot ${json!.code}`),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBe("-1001234567890");
  });

  it("refuses someone who is not an administrator of the group", async () => {
    // The code was just posted where everyone can read it. Holding it is not
    // supposed to be enough.
    isChatAdministrator.mockResolvedValue(false);
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBeNull();
  });

  it("refuses a private chat", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET,
      body: update(json!.code, { chat: { id: 42, type: "private" } }),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBeNull();
  });

  it("refuses an expired code", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await db.update(schema.telegramLinkCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.telegramLinkCodes.code, json!.code));

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBeNull();
  });

  it("will not redeem the same code twice", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
    const body = update(json!.code);

    await call("/api/v1/telegram-webhook", { method: "POST", secret: WEBHOOK_SECRET, body });
    await call("/api/v1/telegram/link", { method: "DELETE", token });
    // The mail is out of the bottle: someone scrolls up and pastes it again.
    await call("/api/v1/telegram-webhook", { method: "POST", secret: WEBHOOK_SECRET, body });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBeNull();
  });

  it("will not let a second church claim a group that is already linked", async () => {
    const a = await seedChurchWithPastor("Alpha");
    const codeA = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token: a.token });
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(codeA.json!.code),
    });

    const b = await seedChurchWithPastor("Beta");
    const codeB = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token: b.token });
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(codeB.json!.code),
    });

    const beta = await db.query.churches.findFirst({ where: eq(schema.churches.id, b.churchId) });
    expect(beta!.telegramChatId).toBeNull();
    const alpha = await db.query.churches.findFirst({ where: eq(schema.churches.id, a.churchId) });
    expect(alpha!.telegramChatId).toBe("-1001234567890");
  });
});

describe("things that are not link codes", () => {
  it("stays silent on a bare six-letter word", async () => {
    // With group privacy disabled the bot sees every message. "SUNDAY" is a
    // word, not a code, and answering it in the church's chat is noise.
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update("SUNDAY"),
    });

    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("does answer an explicit /link that fails, because that was a real attempt", async () => {
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update("/link SUNDAY"),
    });

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    const [, html] = sendTelegramMessage.mock.calls[0];
    expect(html).toMatch(/not recognised/i);
  });

  it("still links from a bare code when one really is posted", async () => {
    const { churchId, token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });

    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });

    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBe("-1001234567890");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});

describe("status and unlinking", () => {
  it("reports the link, then reports it gone", async () => {
    const { token } = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", { method: "POST", body: {}, token });
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });

    const linked = await call("/api/v1/telegram/status", { token });
    expect(linked.json).toMatchObject({ isLinked: true, chatId: "-1001234567890" });

    await call("/api/v1/telegram/link", { method: "DELETE", token });

    const after = await call("/api/v1/telegram/status", { token });
    expect(after.json).toMatchObject({ isLinked: false, chatId: null });
  });
});

describe("mirroring an announcement", () => {
  async function linkedChurch() {
    const seeded = await seedChurchWithPastor();
    const { json } = await call("/api/v1/telegram/link-code", {
      method: "POST", body: {}, token: seeded.token,
    });
    await call("/api/v1/telegram-webhook", {
      method: "POST", secret: WEBHOOK_SECRET, body: update(json!.code),
    });
    sendTelegramMessage.mockClear();
    return seeded;
  }

  async function seedAnnouncement(churchId: string, authorId: string, body = "እሑድ ጠዋት።") {
    const [a] = await db.insert(schema.announcements).values({
      churchId, authorId, titleAm: "የሰንበት ጥሪ", titleEn: "Sunday", body,
    }).returning();
    return a;
  }

  it("sends it and records that it went", async () => {
    const { churchId, userId, token } = await linkedChurch();
    const a = await seedAnnouncement(churchId, userId);

    const res = await call(`/api/v1/telegram/announcements/${a.id}`, { method: "POST", body: {}, token });

    expect(res.json).toEqual({ success: true });
    const [, html] = sendTelegramMessage.mock.calls[0];
    expect(html).toContain("<b>የሰንበት ጥሪ</b>");

    const stored = await db.query.announcements.findFirst({
      where: eq(schema.announcements.id, a.id),
    });
    expect(stored!.postedToTelegram).toBe(true);
  });

  it("escapes a body that would otherwise break Telegram's HTML parser", async () => {
    const { churchId, userId, token } = await linkedChurch();
    const a = await seedAnnouncement(churchId, userId, "Bring <3 & a friend");

    await call(`/api/v1/telegram/announcements/${a.id}`, { method: "POST", body: {}, token });

    const [, html] = sendTelegramMessage.mock.calls[0];
    expect(html).toContain("&lt;3 &amp; a friend");
  });

  it("reports not_linked rather than sending into the void", async () => {
    const { churchId, userId, token } = await seedChurchWithPastor();
    const a = await seedAnnouncement(churchId, userId);

    const res = await call(`/api/v1/telegram/announcements/${a.id}`, { method: "POST", body: {}, token });

    expect(res.json).toMatchObject({ success: false, error: "not_linked" });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("clears the link when Telegram says the bot was removed", async () => {
    const { churchId, userId, token } = await linkedChurch();
    const a = await seedAnnouncement(churchId, userId);
    sendTelegramMessage.mockResolvedValue({ ok: false, errorCode: 403, error: "bot was kicked" });

    const res = await call(`/api/v1/telegram/announcements/${a.id}`, { method: "POST", body: {}, token });

    expect(res.json).toMatchObject({ success: false, error: "not_linked" });
    // Left in place, every future post would fail the same way with no clue why.
    const church = await db.query.churches.findFirst({ where: eq(schema.churches.id, churchId) });
    expect(church!.telegramChatId).toBeNull();
  });

  it("will not mirror another congregation's announcement", async () => {
    const mine = await linkedChurch();
    const theirs = await seedChurchWithPastor("Other");
    const a = await seedAnnouncement(theirs.churchId, theirs.userId);

    const res = await call(`/api/v1/telegram/announcements/${a.id}`, {
      method: "POST", body: {}, token: mine.token,
    });

    expect(res.status).toBe(404);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});

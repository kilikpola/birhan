import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

/**
 * Registration is not allowed to produce an account until Telegram has vouched
 * for the person.
 *
 * The claim under test is narrow and worth stating plainly: *the client cannot
 * put itself into the verified state*. Everything else here — expiry,
 * single-use, one-identity-one-account — exists to stop that claim from being
 * true only on the happy path. Each is one missing `if` away from letting
 * someone mint accounts from a Telegram identity they do not control, or from
 * no Telegram identity at all.
 *
 * The Bot API transport is mocked; the webhook, the token handling and the
 * signup transaction are the shipped code.
 */

const BOT_TOKEN = "123456:registration-test-token";
const WEBHOOK_SECRET = "registration-webhook-secret";
const BOT_USERNAME = "BirhanTestBot";

process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.TELEGRAM_BOT_USERNAME = BOT_USERNAME;
process.env.PENDING_REGISTRATION_TTL_MINUTES = "10";

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

// Only the transport. The webhook's own parsing and the service's token
// checking are what these tests are for.
const sendTelegramMessage = vi.fn();
vi.mock("../src/services/telegram-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/telegram-api.js")>();
  return {
    ...actual,
    sendTelegramMessage: (...args: unknown[]) => sendTelegramMessage(...args),
  };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { default: app } = await import("../src/index.js");

type Json = Record<string, any>;

let ipCounter = 0;
const freshIp = () => `10.2.0.${++ipCounter % 250}:${ipCounter}`;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; secret?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? freshIp(),
    accept: "application/json",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
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

let churchId: string;
let seq = 0;

function details(overrides: Json = {}): Json {
  seq += 1;
  return {
    email: `person${seq}@example.com`,
    password: "a-good-long-password",
    displayName: `Person ${seq}`,
    churchId,
    language: "am",
    ...overrides,
  };
}

function start(overrides: Json = {}) {
  return call("/api/v1/auth/telegram/start", { method: "POST", body: details(overrides) });
}

/** The `start=` payload out of the deep link — exactly what Telegram would send. */
function payloadFrom(deepLink: string): string {
  return new URL(deepLink).searchParams.get("start")!;
}

/** One `/start <payload>` message, as Telegram would deliver it. */
function startMessage(
  payload: string | null,
  opts: { fromId?: number; username?: string; chatType?: string; chatId?: number } = {},
) {
  return {
    message: {
      text: payload ? `/start ${payload}` : "/start",
      chat: { id: opts.chatId ?? 5001, type: opts.chatType ?? "private" },
      from: { id: opts.fromId ?? 9001, is_bot: false, username: opts.username ?? "telegram_user" },
    },
  };
}

function deliver(update: Json, secret = WEBHOOK_SECRET) {
  return call("/api/v1/telegram-webhook", { method: "POST", body: update, secret });
}

function complete(pendingRegistrationId: string) {
  return call("/api/v1/auth/signup", {
    method: "POST",
    body: { pendingRegistrationId },
  });
}

async function countUsers(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users);
  return count;
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await truncateAll();
  sendTelegramMessage.mockReset();
  sendTelegramMessage.mockResolvedValue({ ok: true });
  const [church] = await db
    .insert(schema.churches)
    .values({ nameAm: "ደብረ ብርሃን", nameEn: "Debre Birhan" })
    .returning();
  churchId = church.id;
});

describe("nothing that can authenticate exists before Telegram confirms", () => {
  it("creates no user or profile when the details are submitted", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    expect(res.json!.pendingId).toBeTruthy();

    expect(await countUsers()).toBe(0);
    expect(await db.select().from(schema.profiles)).toHaveLength(0);
  });

  it("refuses signup while the Telegram half is missing, and creates nothing", async () => {
    const started = await start();
    const res = await complete(started.json!.pendingId);

    expect(res.status).toBe(403);
    expect(res.json!.error.code).toBe("FORBIDDEN");
    expect(res.json!.error.message).toBe("TELEGRAM_NOT_VERIFIED");
    expect(await countUsers()).toBe(0);
  });

  it("refuses a pendingRegistrationId that was never issued", async () => {
    const res = await complete("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await countUsers()).toBe(0);
  });

  it("refuses signup with no pendingRegistrationId at all", async () => {
    const res = await call("/api/v1/auth/signup", { method: "POST", body: details() });
    expect(res.status).toBe(400);
    expect(await countUsers()).toBe(0);
  });
});

describe("the client cannot put itself into the verified state", () => {
  it("ignores a telegram id asserted in the start body", async () => {
    const res = await start({
      telegramUserId: "7777",
      telegramConnected: true,
      telegram_user_id: "7777",
      telegramConfirmedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(200);

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, res.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();

    // And the status endpoint agrees — the assertion changed nothing.
    const status = await call(
      `/api/v1/auth/telegram/status?pendingRegistrationId=${res.json!.pendingId}`,
    );
    expect(status.json!.status).toBe("waiting");

    expect((await complete(res.json!.pendingId)).status).toBe(403);
  });

  it("ignores a telegram id asserted in the signup body", async () => {
    const started = await start();
    const res = await call("/api/v1/auth/signup", {
      method: "POST",
      body: {
        pendingRegistrationId: started.json!.pendingId,
        telegramUserId: "7777",
        telegramConnected: true,
      },
    });
    expect(res.status).toBe(403);
    expect(await countUsers()).toBe(0);
  });
});

describe("the deep link", () => {
  it("points at the configured bot and carries only a token", async () => {
    const res = await start({
      email: "secret@example.com",
      displayName: "Very Secret Person",
      password: "correct-horse-battery-staple",
    });
    const link: string = res.json!.deepLink;

    expect(link.startsWith(`https://t.me/${BOT_USERNAME}?start=`)).toBe(true);

    // No personal data and no credential rides along in a URL that ends up in
    // a chat log.
    expect(link).not.toContain("secret@example.com");
    expect(link).not.toContain("Very Secret");
    expect(link).not.toContain("correct-horse");
    expect(link).not.toContain(churchId);

    // Telegram's own limit on a start payload.
    const payload = payloadFrom(link);
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is stored hashed — the token itself is not in the database", async () => {
    const res = await start();
    const payload = payloadFrom(res.json!.deepLink);

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, res.json!.pendingId),
    });

    // The selector half is the lookup key and is meant to be there; the secret
    // half must not be, in any column.
    const verifier = payload.slice(row!.tokenSelector.length);
    expect(verifier.length).toBeGreaterThan(0);
    expect(JSON.stringify(row)).not.toContain(verifier);
    expect(row!.tokenVerifierHash).not.toContain(verifier);
  });

  it("never stores the password in the clear", async () => {
    const res = await start({ password: "correct-horse-battery-staple" });
    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, res.json!.pendingId),
    });
    expect(row!.passwordHash).not.toContain("correct-horse-battery-staple");
    expect(row!.passwordHash.startsWith("$argon2")).toBe(true);
  });
});

describe("the webhook is what confirms", () => {
  it("confirms a private /start and lets signup through", async () => {
    const started = await start();
    const payload = payloadFrom(started.json!.deepLink);

    const hook = await deliver(startMessage(payload, { fromId: 4242, username: "abebe" }));
    expect(hook.status).toBe(200);

    const status = await call(
      `/api/v1/auth/telegram/status?pendingRegistrationId=${started.json!.pendingId}`,
    );
    expect(status.json!.status).toBe("connected");
    expect(status.json!.telegramUsername).toBe("abebe");

    const res = await complete(started.json!.pendingId);
    expect(res.status).toBe(200);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, res.json!.user.id),
    });
    expect(profile!.telegramUserId).toBe("4242");
    expect(profile!.telegramUsername).toBe("abebe");
    expect(profile!.role).toBe("member");
  });

  it("does not confirm from a group chat", async () => {
    const started = await start();
    const payload = payloadFrom(started.json!.deepLink);

    await deliver(startMessage(payload, { chatType: "supergroup" }));

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, started.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();
    expect((await complete(started.json!.pendingId)).status).toBe(403);
  });

  it("does not confirm on a forged or malformed token", async () => {
    const started = await start();
    const real = payloadFrom(started.json!.deepLink);

    // Right selector, wrong secret half — the case a stolen database would
    // enable if the verifier were stored in the clear.
    const forged = real.slice(0, 16) + "x".repeat(real.length - 16);
    await deliver(startMessage(forged));
    await deliver(startMessage("not-a-real-token"));
    await deliver(startMessage("../../etc/passwd"));

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, started.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();
  });

  it("ignores an update without the secret header", async () => {
    const started = await start();
    const payload = payloadFrom(started.json!.deepLink);

    await deliver(startMessage(payload), "wrong-secret");

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, started.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();
  });

  it("greets a bare /start without touching any registration", async () => {
    const res = await deliver(startMessage(null));
    expect(res.status).toBe(200);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});

describe("one registration, one account", () => {
  it("refuses a second signup on the same registration", async () => {
    const started = await start();
    await deliver(startMessage(payloadFrom(started.json!.deepLink)));

    expect((await complete(started.json!.pendingId)).status).toBe(200);

    const again = await complete(started.json!.pendingId);
    expect(again.status).toBe(409);
    expect(await countUsers()).toBe(1);
  });

  it("refuses a Telegram account that already belongs to someone", async () => {
    const first = await start();
    await deliver(startMessage(payloadFrom(first.json!.deepLink), { fromId: 111 }));
    expect((await complete(first.json!.pendingId)).status).toBe(200);

    // Same Telegram account, brand new registration.
    const second = await start();
    await deliver(startMessage(payloadFrom(second.json!.deepLink), { fromId: 111 }));

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, second.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();
    expect((await complete(second.json!.pendingId)).status).toBe(403);
    expect(await countUsers()).toBe(1);

    // The app is told, so it can explain rather than spin — and it is told
    // nothing whatsoever about whose account it is.
    const status = await call(
      `/api/v1/auth/telegram/status?pendingRegistrationId=${second.json!.pendingId}`,
    );
    expect(status.json!.status).toBe("already_linked");
    expect(JSON.stringify(status.json)).not.toContain("111");
  });
});

describe("abandoned registrations expire rather than becoming accounts", () => {
  it("refuses signup after the window closes, and says so", async () => {
    const started = await start();
    await deliver(startMessage(payloadFrom(started.json!.deepLink)));

    await db
      .update(schema.pendingRegistrations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingRegistrations.id, started.json!.pendingId));

    const res = await complete(started.json!.pendingId);
    expect(res.status).toBe(503);
    expect(res.json!.error.code).toBe("REGISTRATION_EXPIRED");
    expect(await countUsers()).toBe(0);
  });

  it("reports expiry to the app rather than silently failing", async () => {
    const started = await start();
    await db
      .update(schema.pendingRegistrations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingRegistrations.id, started.json!.pendingId));

    const status = await call(
      `/api/v1/auth/telegram/status?pendingRegistrationId=${started.json!.pendingId}`,
    );
    expect(status.json!.status).toBe("expired");
  });

  it("will not confirm an expired registration", async () => {
    const started = await start();
    await db
      .update(schema.pendingRegistrations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingRegistrations.id, started.json!.pendingId));

    await deliver(startMessage(payloadFrom(started.json!.deepLink)));

    const row = await db.query.pendingRegistrations.findFirst({
      where: eq(schema.pendingRegistrations.id, started.json!.pendingId),
    });
    expect(row!.telegramUserId).toBeNull();
  });
});

describe("the details are still checked where they always were", () => {
  it("refuses an address that is already in use, before sending anyone to Telegram", async () => {
    const first = await start({ email: "taken@example.com" });
    await deliver(startMessage(payloadFrom(first.json!.deepLink), { fromId: 222 }));
    await complete(first.json!.pendingId);

    const second = await start({ email: "taken@example.com" });
    expect(second.status).toBe(409);
  });

  it("refuses an unknown church", async () => {
    const res = await start({ churchId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("still requires an email or a phone number", async () => {
    const res = await call("/api/v1/auth/telegram/start", {
      method: "POST",
      body: {
        password: "a-good-long-password",
        displayName: "No Contact",
        churchId,
        language: "am",
      },
    });
    expect(res.status).toBe(400);
  });

  it("does not honour a role asserted in the body", async () => {
    const started = await start({ role: "super_admin", pastorStatus: "approved" });
    await deliver(startMessage(payloadFrom(started.json!.deepLink)));
    const res = await complete(started.json!.pendingId);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, res.json!.user.id),
    });
    expect(profile!.role).toBe("member");
    expect(profile!.pastorStatus).toBeNull();
  });

  it("creates a phone-only account, which email verification still exempts", async () => {
    const started = await start({ email: undefined, phone: "0911234567" });
    await deliver(startMessage(payloadFrom(started.json!.deepLink)));
    const res = await complete(started.json!.pendingId);

    expect(res.status).toBe(200);
    expect(res.json!.user.email).toBeNull();
    expect(res.json!.user.phone).toBe("+251911234567");
  });
});

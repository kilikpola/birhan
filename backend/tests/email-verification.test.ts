import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

// Captured outbound mail. Declared through vi.hoisted so the vi.mock factory
// below — which is hoisted above every import — can reach it.
const mail = vi.hoisted(() => ({ sent: [] as { to: string; link: string }[] }));

// The routes talk to PGlite instead of a real pool. Everything else about them
// is the shipped code, including the transaction they run in.
vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

vi.mock("../src/services/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/email.js")>();
  return {
    ...actual,
    sendVerificationEmail: async ({ to, link }: { to: string; link: string }) => {
      mail.sent.push({ to, link });
      return true;
    },
  };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { default: app } = await import("../src/index.js");
const { renderVerificationEmail } = await import("../src/services/email.js");
const { issueToken, parseToken, verifierMatches } = await import("../src/utils/tokens.js");
const { registerAccount, startRegistration, confirmTelegram, completeSignup } =
  await import("./support/register.js");

// The auth routes are rate limited per IP per path, and the limiter's store is
// module state that outlives a test. A distinct address per request keeps the
// limiter out of the way of everything except the test that is about it.
let ipCounter = 0;
function freshIp() {
  return `10.0.0.${++ipCounter % 250}:${ipCounter}`;
}

type Json = Record<string, any>;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; ip?: string; accept?: string } = {}
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": opts.ip ?? freshIp(),
    accept: opts.accept ?? "application/json",
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
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

let churchId: string;

async function seedChurch() {
  const [church] = await db
    .insert(schema.churches)
    .values({ nameAm: "ደብረ ብርሃን", nameEn: "Debre Birhan" })
    .returning();
  return church.id;
}

let signupSeq = 0;
async function signup(overrides: Json = {}) {
  signupSeq += 1;
  const body: Json = {
    email: `member${signupSeq}@example.com`,
    password: "a-good-long-password",
    displayName: `Member ${signupSeq}`,
    churchId,
    language: "am",
    ...overrides,
  };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  // Signup is a three-step flow now — see tests/support/register.ts. Nothing in
  // this suite is about Telegram, so the helper drives all three.
  return registerAccount(call, body);
}

/** An announcement to reply to. Written straight to the database. */
async function seedAnnouncement(authorId: string) {
  const [a] = await db
    .insert(schema.announcements)
    .values({
      churchId,
      authorId,
      titleAm: "ማስታወቂያ",
      titleEn: "Announcement",
      body: "Sunday service",
    })
    .returning();
  return a.id;
}

/** The token from the most recent verification email. */
function lastLinkToken(): string {
  const last = mail.sent.at(-1);
  if (!last) throw new Error("no verification email was sent");
  return new URL(last.link).searchParams.get("token")!;
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await truncateAll();
  mail.sent.length = 0;
  churchId = await seedChurch();
});

// ---------------------------------------------------------------------------

describe("token format", () => {
  it("stores only a hash and compares the secret half in constant time", () => {
    const { token, selector, verifierHash } = issueToken();

    // The secret never appears in what is stored.
    expect(verifierHash).not.toContain(token.split(".")[1]);
    expect(verifierHash).toMatch(/^[0-9a-f]{64}$/);

    const parsed = parseToken(token)!;
    expect(parsed.selector).toBe(selector);
    expect(verifierMatches(parsed.verifier, verifierHash)).toBe(true);
    expect(verifierMatches("not-the-verifier", verifierHash)).toBe(false);
  });

  it("rejects malformed tokens without touching the database", () => {
    for (const bad of ["", ".", "abc", "abc.", ".def", "zzzz.def", "abcdef.x", "a".repeat(600)]) {
      expect(parseToken(bad)).toBeNull();
    }

    // Well-formed but unknown: parsing accepts it, and the lookup is what says
    // no. That is the boundary — shape here, existence in the database.
    expect(parseToken("a".repeat(16) + ".x")).toEqual({ selector: "a".repeat(16), verifier: "x" });
  });
});

describe("signup is one transaction", () => {
  it("leaves no orphaned auth user when the profile insert fails", async () => {
    // A phone already spoken for at the profile level but not at the user
    // level: the pre-flight check on users passes, the users row is written,
    // and profiles then violates its unique index — a failure that lands
    // squarely in the middle of the transaction.
    const [squatter] = await db.insert(schema.users).values({ email: "squatter@example.com" }).returning();
    await db.insert(schema.profiles).values({
      id: squatter.id,
      displayName: "Squatter",
      phone: "+251911223344",
      churchId,
    });

    const res = await signup({ email: "orphan@example.com", phone: "+251911223344" });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, "orphan@example.com"),
    });
    expect(user).toBeUndefined();

    // And nothing else survived the rollback either.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.emailVerificationTokens);
    expect(count).toBe(0);
    expect(await db.select().from(schema.users)).toHaveLength(1); // only the squatter
  });

  it("creates user, profile and verification token together", async () => {
    const res = await signup({ branchId: null, churchRole: "deacon" });
    expect(res.status).toBe(200);

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, res.json!.user.id) });
    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, res.json!.user.id),
    });

    expect(user).toBeDefined();
    expect(user!.emailVerified).toBe(false);
    expect(profile!.churchRole).toBe("deacon");
    expect(profile!.role).toBe("member");
    expect(mail.sent).toHaveLength(1);
  });

  it("accepts the snake_case field names from the spec", async () => {
    // The snake_case spelling is accepted where the details are now submitted.
    const res = await registerAccount(call, {
      email: "snake@example.com",
      password: "a-good-long-password",
      display_name: "Snake Case",
      church_id: churchId,
      church_role: "elder",
      language: "en",
    });
    expect(res.status).toBe(200);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, res.json!.user.id),
    });
    expect(profile!.displayName).toBe("Snake Case");
    expect(profile!.churchRole).toBe("elder");
  });

  it("ignores role and pastor_status in the body instead of honouring them", async () => {
    const res = await signup({
      role: "super_admin",
      pastor_status: "approved",
      pastorStatus: "approved",
      emailVerified: true,
      email_verified: true,
    });
    expect(res.status).toBe(200);

    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, res.json!.user.id),
    });
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, res.json!.user.id) });

    expect(profile!.role).toBe("member");
    expect(profile!.pastorStatus).toBeNull();
    expect(user!.emailVerified).toBe(false);

    // And the token minted for them says the same.
    const claims = JSON.parse(Buffer.from(res.json!.token.split(".")[1], "base64url").toString());
    expect(claims.role).toBe("member");
    expect(claims.email_verified).toBe(false);
  });
});

describe("unverified accounts", () => {
  it("can log in", async () => {
    await signup({ email: "unverified@example.com" });

    const res = await call("/api/v1/auth/login", {
      method: "POST",
      body: { identifier: "unverified@example.com", password: "a-good-long-password" },
    });

    expect(res.status).toBe(200);
    expect(res.json!.token).toBeTruthy();
    expect(res.json!.user.emailVerified).toBe(false);
  });

  it("can read, but is 403 EMAIL_NOT_VERIFIED on every write", async () => {
    const signed = await signup({ email: "reader@example.com" });
    const token = signed.json!.token;
    const userId = signed.json!.user.id;

    // Reads are open.
    expect((await call("/api/v1/announcements", { token })).status).toBe(200);
    expect((await call("/api/v1/resources", { token })).status).toBe(200);
    expect((await call("/api/v1/me", { token })).status).toBe(200);

    const announcementId = await seedAnnouncement(userId);

    const writes = [
      ["reply", `/api/v1/announcements/${announcementId}/replies`, { text: "አሜን" }],
      ["announcement", "/api/v1/announcements", { titleAm: "ር", titleEn: "T", body: "b" }],
      ["resource upload", "/api/v1/resources/upload-url", {
        filename: "notes.pdf", mimeType: "application/pdf", fileSizeBytes: 1024,
      }],
      ["pastor application", "/api/v1/pastor-verification", { docPath: "docs/x.pdf" }],
    ] as const;

    for (const [label, path, body] of writes) {
      const res = await call(path, { method: "POST", body, token });
      expect(res.status, label).toBe(403);
      expect(res.json!.error.code, label).toBe("EMAIL_NOT_VERIFIED");
    }

    // Nothing was written.
    expect(await db.select().from(schema.replies)).toHaveLength(0);
  });

  it("writes once the address is confirmed", async () => {
    const signed = await signup({ email: "confirms@example.com" });
    const announcementId = await seedAnnouncement(signed.json!.user.id);

    const verify = await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(lastLinkToken())}`);
    expect(verify.status).toBe(200);
    expect(verify.json!.status).toBe("verified");

    // The old token still claims unverified — which is exactly why refresh
    // re-reads the row rather than copying claims forward.
    const stale = await call(`/api/v1/announcements/${announcementId}/replies`, {
      method: "POST", body: { text: "too soon" }, token: signed.json!.token,
    });
    expect(stale.status).toBe(403);

    const refreshed = await call("/api/v1/auth/refresh", {
      method: "POST", token: signed.json!.token,
    });
    expect(refreshed.status).toBe(200);

    const res = await call(`/api/v1/announcements/${announcementId}/replies`, {
      method: "POST", body: { text: "አሜን" }, token: refreshed.json!.token,
    });
    expect(res.status).toBe(201);
  });
});

describe("phone-only accounts", () => {
  it("write without any email verification", async () => {
    const signed = await signup({ email: undefined, phone: "0911234567" });
    expect(signed.status).toBe(200);
    expect(signed.json!.user.phone).toBe("+251911234567");
    expect(signed.json!.user.email).toBeNull();

    // Nothing to verify, so nothing was sent.
    expect(mail.sent).toHaveLength(0);

    const announcementId = await seedAnnouncement(signed.json!.user.id);
    const res = await call(`/api/v1/announcements/${announcementId}/replies`, {
      method: "POST", body: { text: "እግዚአብሔር ይመስገን" }, token: signed.json!.token,
    });

    expect(res.status).toBe(201);
  });

  it("are not held by a stale token that predates the verification claims", async () => {
    // A token with no email/email_verified claims at all, as minted by the
    // previous release. The gate has to resolve those from the row rather than
    // assume the worst and lock the account out.
    const signed = await signup({ email: undefined, phone: "0922334455" });
    const announcementId = await seedAnnouncement(signed.json!.user.id);

    const { SignJWT } = await import("jose");
    const legacy = await new SignJWT({
      user_id: signed.json!.user.id,
      church_id: churchId,
      role: "member",
      branch_id: null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));

    const res = await call(`/api/v1/announcements/${announcementId}/replies`, {
      method: "POST", body: { text: "ሰላም" }, token: legacy,
    });
    expect(res.status).toBe(201);
  });
});

describe("verification tokens", () => {
  it("work once and only once", async () => {
    await signup({ email: "once@example.com" });
    const token = lastLinkToken();
    const path = `/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;

    const first = await call(path);
    expect(first.status).toBe(200);
    expect(first.json!.status).toBe("verified");

    const second = await call(path);
    expect(second.status).toBe(410);
    expect(second.json!.error.code).toBe("TOKEN_USED");
    expect(second.json!.canResend).toBe(true);
  });

  it("fail once expired, and say a resend will fix it", async () => {
    await signup({ email: "expired@example.com" });
    const token = lastLinkToken();

    await db
      .update(schema.emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.emailVerificationTokens.selector, parseToken(token)!.selector));

    const res = await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(410);
    expect(res.json!.error.code).toBe("TOKEN_EXPIRED");
    expect(res.json!.canResend).toBe(true);

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, "expired@example.com"),
    });
    expect(user!.emailVerified).toBe(false);
  });

  it("reject a forged verifier against a real selector", async () => {
    await signup({ email: "forge@example.com" });
    const { selector } = parseToken(lastLinkToken())!;

    const res = await call(`/api/v1/auth/verify-email?token=${selector}.forged-verifier`);
    expect(res.status).toBe(400);
    expect(res.json!.error.code).toBe("TOKEN_INVALID");
  });

  it("retire every other outstanding link once one is used", async () => {
    const signed = await signup({ email: "many@example.com" });
    const first = lastLinkToken();

    await call("/api/v1/auth/resend-verification", { method: "POST", token: signed.json!.token });
    const second = lastLinkToken();
    expect(second).not.toBe(first);

    expect((await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(second)}`)).json!.status)
      .toBe("verified");

    const stale = await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(first)}`);
    expect(stale.status).toBe(410);
    expect(stale.json!.error.code).toBe("TOKEN_USED");
  });

  it("answer a browser with a page rather than JSON", async () => {
    await signup({ email: "browser@example.com" });
    const res = await call(`/api/v1/auth/verify-email?token=${encodeURIComponent(lastLinkToken())}`, {
      accept: "text/html,application/xhtml+xml",
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<!doctype html>");
    expect(res.text).toContain("birhan://verify?status=verified");
    // Bilingual, Amharic first.
    expect(res.text.indexOf("ኢሜይልዎ ተረጋግጧል")).toBeLessThan(res.text.indexOf("Your email is confirmed"));
  });
});

describe("resend", () => {
  it("is capped at three per hour for one account", async () => {
    const signed = await signup({ email: "resender@example.com" });
    const token = signed.json!.token;

    for (let i = 0; i < 3; i++) {
      const res = await call("/api/v1/auth/resend-verification", { method: "POST", token });
      expect(res.status, `resend ${i + 1}`).toBe(200);
    }

    const fourth = await call("/api/v1/auth/resend-verification", { method: "POST", token });
    expect(fourth.status).toBe(429);
    expect(fourth.json!.error.code).toBe("RATE_LIMITED");

    // The signup mail plus three resends, and nothing more.
    expect(mail.sent).toHaveLength(4);
  });

  it("answers identically whether or not the address is registered", async () => {
    await signup({ email: "known@example.com" });
    mail.sent.length = 0;

    const known = await call("/api/v1/auth/resend-verification", {
      method: "POST", body: { email: "known@example.com" },
    });
    const unknown = await call("/api/v1/auth/resend-verification", {
      method: "POST", body: { email: "nobody-at-all@example.com" },
    });

    expect(known.status).toBe(unknown.status);
    expect(known.json).toEqual(unknown.json);

    // The one that exists still got its mail; the answer just did not say so.
    expect(mail.sent.map((m) => m.to)).toEqual(["known@example.com"]);
  });

  it("does not disclose an over-limit account either", async () => {
    const signed = await signup({ email: "quiet@example.com" });
    for (let i = 0; i < 3; i++) {
      await call("/api/v1/auth/resend-verification", { method: "POST", token: signed.json!.token });
    }
    mail.sent.length = 0;

    const limited = await call("/api/v1/auth/resend-verification", {
      method: "POST", body: { email: "quiet@example.com" },
    });
    const unknown = await call("/api/v1/auth/resend-verification", {
      method: "POST", body: { email: "nobody-at-all@example.com" },
    });

    expect(limited.status).toBe(200);
    expect(limited.json).toEqual(unknown.json);
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses for an account with no address to verify", async () => {
    const signed = await signup({ email: undefined, phone: "0933445566" });
    const res = await call("/api/v1/auth/resend-verification", {
      method: "POST", token: signed.json!.token,
    });

    expect(res.status).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });
});

describe("email content", () => {
  it("is bilingual, Amharic first, with no images or tracking", () => {
    const link = "https://api.birhan.test/api/v1/auth/verify-email?token=abc.def";
    const { subject, text, html } = renderVerificationEmail(link);

    expect(subject).toContain("ያረጋግጡ");
    expect(subject).toContain("Verify your Birhan email");

    // Amharic body above the English one.
    expect(text.indexOf("ብርሃን")).toBeLessThan(text.indexOf("Birhan is an app"));

    expect(text).toContain(link);
    expect(text).toContain("24 ሰዓት");
    expect(text).toContain("expires in 24 hours");
    expect(text).toContain("ካልተመዘገቡ");
    expect(text).toContain("If you did not sign up");

    expect(html).not.toMatch(/<img|background-image|url\(/i);
  });
});

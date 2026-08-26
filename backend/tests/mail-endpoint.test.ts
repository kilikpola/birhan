import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The Node half of the mail hand-off, against a stand-in for send.php.
 *
 * The stand-in is not a mock of our own transport — it re-implements the
 * endpoint's checks independently (its own HMAC, its own replay window) so that
 * a mistake in signRequest fails here rather than being papered over by shared
 * code. deploy/mail/test-endpoint.sh covers the real PHP; this covers what Node
 * puts on the wire and, more importantly, what happens when the send fails.
 */

// A fixed loopback port, because config/index.ts reads MAIL_ENDPOINT_URL once at
// import time and everything below is imported after these lines run.
const PORT = 8799;
const SECRET = "mail-endpoint-test-secret";

process.env.MAIL_ENDPOINT_URL = `http://127.0.0.1:${PORT}/send.php`;
process.env.MAIL_HMAC_SECRET = SECRET;
process.env.EMAIL_FROM = "noreply@birhan.online";
process.env.MAIL_TIMEOUT_MS = "2000";

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const { default: app } = await import("../src/index.js");
const { signRequest } = await import("../src/services/mail-transport.js");
const { eq } = await import("drizzle-orm");

// ---------------------------------------------------------------------------
// A stand-in for send.php
// ---------------------------------------------------------------------------

interface Received {
  body: string;
  parsed: { to: string; subject: string; body_text: string; body_html: string };
  timestamp: string;
  signature: string;
  /** Whether the stand-in's own HMAC agreed with the one on the request. */
  signatureValid: boolean;
  /** Seconds between the request's timestamp and when it arrived. */
  skewSeconds: number;
  headerNames: string[];
}

let received: Received[] = [];

/** What the next request gets back. Set per test. */
let mode: "accept" | "refuse" = "accept";

let server: http.Server;

function verify(timestamp: string, signature: string, body: string): boolean {
  const expected = createHmac("sha256", SECRET).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

beforeAll(async () => {
  await applyMigrations();

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const timestamp = (req.headers["x-birhan-timestamp"] as string) ?? "";
      const signature = (req.headers["x-birhan-signature"] as string) ?? "";

      let parsed: Received["parsed"];
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { to: "", subject: "", body_text: "", body_html: "" };
      }

      received.push({
        body,
        parsed,
        timestamp,
        signature,
        signatureValid: Boolean(timestamp && signature && verify(timestamp, signature, body)),
        skewSeconds: Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)),
        headerNames: Object.keys(req.headers),
      });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (mode === "refuse") {
        // What the real endpoint returns when Postfix would not take the
        // message — the case that must not cost anyone their account.
        return json(502, { ok: false, error: "sendmail_failed", id: "test" });
      }
      return json(200, { ok: true, id: "test-" + received.length });
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------

type Json = Record<string, any>;

let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter % 250}:${ipCounter}`;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": freshIp(),
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
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

let churchId: string;
let signupSeq = 0;

async function signup(overrides: Json = {}) {
  signupSeq += 1;
  return call("/api/v1/auth/signup", {
    method: "POST",
    body: {
      email: `member${signupSeq}@example.com`,
      password: "a-good-long-password",
      displayName: `Member ${signupSeq}`,
      churchId,
      language: "am",
      ...overrides,
    },
  });
}

beforeEach(async () => {
  await truncateAll();
  received = [];
  mode = "accept";
  const [church] = await db
    .insert(schema.churches)
    .values({ nameAm: "ደብረ ብርሃን", nameEn: "Debre Birhan" })
    .returning();
  churchId = church.id;
});

// ---------------------------------------------------------------------------

describe("what Node puts on the wire", () => {
  it("signs the request in a way the endpoint independently verifies", async () => {
    const res = await signup();
    expect(res.status).toBe(200);

    expect(received).toHaveLength(1);
    const req = received[0];

    // Verified by the stand-in's own HMAC implementation, not by ours.
    expect(req.signatureValid).toBe(true);
    expect(req.signature).toMatch(/^[0-9a-f]{64}$/);

    // Well inside the endpoint's 60-second window.
    expect(req.skewSeconds).toBeLessThan(5);
  });

  it("binds the timestamp into the signature, so a replay cannot be re-dated", async () => {
    await signup();
    const { body, timestamp, signature } = received[0];

    // The captured request as sent: valid.
    expect(verify(timestamp, signature, body)).toBe(true);

    // The same body and the same signature under a fresh timestamp — which is
    // exactly what someone replaying a captured request past the 60-second
    // window would have to do. It must not verify.
    const later = (Number(timestamp) + 3600).toString();
    expect(verify(later, signature, body)).toBe(false);

    // And re-signing needs the secret, which is the point.
    expect(signRequest(SECRET, later, body)).not.toBe(signature);
  });

  it("sends only the four message fields — no token, no user id, no database row", async () => {
    await signup({ email: "privacy@example.com" });

    const { parsed, body } = received[0];
    expect(Object.keys(parsed).sort()).toEqual(["body_html", "body_text", "subject", "to"]);

    // The link necessarily carries the token — the endpoint has to mail it. What
    // must not be there is anything else about the account.
    expect(body).not.toContain("userId");
    expect(body).not.toContain("password");
    expect(body).not.toContain(churchId);
  });

  it("carries no credential other than the signature", async () => {
    await signup();
    const names = received[0].headerNames;

    expect(names).toContain("x-birhan-signature");
    expect(names).toContain("x-birhan-timestamp");
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("cookie");
  });

  it("sends the bilingual message, Amharic first, with the link and no images", async () => {
    await signup({ email: "reader@example.com" });
    const { parsed } = received[0];

    expect(parsed.to).toBe("reader@example.com");

    // Amharic ahead of English in the subject.
    expect(parsed.subject).toContain("ያረጋግጡ");
    expect(parsed.subject).toContain("Verify your Birhan email");
    expect(parsed.subject.indexOf("ያረጋግጡ")).toBeLessThan(parsed.subject.indexOf("Verify"));

    for (const part of [parsed.body_text, parsed.body_html]) {
      // Amharic body ahead of the English body.
      expect(part.indexOf("ብርሃን መጽሐፍ ቅዱስን")).toBeLessThan(part.indexOf("Birhan is an app"));
      // The link, the expiry, and the ignore-this line.
      expect(part).toContain("/api/v1/auth/verify-email?token=");
      expect(part).toContain("24");
      expect(part).toContain("expires in 24 hours");
      expect(part).toMatch(/ignore this message/i);
    }

    // Nothing that phones home.
    expect(parsed.body_html).not.toMatch(/<img/i);
    expect(parsed.body_html).not.toMatch(/https?:\/\/(?!api\.birhan)/);
  });
});

// ---------------------------------------------------------------------------

describe("a failed send is not a failed signup", () => {
  it("creates the account, unverified, when the endpoint refuses the message", async () => {
    mode = "refuse";

    const res = await signup({ email: "unlucky@example.com" });

    // The signup itself succeeded.
    expect(res.status).toBe(200);
    expect(res.json?.token).toBeTruthy();
    expect(res.json?.user?.email).toBe("unlucky@example.com");

    // And says so honestly, which is what turns the banner into
    // "we couldn't send the email — tap to resend".
    expect(res.json?.verificationSent).toBe(false);
    expect(res.json?.user?.emailVerified).toBe(false);

    // The row is really there and really unverified.
    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, "unlucky@example.com"),
    });
    expect(user).toBeTruthy();
    expect(user!.emailVerified).toBe(false);

    // As is the profile — a rollback would have taken it, and an account with no
    // profile can never log in.
    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.id, user!.id),
    });
    expect(profile).toBeTruthy();

    // The token was minted inside the transaction, so it survived the failure
    // and is waiting to be re-sent.
    const tokens = await db
      .select()
      .from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.userId, user!.id));
    expect(tokens).toHaveLength(1);
  });

  it("creates the account when the endpoint is not listening at all", async () => {
    // Nothing on this port. fetch fails with ECONNREFUSED rather than a status.
    const original = process.env.MAIL_ENDPOINT_URL;
    const { config } = await import("../src/config/index.js");
    config.mailEndpointUrl = "http://127.0.0.1:1/send.php";

    try {
      const res = await signup({ email: "offline@example.com" });

      expect(res.status).toBe(200);
      expect(res.json?.verificationSent).toBe(false);

      const user = await db.query.users.findFirst({
        where: eq(schema.users.email, "offline@example.com"),
      });
      expect(user).toBeTruthy();
      expect(user!.emailVerified).toBe(false);
    } finally {
      config.mailEndpointUrl = original!;
    }
  });

  it("recovers through resend: the second attempt sends and the link verifies", async () => {
    // First attempt fails.
    mode = "refuse";
    const res = await signup({ email: "retry@example.com" });
    expect(res.json?.verificationSent).toBe(false);
    expect(received).toHaveLength(1);

    const token = res.json!.token as string;

    // The endpoint comes back.
    mode = "accept";

    const resend = await call("/api/v1/auth/resend-verification", {
      method: "POST",
      body: {},
      token,
    });
    expect(resend.status).toBe(200);
    expect(resend.json?.status).toBe("sent");

    // A second message went out, to the same address.
    expect(received).toHaveLength(2);
    expect(received[1].parsed.to).toBe("retry@example.com");
    expect(received[1].signatureValid).toBe(true);

    // And the link in it actually works.
    const link = received[1].parsed.body_text.match(
      /https?:\/\/\S*\/api\/v1\/auth\/verify-email\?token=(\S+)/
    );
    expect(link).toBeTruthy();

    const verified = await call(
      `/api/v1/auth/verify-email?format=json&token=${link![1]}`
    );
    expect(verified.status).toBe(200);
    expect(verified.json?.status).toBe("verified");

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, "retry@example.com"),
    });
    expect(user!.emailVerified).toBe(true);
  });

  it("still answers the by-address resend identically when the send fails", async () => {
    mode = "refuse";
    await signup({ email: "quiet@example.com" });

    const known = await call("/api/v1/auth/resend-verification", {
      method: "POST",
      body: { email: "quiet@example.com" },
    });
    const unknown = await call("/api/v1/auth/resend-verification", {
      method: "POST",
      body: { email: "nobody@example.com" },
    });

    // A send failure must not become a way to tell registered addresses from
    // unregistered ones.
    expect(known.status).toBe(unknown.status);
    expect(known.json).toEqual(unknown.json);
  });
});

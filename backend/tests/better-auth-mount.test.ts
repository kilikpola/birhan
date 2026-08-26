import { describe, it, expect, beforeAll, vi } from "vitest";

/**
 * The /api/auth/* mount.
 *
 * It exists for Better Auth's plugin routes — chiefly the JWKS endpoint that
 * Dash ownership verification reads. It is NOT how anyone signs up or signs in:
 * Birhan does that in routes/auth.ts, inside one transaction that also creates
 * the profile row every account requires.
 *
 * Both halves of that are worth pinning. The mount has to actually work (it
 * used to 500 on everything, because the drizzle adapter had no schema), and it
 * must never grow an account-creating route, because one created there would
 * have no profile, could never log in, and would hold the unique email against
 * the real person forever.
 */

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { applyMigrations } = await import("./support/pglite-db.js");
const { default: app } = await import("../src/index.js");

let ipCounter = 0;
const freshIp = () => `10.9.0.${++ipCounter % 250}:${ipCounter}`;

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": freshIp() };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const res = await app.request(path, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* html or empty */ }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  await applyMigrations();
});

describe("account creation is not reachable through Better Auth", () => {
  it("refuses POST /api/auth/sign-up/email", async () => {
    const res = await call("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: "intruder@example.com", password: "a-good-long-password", name: "X" },
    });

    // Anything but 200 is acceptable; what must never happen is a created user.
    expect(res.status).not.toBe(200);
  });

  it("creates no user row when that route is called", async () => {
    await call("/api/auth/sign-up/email", {
      method: "POST",
      body: { email: "intruder2@example.com", password: "a-good-long-password", name: "X" },
    });

    const { db } = await import("./support/pglite-db.js");
    const schema = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, "intruder2@example.com"),
    });
    // A user here would have no profile — profiles.church_id is NOT NULL — so it
    // could never log in, while permanently squatting the unique email.
    expect(user).toBeUndefined();
  });

  it("refuses POST /api/auth/sign-in/email", async () => {
    const res = await call("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "someone@example.com", password: "whatever" },
    });
    expect(res.status).not.toBe(200);
  });
});

describe("the routes the mount exists for", () => {
  it("serves a JWKS key set rather than 500ing", async () => {
    const res = await call("/api/auth/jwks");

    // The old failure was 500 `The model "user" was not found in the schema
    // object` on every /api/auth/* path, JWKS included.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json?.keys)).toBe(true);
    expect(res.json.keys.length).toBeGreaterThan(0);
  });

  it("persists the signing key so it survives a restart", async () => {
    await call("/api/auth/jwks");

    const { db } = await import("./support/pglite-db.js");
    const schema = await import("../src/db/schema.js");
    const rows = await db.select().from(schema.authJwks);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("answers get-session without a 500", async () => {
    const res = await call("/api/auth/get-session");
    expect(res.status).toBeLessThan(500);
  });
});

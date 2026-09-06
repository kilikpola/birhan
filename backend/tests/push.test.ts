import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Push tokens and the announcement fanout.
 *
 * Claims that must hold:
 *   1. A token belongs to exactly one account — a phone changing hands re-points
 *      it (upsert on the token), it does not double-subscribe.
 *   2. A member can only forget their own token.
 *   3. The fanout reaches every member of the church except the author and the
 *      deleted, in each member's language, and never throws.
 *   4. A token Expo reports as unregistered is pruned.
 */

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const {
  registerPushToken,
  removePushToken,
  sendAnnouncementPush,
  countPushTokens,
} = await import("../src/services/push.js");

type Ctx = { userId: string; churchId: string; role: any; branchId: null; email: null; emailVerified: boolean };

let churchId: string;
const ctxFor = (userId: string): Ctx => ({ userId, churchId, role: "member", branchId: null, email: null, emailVerified: true });

async function seedUser(name: string, lang: "am" | "en" = "am") {
  const [u] = await db.insert(schema.users).values({ email: `${name}@t.co` }).returning();
  await db.insert(schema.profiles).values({ id: u.id, displayName: name, churchId, role: "member", language: lang });
  return u.id;
}

beforeAll(async () => { await applyMigrations(); });
beforeEach(async () => {
  await truncateAll();
  const [c] = await db.insert(schema.churches).values({ nameAm: "ቤተ", nameEn: "St Gabriel" }).returning();
  churchId = c.id;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("registerPushToken", () => {
  it("stores a token and moves it when another account registers the same one", async () => {
    const a = await seedUser("a");
    const b = await seedUser("b");
    await registerPushToken(ctxFor(a), "ExpoTok1", "android");
    expect(await countPushTokens(a)).toBe(1);

    // Same device, now signed in as b.
    await registerPushToken(ctxFor(b), "ExpoTok1", "android");
    expect(await countPushTokens(a)).toBe(0);
    expect(await countPushTokens(b)).toBe(1);
  });
});

describe("removePushToken", () => {
  it("only removes the caller's own token", async () => {
    const a = await seedUser("a");
    const b = await seedUser("b");
    await registerPushToken(ctxFor(a), "TokA", "ios");
    // b cannot remove a's token.
    await removePushToken(ctxFor(b), "TokA");
    expect(await countPushTokens(a)).toBe(1);
    // a can.
    await removePushToken(ctxFor(a), "TokA");
    expect(await countPushTokens(a)).toBe(0);
  });
});

describe("sendAnnouncementPush", () => {
  it("messages every member except the author and the deleted, in their language", async () => {
    const author = await seedUser("author", "am");
    const amMember = await seedUser("amem", "am");
    const enMember = await seedUser("enem", "en");
    const goneMember = await seedUser("gone", "am");
    await db.update(schema.profiles).set({ deletedAt: new Date() }).where(eq(schema.profiles.id, goneMember));

    await registerPushToken(ctxFor(author), "TokAuthor", "android");
    await registerPushToken(ctxFor(amMember), "TokAm", "android");
    await registerPushToken(ctxFor(enMember), "TokEn", "ios");
    await registerPushToken(ctxFor(goneMember), "TokGone", "android");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })) as any;
    vi.stubGlobal("fetch", fetchMock);

    await sendAnnouncementPush({
      id: "ann1", churchId, authorId: author,
      titleAm: "አማርኛ ርዕስ", titleEn: "English title", body: "The body of the announcement.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const byToken = Object.fromEntries(sent.map((m: any) => [m.to, m]));
    expect(Object.keys(byToken).sort()).toEqual(["TokAm", "TokEn"]); // not author, not deleted
    expect(byToken.TokAm.title).toBe("አማርኛ ርዕስ");
    expect(byToken.TokEn.title).toBe("English title");
    expect(byToken.TokAm.data).toMatchObject({ type: "announcement", announcement_id: "ann1" });
  });

  it("prunes a token Expo reports as unregistered", async () => {
    const member = await seedUser("m", "am");
    const author = await seedUser("author", "am");
    await registerPushToken(ctxFor(member), "DeadTok", "android");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }),
    })) as any);

    await sendAnnouncementPush({ id: "a", churchId, authorId: author, titleAm: "t", titleEn: "t", body: "b" });
    expect(await countPushTokens(member)).toBe(0);
  });

  it("never throws when the push service fails, and does nothing with no tokens", async () => {
    const author = await seedUser("author");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }) as any);
    await expect(
      sendAnnouncementPush({ id: "a", churchId, authorId: author, titleAm: "t", titleEn: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });
});

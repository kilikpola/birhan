import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Branch-change requests + branch history.
 *
 * The rules that must hold:
 *   1. A member can only REQUEST a switch; the branch changes only on approval.
 *   2. One pending request per person.
 *   3. Approval moves the member and leaves an "ex branch" in their history.
 *   4. A branch shows its current members and the ex-members who moved away.
 */

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const {
  requestBranchChange,
  approveBranchChange,
  rejectBranchChange,
  getMyBranchHistory,
  getBranchHistory,
  getMyPendingBranchChange,
} = await import("../src/services/branch-change.js");

type Ctx = { userId: string; churchId: string; role: any; branchId: string | null; email: null; emailVerified: boolean };

let churchId: string;
let main: string;   // branch ids
let youth: string;
let pastorId: string;

const memberCtx = (userId: string, branchId: string | null): Ctx =>
  ({ userId, churchId, role: "member", branchId, email: null, emailVerified: true });
const pastorCtx = (): Ctx =>
  ({ userId: pastorId, churchId, role: "pastor", branchId: main, email: null, emailVerified: true });

async function seedMember(name: string, branchId: string | null, role = "member") {
  const [u] = await db.insert(schema.users).values({ email: `${name}@t.co` }).returning();
  await db.insert(schema.profiles).values({ id: u.id, displayName: name, churchId, role: role as any, branchId });
  return u.id;
}

beforeAll(async () => { await applyMigrations(); });

beforeEach(async () => {
  await truncateAll();
  const [c] = await db.insert(schema.churches).values({ nameAm: "ቤተ", nameEn: "St Gabriel" }).returning();
  churchId = c.id;
  const [b1] = await db.insert(schema.branches).values({ churchId, nameAm: "ዋና", nameEn: "Main" }).returning();
  const [b2] = await db.insert(schema.branches).values({ churchId, nameAm: "ወጣት", nameEn: "Youth" }).returning();
  main = b1.id; youth = b2.id;
  pastorId = await seedMember("Pastor", main, "pastor");
});

describe("requestBranchChange", () => {
  it("creates a pending request without moving the member", async () => {
    const m = await seedMember("Abel", main);
    const req = await requestBranchChange(memberCtx(m, main), youth, "I moved to Bole");
    expect(req.status).toBe("pending");
    expect(req.fromBranchName).toBe("Main");
    expect(req.toBranchName).toBe("Youth");
    // not moved yet
    const p = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, m) });
    expect(p?.branchId).toBe(main);
  });

  it("refuses when the member has no branch (they self-pick instead)", async () => {
    const m = await seedMember("NoBranch", null);
    await expect(requestBranchChange(memberCtx(m, null), youth)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a target branch outside the church", async () => {
    const [c2] = await db.insert(schema.churches).values({ nameAm: "x", nameEn: "Other" }).returning();
    const [foreign] = await db.insert(schema.branches).values({ churchId: c2.id, nameAm: "f", nameEn: "Foreign" }).returning();
    const m = await seedMember("Abel", main);
    await expect(requestBranchChange(memberCtx(m, main), foreign.id)).rejects.toMatchObject({ status: 400 });
  });

  it("allows only one pending request per person", async () => {
    const m = await seedMember("Abel", main);
    await requestBranchChange(memberCtx(m, main), youth);
    await expect(requestBranchChange(memberCtx(m, main), youth)).rejects.toMatchObject({ status: 409 });
    expect(await getMyPendingBranchChange(memberCtx(m, main))).toBeTruthy();
  });
});

describe("approveBranchChange", () => {
  it("moves the member and records the ex-branch in their history", async () => {
    const m = await seedMember("Abel", main);
    const req = await requestBranchChange(memberCtx(m, main), youth);

    await approveBranchChange(pastorCtx(), req.id);

    const p = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, m) });
    expect(p?.branchId).toBe(youth);

    const history = await getMyBranchHistory(memberCtx(m, youth));
    expect(history.current?.name).toBe("Youth");
    expect(history.past.map((x) => x.branchName)).toContain("Main"); // ex branch
  });

  it("refuses to double-approve (race guard)", async () => {
    const m = await seedMember("Abel", main);
    const req = await requestBranchChange(memberCtx(m, main), youth);
    await approveBranchChange(pastorCtx(), req.id);
    await expect(approveBranchChange(pastorCtx(), req.id)).rejects.toBeTruthy();
  });

  it("refuses a request from another church", async () => {
    const m = await seedMember("Abel", main);
    const req = await requestBranchChange(memberCtx(m, main), youth);
    const otherPastor: Ctx = { userId: "x", churchId: "00000000-0000-0000-0000-000000000000", role: "pastor", branchId: null, email: null, emailVerified: true };
    await expect(approveBranchChange(otherPastor, req.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("rejectBranchChange", () => {
  it("rejects without moving the member", async () => {
    const m = await seedMember("Abel", main);
    const req = await requestBranchChange(memberCtx(m, main), youth);
    await rejectBranchChange(pastorCtx(), req.id, "Stay in Main for now");
    const p = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, m) });
    expect(p?.branchId).toBe(main);
  });
});

describe("getBranchHistory", () => {
  it("shows a branch's current members and its ex-members", async () => {
    const stayer = await seedMember("Stayer", main);
    const mover = await seedMember("Mover", main);
    const req = await requestBranchChange(memberCtx(mover, main), youth);
    await approveBranchChange(pastorCtx(), req.id);

    const h = await getBranchHistory(pastorCtx(), main);
    const currentNames = h.current.map((x) => x.displayName);
    const formerNames = h.former.map((x) => x.displayName);
    expect(currentNames).toContain("Stayer");
    expect(currentNames).not.toContain("Mover");
    expect(formerNames).toContain("Mover");      // ex-member of Main
    // Youth now has the mover as a current member.
    const hy = await getBranchHistory(pastorCtx(), youth);
    expect(hy.current.map((x) => x.displayName)).toContain("Mover");
  });
});

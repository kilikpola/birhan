import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Super-admin people & branch management.
 *
 * The console can now promote a member to pastor, demote a pastor, and add a
 * branch to any church — outside the application queue. Each of these writes a
 * role or a branch, so each is one careless edit from letting the wrong person
 * pastor a church, or pinning a pastor to a branch their church does not own.
 */

vi.mock("../src/db/index.js", async () => {
  const mod = await import("./support/pglite-db.js");
  return { db: mod.db };
});

const { db, applyMigrations, truncateAll } = await import("./support/pglite-db.js");
const schema = await import("../src/db/schema.js");
const {
  makePastor,
  removePastor,
  addBranchToChurch,
  deleteBranch,
  listChurchPeople,
  listChurchBranches,
} = await import("../src/services/church-admin.js");
const { approvePastorApplication } = await import("../src/services/pastor-verification.js");

type Ctx = {
  userId: string;
  churchId: string;
  role: "super_admin" | "member";
  branchId: string | null;
  email: string | null;
  emailVerified: boolean;
};

let churchId: string;
let otherChurchId: string;
let superCtx: Ctx;

async function seedUser(displayName: string, church: string, role: string) {
  const [u] = await db.insert(schema.users).values({ email: `${displayName.replace(/\s/g, "").toLowerCase()}@t.co` }).returning();
  await db.insert(schema.profiles).values({
    id: u.id,
    displayName,
    churchId: church,
    role: role as any,
  });
  return u.id;
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await truncateAll();
  const [c] = await db.insert(schema.churches).values({ nameAm: "ቤተ", nameEn: "St Gabriel" }).returning();
  const [c2] = await db.insert(schema.churches).values({ nameAm: "ሌላ", nameEn: "Bethel" }).returning();
  churchId = c.id;
  otherChurchId = c2.id;
  const adminId = await seedUser("Super Admin", churchId, "super_admin");
  superCtx = { userId: adminId, churchId, role: "super_admin", branchId: null, email: "a@t.co", emailVerified: true };
});

describe("addBranchToChurch", () => {
  it("adds a branch to the named church", async () => {
    const b = await addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "ወጣት" });
    expect(b.churchId).toBe(churchId);
    const list = await listChurchBranches(superCtx, churchId);
    expect(list.map((x) => x.nameEn)).toContain("Youth");
  });

  it("rejects a duplicate name in the same church", async () => {
    await addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "Youth" });
    await expect(addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "Youth" }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("404s for a church that does not exist", async () => {
    await expect(addBranchToChurch(superCtx, otherChurchId.replace(/./, "0"), { nameEn: "X", nameAm: "X" }))
      .rejects.toBeTruthy();
  });
});

describe("branch hierarchy (mother / child)", () => {
  it("adds a child under a mother", async () => {
    const mother = await addBranchToChurch(superCtx, churchId, { nameEn: "Main", nameAm: "ዋና" });
    expect(mother.parentBranchId).toBeNull();
    const child = await addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "ወጣት", parentBranchId: mother.id });
    expect(child.parentBranchId).toBe(mother.id);
  });

  it("refuses a child under another church's branch", async () => {
    const foreign = await addBranchToChurch(superCtx, otherChurchId, { nameEn: "Main", nameAm: "Main" });
    await expect(addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "Youth", parentBranchId: foreign.id }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("refuses nesting a child under a child (two levels only)", async () => {
    const mother = await addBranchToChurch(superCtx, churchId, { nameEn: "Main", nameAm: "Main" });
    const child = await addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "Youth", parentBranchId: mother.id });
    await expect(addBranchToChurch(superCtx, churchId, { nameEn: "Teens", nameAm: "Teens", parentBranchId: child.id }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("deleteBranch", () => {
  it("deletes a branch and detaches the people on it", async () => {
    const branch = await addBranchToChurch(superCtx, churchId, { nameEn: "Main", nameAm: "ዋና" });
    const memberId = await seedUser("On Branch", churchId, "member");
    await db.update(schema.profiles).set({ branchId: branch.id }).where(eq(schema.profiles.id, memberId));

    const res = await deleteBranch(superCtx, churchId, branch.id);
    expect(res).toMatchObject({ deletedId: branch.id, detachedPeople: 1 });

    const gone = await db.query.branches.findFirst({ where: eq(schema.branches.id, branch.id) });
    expect(gone).toBeUndefined();
    const person = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, memberId) });
    expect(person?.branchId).toBeNull();
  });

  it("refuses to delete a mother that still has child branches", async () => {
    const mother = await addBranchToChurch(superCtx, churchId, { nameEn: "Main", nameAm: "Main" });
    await addBranchToChurch(superCtx, churchId, { nameEn: "Youth", nameAm: "Youth", parentBranchId: mother.id });
    await expect(deleteBranch(superCtx, churchId, mother.id)).rejects.toMatchObject({ status: 409 });
    // Still there.
    const still = await db.query.branches.findFirst({ where: eq(schema.branches.id, mother.id) });
    expect(still).toBeTruthy();
  });

  it("404s deleting a branch from the wrong church", async () => {
    const foreign = await addBranchToChurch(superCtx, otherChurchId, { nameEn: "Main", nameAm: "Main" });
    await expect(deleteBranch(superCtx, churchId, foreign.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("makePastor", () => {
  it("promotes a member and creates the branch they lead", async () => {
    const memberId = await seedUser("Abel T", churchId, "member");
    const updated = await makePastor(superCtx, memberId, { newBranchName: "Bole" });
    expect(updated.role).toBe("pastor");
    expect(updated.pastorStatus).toBe("approved");
    expect(updated.branchId).toBeTruthy();

    const branches = await listChurchBranches(superCtx, churchId);
    expect(branches.map((b) => b.nameEn)).toContain("Bole");
  });

  it("promotes onto an existing branch by id", async () => {
    const memberId = await seedUser("Sara G", churchId, "member");
    const branch = await addBranchToChurch(superCtx, churchId, { nameEn: "Main", nameAm: "ዋና" });
    const updated = await makePastor(superCtx, memberId, { branchId: branch.id });
    expect(updated.branchId).toBe(branch.id);
  });

  it("refuses a branch that belongs to another church", async () => {
    const memberId = await seedUser("Yon", churchId, "member");
    const foreign = await addBranchToChurch(superCtx, otherChurchId, { nameEn: "Foreign", nameAm: "Foreign" });
    await expect(makePastor(superCtx, memberId, { branchId: foreign.id }))
      .rejects.toMatchObject({ status: 400 });
    // The failed promotion left no partial write.
    const p = await db.query.profiles.findFirst({ where: eq(schema.profiles.id, memberId) });
    expect(p?.role).toBe("member");
  });

  it("will not flip an admin down to pastor", async () => {
    const adminId = await seedUser("Some Admin", churchId, "admin");
    await expect(makePastor(superCtx, adminId, {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("removePastor", () => {
  it("returns a pastor to member and clears verification, keeping the branch", async () => {
    const memberId = await seedUser("Pas Tor", churchId, "member");
    const promoted = await makePastor(superCtx, memberId, { newBranchName: "West" });
    const branchId = promoted.branchId;

    const demoted = await removePastor(superCtx, memberId);
    expect(demoted.role).toBe("member");
    expect(demoted.pastorStatus).toBeNull();
    expect(demoted.branchId).toBe(branchId);
  });

  it("rejects removing someone who is not a pastor", async () => {
    const memberId = await seedUser("Plain Member", churchId, "member");
    await expect(removePastor(superCtx, memberId)).rejects.toMatchObject({ status: 400 });
  });
});

describe("listChurchPeople", () => {
  it("lists church members and hides deleted accounts", async () => {
    await seedUser("Alive One", churchId, "member");
    const deletedId = await seedUser("Gone One", churchId, "member");
    await db.update(schema.profiles).set({ deletedAt: new Date() }).where(eq(schema.profiles.id, deletedId));

    const people = await listChurchPeople(superCtx, churchId);
    const names = people.map((p) => p.displayName);
    expect(names).toContain("Alive One");
    expect(names).not.toContain("Gone One");
  });
});

describe("approvePastorApplication branch override", () => {
  it("uses the reviewer's chosen branch over the applicant's claim", async () => {
    const applicantId = await seedUser("Applicant", churchId, "pending_pastor");
    await db.update(schema.profiles)
      .set({ pastorStatus: "pending", pastorBranchName: "Claimed", pastorRequestedAt: new Date() })
      .where(eq(schema.profiles.id, applicantId));
    const chosen = await addBranchToChurch(superCtx, churchId, { nameEn: "Chosen", nameAm: "Chosen" });

    const updated = await approvePastorApplication(superCtx, applicantId, { branchId: chosen.id });
    expect(updated.role).toBe("pastor");
    expect(updated.branchId).toBe(chosen.id);

    // The applicant's claimed branch was not created, because the reviewer overrode it.
    const branches = await listChurchBranches(superCtx, churchId);
    expect(branches.map((b) => b.nameEn)).not.toContain("Claimed");
    expect(branches.map((b) => b.nameEn)).toContain("Chosen");
  });

  it("falls back to the applicant's claimed branch when the reviewer chooses nothing", async () => {
    const applicantId = await seedUser("Applicant Two", churchId, "pending_pastor");
    await db.update(schema.profiles)
      .set({ pastorStatus: "pending", pastorBranchName: "Homegroup", pastorRequestedAt: new Date() })
      .where(eq(schema.profiles.id, applicantId));

    const updated = await approvePastorApplication(superCtx, applicantId, {});
    expect(updated.role).toBe("pastor");
    const branches = await listChurchBranches(superCtx, churchId);
    expect(branches.map((b) => b.nameEn)).toContain("Homegroup");
    expect(updated.branchId).toBe(branches.find((b) => b.nameEn === "Homegroup")!.id);
  });
});

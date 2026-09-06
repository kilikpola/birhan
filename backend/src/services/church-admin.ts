import { db } from "../db/index.js";
import { profiles, branches, churches, users } from "../db/schema.js";
import { and, eq, isNull, asc } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireAuth, requireRole } from "./role-check.js";
import { Errors } from "../utils/errors.js";

/** A Drizzle transaction handle, or the top-level db when no tx is in play. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Turn a branch choice into a branch id, scoped to one church.
 *
 * The caller offers at most one of two things: an existing `branchId`, or a
 * `newBranchName` to create. This is the single place that decides what "the
 * pastor's branch" resolves to, so promotion and application-approval cannot
 * drift apart.
 *
 *  - `branchId` given: it must belong to `churchId`. Passing another church's
 *    branch is a request error, not a silent no-op — otherwise a pastor could
 *    be pinned to a branch their church does not own.
 *  - `newBranchName` given: reused if a branch of that name already exists in
 *    the church (two pastors from one congregation should share it, not spawn
 *    duplicates), otherwise created.
 *  - neither: returns undefined, meaning "leave the branch as it was".
 *
 * `createdBy` is the acting super admin — they are the one adding the branch.
 */
export async function resolveBranchId(
  tx: Tx,
  churchId: string,
  choice: { branchId?: string | null; newBranchName?: string | null },
  createdBy: string,
): Promise<string | undefined> {
  if (choice.branchId) {
    const existing = await tx.query.branches.findFirst({
      where: and(eq(branches.id, choice.branchId), eq(branches.churchId, churchId)),
    });
    if (!existing) throw Errors.validation("That branch does not belong to this church");
    return existing.id;
  }

  const name = choice.newBranchName?.trim();
  if (name) {
    const existing = await tx.query.branches.findFirst({
      where: and(eq(branches.churchId, churchId), eq(branches.nameEn, name)),
    });
    if (existing) return existing.id;

    const [created] = await tx.insert(branches).values({
      churchId,
      nameAm: name,
      nameEn: name,
      createdBy,
    }).returning();
    return created.id;
  }

  return undefined;
}

export async function listChurchPeople(ctx: AuthContext, churchId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const church = await db.query.churches.findFirst({ where: eq(churches.id, churchId) });
  if (!church) throw Errors.notFound("Church not found");

  return db.select({
    id: profiles.id,
    displayName: profiles.displayName,
    email: users.email,
    role: profiles.role,
    churchRole: profiles.churchRole,
    branchId: profiles.branchId,
    branchName: branches.nameEn,
    pastorStatus: profiles.pastorStatus,
    createdAt: profiles.createdAt,
  })
    .from(profiles)
    .leftJoin(branches, eq(profiles.branchId, branches.id))
    .leftJoin(users, eq(profiles.id, users.id))
    // Deleted accounts keep their row so replies still resolve, but they are
    // nobody to manage — they must not appear in the people list.
    .where(and(eq(profiles.churchId, churchId), isNull(profiles.deletedAt)))
    .orderBy(asc(profiles.displayName));
}

export async function listChurchBranches(ctx: AuthContext, churchId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  return db.select({
    id: branches.id,
    nameAm: branches.nameAm,
    nameEn: branches.nameEn,
    createdAt: branches.createdAt,
  })
    .from(branches)
    .where(eq(branches.churchId, churchId))
    .orderBy(asc(branches.nameEn));
}

export async function addBranchToChurch(
  ctx: AuthContext,
  churchId: string,
  input: { nameAm: string; nameEn: string },
) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const church = await db.query.churches.findFirst({ where: eq(churches.id, churchId) });
  if (!church) throw Errors.notFound("Church not found");

  const nameEn = input.nameEn.trim();
  const nameAm = input.nameAm.trim();

  // A church's branch names are its own namespace; a duplicate is almost always
  // a double-submit, and the promote flow already treats same-name as the same
  // branch, so reject it here rather than leave two indistinguishable rows.
  const existing = await db.query.branches.findFirst({
    where: and(eq(branches.churchId, churchId), eq(branches.nameEn, nameEn)),
  });
  if (existing) throw Errors.conflict("A branch with that name already exists");

  const [branch] = await db.insert(branches).values({
    churchId,
    nameAm: nameAm || nameEn,
    nameEn,
    createdBy: ctx.userId,
  }).returning();

  return branch;
}

/**
 * Promote a person to pastor directly — the admin override that does not need
 * an application. Optionally sets the branch they lead in the same step.
 *
 * Deliberately narrow about who it will touch: only a member or a
 * pending_pastor. It will not flip an admin or super_admin down into a pastor
 * (that is an accident waiting to happen from a mis-click in a people list),
 * and re-running it on an existing pastor only updates their branch.
 */
export async function makePastor(
  ctx: AuthContext,
  userId: string,
  choice: { branchId?: string | null; newBranchName?: string | null } = {},
) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  if (!profile || profile.deletedAt) throw Errors.notFound("Person not found");
  if (profile.role === "admin" || profile.role === "super_admin") {
    throw Errors.forbidden("Cannot change the role of an admin from here");
  }

  return db.transaction(async (tx) => {
    const chosen = await resolveBranchId(tx, profile.churchId, choice, ctx.userId);

    const [updated] = await tx.update(profiles)
      .set({
        role: "pastor",
        pastorStatus: "approved",
        pastorRejectedReason: null,
        branchId: chosen ?? profile.branchId,
      })
      .where(eq(profiles.id, userId))
      .returning();

    return updated;
  });
}

/**
 * Revoke someone's pastor role, returning them to a plain member.
 *
 * Clears the verification state so they no longer surface as an approved
 * pastor, but leaves `branchId` alone — a former pastor is still a member of
 * that branch, and nulling it would quietly detach them from their community.
 */
export async function removePastor(ctx: AuthContext, userId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  if (!profile || profile.deletedAt) throw Errors.notFound("Person not found");
  if (profile.role !== "pastor" && profile.role !== "pending_pastor") {
    throw Errors.validation("This person is not a pastor");
  }

  const [updated] = await db.update(profiles)
    .set({
      role: "member",
      pastorStatus: null,
      pastorRejectedReason: null,
    })
    .where(eq(profiles.id, userId))
    .returning();

  return updated;
}

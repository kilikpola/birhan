import { db } from "../db/index.js";
import { profiles, branches, branchChangeRequests, users } from "../db/schema.js";
import { and, eq, desc, isNull } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireAuth, requireRole } from "./role-check.js";
import { Errors } from "../utils/errors.js";

/** Postgres unique-violation (the one-pending-per-person partial index). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

const PASTOR_ROLES = ["pastor", "admin", "super_admin"] as const;

/**
 * A member asks to move to another branch of their own church. Nothing changes
 * yet — a pastor/admin has to approve. Only for a switch FROM an existing
 * branch; a member with no branch picks one directly (see me.ts).
 */
export async function requestBranchChange(ctx: AuthContext, toBranchId: string, reason?: string) {
  requireAuth(ctx);

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, ctx.userId) });
  if (!profile) throw Errors.notFound("Profile not found");
  if (!profile.branchId) {
    throw Errors.validation("You have no branch yet — choose one in Settings, no approval needed.");
  }
  if (profile.branchId === toBranchId) throw Errors.validation("You are already in that branch.");

  const target = await db.query.branches.findFirst({
    where: and(eq(branches.id, toBranchId), eq(branches.churchId, profile.churchId)),
  });
  if (!target) throw Errors.validation("That branch is not part of your church.");

  const from = await db.query.branches.findFirst({ where: eq(branches.id, profile.branchId) });

  try {
    const [req] = await db.insert(branchChangeRequests).values({
      profileId: ctx.userId,
      churchId: profile.churchId,
      fromBranchId: profile.branchId,
      fromBranchName: from?.nameEn ?? null,
      toBranchId,
      toBranchName: target.nameEn,
      reason: reason?.trim() || null,
    }).returning();
    return req;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw Errors.conflict("You already have a branch change waiting for a pastor's approval.");
    }
    throw err;
  }
}

/** The caller's own pending request, if any — so the app can show "waiting". */
export async function getMyPendingBranchChange(ctx: AuthContext) {
  requireAuth(ctx);
  const row = await db.query.branchChangeRequests.findFirst({
    where: and(eq(branchChangeRequests.profileId, ctx.userId), eq(branchChangeRequests.status, "pending")),
  });
  return row ?? null;
}

/**
 * The caller's branch history: where they are now, and the branches they have
 * left. Each approved switch leaves an "ex branch" (the from side).
 */
export async function getMyBranchHistory(ctx: AuthContext) {
  requireAuth(ctx);
  return branchHistoryForProfile(ctx.userId);
}

async function branchHistoryForProfile(profileId: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, profileId),
    columns: { branchId: true },
  });
  const current = profile?.branchId
    ? await db.query.branches.findFirst({ where: eq(branches.id, profile.branchId), columns: { id: true, nameEn: true } })
    : null;

  const past = await db.select({
    branchName: branchChangeRequests.fromBranchName,
    branchId: branchChangeRequests.fromBranchId,
    leftAt: branchChangeRequests.decidedAt,
  })
    .from(branchChangeRequests)
    .where(and(
      eq(branchChangeRequests.profileId, profileId),
      eq(branchChangeRequests.status, "approved"),
    ))
    .orderBy(desc(branchChangeRequests.decidedAt));

  return {
    current: current ? { id: current.id, name: current.nameEn } : null,
    past: past.filter((p) => p.branchName), // rows whose from-branch is known
  };
}

// --- Pastor / admin side ---

export async function listBranchChangeRequests(ctx: AuthContext, status: "pending" | "approved" | "rejected" = "pending") {
  requireAuth(ctx);
  requireRole(ctx, [...PASTOR_ROLES]);

  return db.select({
    id: branchChangeRequests.id,
    profileId: branchChangeRequests.profileId,
    memberName: profiles.displayName,
    fromBranchName: branchChangeRequests.fromBranchName,
    toBranchName: branchChangeRequests.toBranchName,
    reason: branchChangeRequests.reason,
    status: branchChangeRequests.status,
    createdAt: branchChangeRequests.createdAt,
    decidedAt: branchChangeRequests.decidedAt,
  })
    .from(branchChangeRequests)
    .leftJoin(profiles, eq(profiles.id, branchChangeRequests.profileId))
    .where(and(eq(branchChangeRequests.churchId, ctx.churchId), eq(branchChangeRequests.status, status)))
    .orderBy(branchChangeRequests.createdAt);
}

export async function approveBranchChange(ctx: AuthContext, requestId: string) {
  requireAuth(ctx);
  requireRole(ctx, [...PASTOR_ROLES]);

  return db.transaction(async (tx) => {
    const req = await tx.query.branchChangeRequests.findFirst({ where: eq(branchChangeRequests.id, requestId) });
    if (!req || req.status !== "pending") throw Errors.notFound("Pending request not found");
    if (req.churchId !== ctx.churchId && ctx.role !== "super_admin") {
      throw Errors.forbidden("That request is not in your church");
    }

    // Claim it — conditional on still pending, so two approvers cannot both win.
    const [updated] = await tx.update(branchChangeRequests)
      .set({ status: "approved", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(branchChangeRequests.id, requestId), eq(branchChangeRequests.status, "pending")))
      .returning();
    if (!updated) throw Errors.conflict("That request has already been handled");

    // Move the member — only if the target branch still exists in the church.
    if (req.toBranchId) {
      const target = await tx.query.branches.findFirst({
        where: and(eq(branches.id, req.toBranchId), eq(branches.churchId, req.churchId)),
      });
      if (target) {
        await tx.update(profiles).set({ branchId: req.toBranchId }).where(eq(profiles.id, req.profileId));
      }
    }
    return updated;
  });
}

export async function rejectBranchChange(ctx: AuthContext, requestId: string, reason: string) {
  requireAuth(ctx);
  requireRole(ctx, [...PASTOR_ROLES]);

  const req = await db.query.branchChangeRequests.findFirst({ where: eq(branchChangeRequests.id, requestId) });
  if (!req) throw Errors.notFound("Request not found");
  if (req.churchId !== ctx.churchId && ctx.role !== "super_admin") {
    throw Errors.forbidden("That request is not in your church");
  }

  const [updated] = await db.update(branchChangeRequests)
    .set({ status: "rejected", rejectedReason: reason, decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(branchChangeRequests.id, requestId), eq(branchChangeRequests.status, "pending")))
    .returning();
  if (!updated) throw Errors.conflict("That request has already been handled");
  return updated;
}

/**
 * A branch's people, now and before: its current members and the ex-members who
 * have since moved away. For pastors/admins (their church) and super admins
 * (any church, from the console).
 */
export async function getBranchHistory(ctx: AuthContext, branchId: string) {
  requireAuth(ctx);
  requireRole(ctx, [...PASTOR_ROLES]);

  const branch = await db.query.branches.findFirst({ where: eq(branches.id, branchId) });
  if (!branch) throw Errors.notFound("Branch not found");
  if (branch.churchId !== ctx.churchId && ctx.role !== "super_admin") {
    throw Errors.forbidden("That branch is not in your church");
  }

  const current = await db.select({
    id: profiles.id,
    displayName: profiles.displayName,
    role: profiles.role,
    email: users.email,
  })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.id))
    .where(and(eq(profiles.branchId, branchId), isNull(profiles.deletedAt)))
    .orderBy(profiles.displayName);

  // Ex-members: an approved switch away from this branch, and they are not back
  // in it now. Distinct by profile — most recent departure wins.
  const departures = await db.select({
    profileId: branchChangeRequests.profileId,
    displayName: profiles.displayName,
    currentBranchName: branches.nameEn,
    currentBranchId: profiles.branchId,
    leftAt: branchChangeRequests.decidedAt,
  })
    .from(branchChangeRequests)
    .innerJoin(profiles, eq(profiles.id, branchChangeRequests.profileId))
    .leftJoin(branches, eq(branches.id, profiles.branchId))
    .where(and(
      eq(branchChangeRequests.fromBranchId, branchId),
      eq(branchChangeRequests.status, "approved"),
      isNull(profiles.deletedAt),
    ))
    .orderBy(desc(branchChangeRequests.decidedAt));

  const seen = new Set<string>();
  const former: typeof departures = [];
  for (const d of departures) {
    if (seen.has(d.profileId)) continue;      // keep only the latest departure
    seen.add(d.profileId);
    if (d.currentBranchId === branchId) continue; // they came back — not an ex-member
    former.push(d);
  }

  return { branch: { id: branch.id, name: branch.nameEn }, current, former };
}

/** A specific member's branch history, for a pastor/admin of their church. */
export async function getMemberBranchHistory(ctx: AuthContext, profileId: string) {
  requireAuth(ctx);
  requireRole(ctx, [...PASTOR_ROLES]);

  const member = await db.query.profiles.findFirst({ where: eq(profiles.id, profileId) });
  if (!member) throw Errors.notFound("Member not found");
  if (member.churchId !== ctx.churchId && ctx.role !== "super_admin") {
    throw Errors.forbidden("That member is not in your church");
  }
  return branchHistoryForProfile(profileId);
}

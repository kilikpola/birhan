import { db } from "../db/index.js";
import { churches, profiles, churchRequests } from "../db/schema.js";
import { and, count, desc, eq } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireAuth, requireRole } from "./role-check.js";
import { Errors } from "../utils/errors.js";

type ChurchRequestStatus = "pending" | "approved" | "rejected";

export async function getPlatformStats(ctx: AuthContext) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const [{ value: churchesCount }] = await db.select({ value: count() }).from(churches);
  const [{ value: membersCount }] = await db.select({ value: count() }).from(profiles);
  const [{ value: pastorsCount }] = await db.select({ value: count() })
    .from(profiles)
    .where(eq(profiles.role, "pastor"));
  const [{ value: pendingCount }] = await db.select({ value: count() })
    .from(profiles)
    .where(eq(profiles.pastorStatus, "pending"));
  const [{ value: pendingRequests }] = await db.select({ value: count() })
    .from(churchRequests)
    .where(eq(churchRequests.status, "pending"));

  return {
    churches: churchesCount,
    members: membersCount,
    pastors: pastorsCount,
    pending: pendingCount,
    pendingChurchRequests: pendingRequests,
  };
}

export async function listAdminChurches(ctx: AuthContext, limit = 500) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  return db.select({
    id: churches.id,
    nameAm: churches.nameAm,
    nameEn: churches.nameEn,
    denomination: churches.denomination,
    city: churches.city,
    memberCount: churches.memberCount,
    telegramChatId: churches.telegramChatId,
    telegramVerifiedAt: churches.telegramVerifiedAt,
    createdAt: churches.createdAt,
  })
    .from(churches)
    .orderBy(desc(churches.memberCount))
    .limit(limit);
}

export async function listChurchRequests(ctx: AuthContext, status: ChurchRequestStatus = "pending") {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  return db.select({
    id: churchRequests.id,
    requestedBy: churchRequests.requestedBy,
    nameEn: churchRequests.nameEn,
    nameAm: churchRequests.nameAm,
    city: churchRequests.city,
    denomination: churchRequests.denomination,
    status: churchRequests.status,
    createdChurchId: churchRequests.createdChurchId,
    rejectedReason: churchRequests.rejectedReason,
    createdAt: churchRequests.createdAt,
    requesterName: profiles.displayName,
  })
    .from(churchRequests)
    .leftJoin(profiles, eq(churchRequests.requestedBy, profiles.id))
    .where(eq(churchRequests.status, status))
    .orderBy(churchRequests.createdAt);
}

/**
 * Approves a request and creates the church it asked for.
 *
 * The status check has to happen *inside* the transaction, and the status
 * transition has to be the thing that claims the row. Reading "is it pending?"
 * in a separate query first and then updating unconditionally is a
 * check-then-act: two admins working the same pending list (or one impatient
 * double-click) both read `pending`, both insert a church, and the requester's
 * profile ends up pointing at whichever committed last — leaving a second
 * church row that nothing references and no one knows about.
 *
 * So the UPDATE carries `status = 'pending'` in its WHERE, and zero rows back
 * means somebody else got there first.
 */
export async function approveChurchRequest(ctx: AuthContext, requestId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  return db.transaction(async (tx) => {
    const existing = await tx.query.churchRequests.findFirst({
      where: eq(churchRequests.id, requestId),
    });
    if (!existing || existing.status !== "pending") {
      throw Errors.notFound("Pending church request not found");
    }

    const [church] = await tx.insert(churches).values({
      nameEn: existing.nameEn,
      nameAm: existing.nameAm || existing.nameEn,
      city: existing.city,
      denomination: existing.denomination,
    }).returning();

    await tx.update(profiles)
      .set({ churchId: church.id })
      .where(eq(profiles.id, existing.requestedBy));

    const [updated] = await tx.update(churchRequests)
      .set({ status: "approved", createdChurchId: church.id, rejectedReason: null })
      .where(and(
        eq(churchRequests.id, requestId),
        eq(churchRequests.status, "pending"),
      ))
      .returning();

    // Lost the race. Rolling back takes the church and the profile update with
    // it, so the winner's version is the only one that survives.
    if (!updated) throw Errors.conflict("That request has already been handled");

    return updated;
  });
}

/**
 * Rejects a request.
 *
 * Guarded on `pending` for the same reason as approve, and for one more: this
 * used to accept a request in any state and set `createdChurchId` to null. If
 * an approval had already gone through, rejecting afterwards left the church
 * row and the requester's `church_id` in place while erasing the only record of
 * which church that approval created — the console would then show a rejected
 * request for a church that exists and is in use.
 */
export async function rejectChurchRequest(ctx: AuthContext, requestId: string, reason: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const [updated] = await db.update(churchRequests)
    .set({ status: "rejected", rejectedReason: reason, createdChurchId: null })
    .where(and(
      eq(churchRequests.id, requestId),
      eq(churchRequests.status, "pending"),
    ))
    .returning();

  if (!updated) {
    // Either it does not exist or it is no longer pending. Distinguish them so
    // an admin who clicked a stale list entry is told what actually happened.
    const existing = await db.query.churchRequests.findFirst({
      where: eq(churchRequests.id, requestId),
    });
    if (!existing) throw Errors.notFound("Church request not found");
    throw Errors.conflict("That request has already been handled");
  }

  return updated;
}
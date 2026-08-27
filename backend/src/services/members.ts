import { db } from "../db/index.js";
import { profiles, branches } from "../db/schema.js";
import { eq, and, isNull, count } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireAuth } from "./role-check.js";

export async function listMembers(ctx: AuthContext, limit = 200) {
  requireAuth(ctx);
  // Bounded: a 400-member church would otherwise push every row down a mobile
  // connection on every roster open. 200 matches the cap the app used to apply.
  limit = Math.min(Math.max(limit, 1), 500);

  const members = await db.select({
    id: profiles.id,
    displayName: profiles.displayName,
    role: profiles.role,
    churchRole: profiles.churchRole,
    branchId: profiles.branchId,
    branchName: branches.nameEn,
    createdAt: profiles.createdAt,
  })
  .from(profiles)
  .leftJoin(branches, eq(profiles.branchId, branches.id))
  // Deleted accounts keep their row so their replies still make sense, but
  // they are not people in this church any more and must not appear on a
  // roster or in a headcount.
  .where(and(eq(profiles.churchId, ctx.churchId), isNull(profiles.deletedAt)))
  .orderBy(profiles.displayName)
  .limit(limit);

  // Total headcount, counted in the DB — the caller shows it next to a page of
  // members, so it must not be inferred from the returned rows.
  const [{ value: total }] = await db.select({ value: count() })
    .from(profiles)
    .where(and(eq(profiles.churchId, ctx.churchId), isNull(profiles.deletedAt)));

  return { members, total };
}

import { db } from "../db/index.js";
import { profiles, branches } from "../db/schema.js";
import { eq, count } from "drizzle-orm";
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
  .where(eq(profiles.churchId, ctx.churchId))
  .orderBy(profiles.displayName)
  .limit(limit);

  // Total headcount, counted in the DB — the caller shows it next to a page of
  // members, so it must not be inferred from the returned rows.
  const [{ value: total }] = await db.select({ value: count() })
    .from(profiles)
    .where(eq(profiles.churchId, ctx.churchId));

  return { members, total };
}

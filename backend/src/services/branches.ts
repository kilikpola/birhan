import { db } from "../db/index.js";
import { branches } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireRole, requireAuth } from "./role-check.js";
import { Errors } from "../utils/errors.js";

export async function createBranch(ctx: AuthContext, input: { nameAm: string; nameEn: string }) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const [branch] = await db.insert(branches).values({
    churchId: ctx.churchId,
    nameAm: input.nameAm,
    nameEn: input.nameEn,
    createdBy: ctx.userId,
  }).returning();

  return branch;
}

export async function updateBranch(ctx: AuthContext, branchId: string, input: { nameAm?: string; nameEn?: string }) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const existing = await db.query.branches.findFirst({
    where: and(eq(branches.id, branchId), eq(branches.churchId, ctx.churchId)),
  });
  if (!existing) throw Errors.notFound("Branch not found");

  const [updated] = await db.update(branches)
    .set({ ...input })
    .where(eq(branches.id, branchId))
    .returning();
  return updated;
}

export async function deleteBranch(ctx: AuthContext, branchId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const existing = await db.query.branches.findFirst({
    where: and(eq(branches.id, branchId), eq(branches.churchId, ctx.churchId)),
  });
  if (!existing) throw Errors.notFound("Branch not found");

  await db.delete(branches).where(eq(branches.id, branchId));
}

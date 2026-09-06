import { db } from "../db/index.js";
import { profiles, branches, churches, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthContext, PastorStatus } from "../types/index.js";
import { requireRole, requireAuth } from "./role-check.js";
import { resolveBranchId } from "./church-admin.js";
import { Errors } from "../utils/errors.js";
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  generatePastorDocKey,
} from "./storage.js";
import { config } from "../config/index.js";

export async function getPastorDocUploadUrl(ctx: AuthContext, filename: string, mimeType: string) {
  requireAuth(ctx);
  requireRole(ctx, ["member"]);

  const key = generatePastorDocKey(ctx.userId, filename);
  const url = await getPresignedUploadUrl(config.s3BucketPastorDocs, key, mimeType);
  return { url, key };
}

export async function submitPastorVerification(
  ctx: AuthContext,
  docPath: string,
  branchName?: string,
) {
  requireAuth(ctx);
  requireRole(ctx, ["member"]);

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, ctx.userId),
  });
  if (!profile) throw Errors.notFound("Profile not found");
  if (profile.role !== "member") {
    throw Errors.forbidden("Only members can apply for pastor verification");
  }

  const [updated] = await db.update(profiles)
    .set({
      role: "pending_pastor",
      pastorStatus: "pending",
      pastorDocPath: docPath,
      pastorRequestedAt: new Date(),
      // Held until approval, which turns it into a real branch. A member cannot
      // create one themselves.
      pastorBranchName: branchName?.trim() || null,
    })
    .where(eq(profiles.id, ctx.userId))
    .returning();

  return updated;
}

export async function getPastorVerificationStatus(ctx: AuthContext) {
  requireAuth(ctx);

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, ctx.userId),
    columns: {
      pastorStatus: true,
      pastorDocPath: true,
      pastorRejectedReason: true,
      pastorRequestedAt: true,
    },
  });

  if (!profile) throw Errors.notFound("Profile not found");
  return profile;
}

// Admin functions
const appStatuses: PastorStatus[] = ["pending", "approved", "rejected"];

export async function listPastorApplications(ctx: AuthContext, status?: PastorStatus) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const filter = status && appStatuses.includes(status) ? status : "pending";

  return db.select({
    id: profiles.id,
    displayName: profiles.displayName,
    email: users.email,
    churchId: profiles.churchId,
    churchName: churches.nameEn,
    branchId: profiles.branchId,
    branchName: branches.nameEn,
    // What branch the applicant claims to lead — the reviewer needs to see it,
    // since approving creates it.
    pastorBranchName: profiles.pastorBranchName,
    churchRole: profiles.churchRole,
    role: profiles.role,
    pastorStatus: profiles.pastorStatus,
    pastorDocPath: profiles.pastorDocPath,
    pastorRequestedAt: profiles.pastorRequestedAt,
    pastorRejectedReason: profiles.pastorRejectedReason,
  })
  .from(profiles)
  .leftJoin(churches, eq(profiles.churchId, churches.id))
  .leftJoin(branches, eq(profiles.branchId, branches.id))
  .leftJoin(users, eq(profiles.id, users.id))
  .where(eq(profiles.pastorStatus, filter))
  .orderBy(profiles.pastorRequestedAt);
}

export async function getPastorApplicationDocumentUrl(ctx: AuthContext, userId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
    columns: { pastorDocPath: true },
  });

  if (!profile || !profile.pastorDocPath) {
    throw Errors.notFound("Document not found");
  }

  const url = await getPresignedDownloadUrl(config.s3BucketPastorDocs, profile.pastorDocPath);
  return { url };
}

export async function approvePastorApplication(
  ctx: AuthContext,
  userId: string,
  choice: { branchId?: string | null; newBranchName?: string | null } = {},
) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
  });
  if (!profile || profile.pastorStatus !== "pending") {
    throw Errors.notFound("Pending application not found");
  }

  // Approval closes the whole loop in one action: promote the applicant AND
  // settle the branch they lead, linking them to it. Without this the new
  // pastor lands in an app where their branch does not exist and someone has to
  // create it by hand between approval and first use.
  return db.transaction(async (tx) => {
    let branchId = profile.branchId;

    // The reviewer's explicit choice (an existing branch, or a new name they
    // typed) wins over the branch the applicant claimed. Only when they leave it
    // untouched do we fall back to the applicant's `pastorBranchName`.
    const chosen = await resolveBranchId(tx, profile.churchId, choice, ctx.userId);
    if (chosen) {
      branchId = chosen;
    } else if (!branchId && profile.pastorBranchName) {
      const name = profile.pastorBranchName.trim();

      // Reuse a branch of the same name rather than creating a duplicate — two
      // pastors from one congregation would otherwise each get their own.
      const existing = await tx.query.branches.findFirst({
        where: and(eq(branches.churchId, profile.churchId), eq(branches.nameEn, name)),
      });

      if (existing) {
        branchId = existing.id;
      } else {
        const [created] = await tx.insert(branches).values({
          churchId: profile.churchId,
          nameAm: name,
          nameEn: name,
          createdBy: ctx.userId,
        }).returning();
        branchId = created.id;
      }
    }

    const [updated] = await tx.update(profiles)
      .set({
        role: "pastor",
        pastorStatus: "approved",
        pastorRejectedReason: null,
        branchId,
      })
      .where(eq(profiles.id, userId))
      .returning();

    return updated;
  });
}

export async function rejectPastorApplication(ctx: AuthContext, userId: string, reason: string) {
  requireAuth(ctx);
  requireRole(ctx, ["super_admin"]);

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
  });
  if (!profile || profile.pastorStatus !== "pending") {
    throw Errors.notFound("Pending application not found");
  }

  const [updated] = await db.update(profiles)
    .set({
      role: "member",
      pastorStatus: "rejected",
      pastorRejectedReason: reason,
    })
    .where(eq(profiles.id, userId))
    .returning();

  return updated;
}

import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { resources } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import type { AuthContext, ResourceCategory } from "../types/index.js";
import { requireRole, requireAuth } from "./role-check.js";
import { Errors } from "../utils/errors.js";
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  generateResourceKey,
  validateFileUpload,
} from "./storage.js";
import { config } from "../config/index.js";

export async function listResources(ctx: AuthContext, cursor?: string, limit = 20) {
  requireAuth(ctx);
  limit = Math.min(limit, 100);

  return db.select({
    id: resources.id,
    churchId: resources.churchId,
    branchId: resources.branchId,
    uploadedBy: resources.uploadedBy,
    titleAm: resources.titleAm,
    titleEn: resources.titleEn,
    description: resources.description,
    category: resources.category,
    filePath: resources.filePath,
    fileSizeBytes: resources.fileSizeBytes,
    mimeType: resources.mimeType,
    rightsConfirmed: resources.rightsConfirmed,
    createdAt: resources.createdAt,
  })
  .from(resources)
  .where(eq(resources.churchId, ctx.churchId))
  .orderBy(desc(resources.createdAt))
  .limit(limit);
}

export async function getResourceUploadUrl(
  ctx: AuthContext,
  input: { filename: string; mimeType: string; fileSizeBytes: number }
) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const validation = validateFileUpload(input.mimeType, input.fileSizeBytes);
  if (!validation.valid) {
    throw Errors.validation(validation.error!);
  }

  const resourceId = randomUUID();
  const key = generateResourceKey(ctx.churchId, resourceId, input.filename);
  const url = await getPresignedUploadUrl(config.s3BucketResources, key, input.mimeType);

  return { resourceId, url, key };
}

export async function commitResource(
  ctx: AuthContext,
  input: {
    resourceId: string;
    key: string;
    titleAm: string;
    titleEn: string;
    description?: string;
    category: ResourceCategory;
    fileSizeBytes: number;
    mimeType: string;
    rightsConfirmed: boolean;
  }
) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const [resource] = await db.insert(resources).values({
    id: input.resourceId,
    churchId: ctx.churchId,
    uploadedBy: ctx.userId,
    titleAm: input.titleAm,
    titleEn: input.titleEn,
    description: input.description,
    category: input.category,
    filePath: input.key,
    fileSizeBytes: input.fileSizeBytes,
    mimeType: input.mimeType,
    rightsConfirmed: input.rightsConfirmed,
  }).returning();

  return resource;
}

export async function getResourceDownloadUrl(ctx: AuthContext, resourceId: string) {
  requireAuth(ctx);

  const resource = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), eq(resources.churchId, ctx.churchId)),
  });
  if (!resource) throw Errors.notFound("Resource not found");

  const url = await getPresignedDownloadUrl(config.s3BucketResources, resource.filePath);
  return { url, resource };
}

export async function deleteResource(ctx: AuthContext, resourceId: string) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin", "super_admin"]);

  const resource = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), eq(resources.churchId, ctx.churchId)),
  });
  if (!resource) throw Errors.notFound("Resource not found");

  await db.delete(resources).where(eq(resources.id, resourceId));
}

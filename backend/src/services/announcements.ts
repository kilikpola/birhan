import { db } from "../db/index.js";
import { announcements, replies } from "../db/schema.js";
import { eq, and, desc, sql, count } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireRole, requireAuth } from "./role-check.js";
import { Errors } from "../utils/errors.js";

export async function listAnnouncements(ctx: AuthContext, cursor?: string, limit = 20) {
  requireAuth(ctx);
  limit = Math.min(limit, 100);

  const replyCountSub = db.select({
    announcementId: replies.announcementId,
    count: count().as("reply_count"),
  })
  .from(replies)
  .groupBy(replies.announcementId)
  .as("reply_counts");

  const baseQuery = db.select({
    id: announcements.id,
    churchId: announcements.churchId,
    authorId: announcements.authorId,
    titleAm: announcements.titleAm,
    titleEn: announcements.titleEn,
    body: announcements.body,
    locked: announcements.locked,
    postedToTelegram: announcements.postedToTelegram,
    createdAt: announcements.createdAt,
    replyCount: sql<number>`COALESCE(${replyCountSub.count}, 0)`.as("reply_count"),
  })
  .from(announcements)
  .leftJoin(replyCountSub, eq(announcements.id, replyCountSub.announcementId))
  .where(eq(announcements.churchId, ctx.churchId))
  .orderBy(desc(announcements.createdAt))
  .limit(limit);

  return baseQuery;
}

export async function getAnnouncement(ctx: AuthContext, id: string, replyLimit = 200) {
  requireAuth(ctx);
  // Bounded: one busy thread should not be able to push thousands of replies
  // onto a phone in a single response. 200 matches the app's previous cap.
  replyLimit = Math.min(Math.max(replyLimit, 1), 500);

  const announcement = await db.query.announcements.findFirst({
    where: and(eq(announcements.id, id), eq(announcements.churchId, ctx.churchId)),
    with: {
      replies: {
        orderBy: [replies.createdAt],
        limit: replyLimit,
      },
    },
  });

  if (!announcement) throw Errors.notFound("Announcement not found");
  return announcement;
}

export async function createAnnouncement(ctx: AuthContext, input: { titleAm: string; titleEn: string; body: string }) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin"]);

  const [announcement] = await db.insert(announcements).values({
    churchId: ctx.churchId,
    authorId: ctx.userId,
    titleAm: input.titleAm,
    titleEn: input.titleEn,
    body: input.body,
  }).returning();

  return announcement;
}

export async function updateAnnouncement(ctx: AuthContext, id: string, input: { titleAm?: string; titleEn?: string; body?: string }) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin"]);

  const existing = await db.query.announcements.findFirst({
    where: and(eq(announcements.id, id), eq(announcements.churchId, ctx.churchId)),
  });
  if (!existing) throw Errors.notFound("Announcement not found");

  const [updated] = await db.update(announcements)
    .set({ ...input })
    .where(eq(announcements.id, id))
    .returning();
  return updated;
}

export async function deleteAnnouncement(ctx: AuthContext, id: string) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin"]);

  const existing = await db.query.announcements.findFirst({
    where: and(eq(announcements.id, id), eq(announcements.churchId, ctx.churchId)),
  });
  if (!existing) throw Errors.notFound("Announcement not found");

  await db.delete(announcements).where(eq(announcements.id, id));
}

export async function setAnnouncementLock(ctx: AuthContext, id: string, locked: boolean) {
  requireAuth(ctx);
  requireRole(ctx, ["pastor", "admin"]);

  const existing = await db.query.announcements.findFirst({
    where: and(eq(announcements.id, id), eq(announcements.churchId, ctx.churchId)),
  });
  if (!existing) throw Errors.notFound("Announcement not found");

  const [updated] = await db.update(announcements)
    .set({ locked })
    .where(eq(announcements.id, id))
    .returning();
  return updated;
}

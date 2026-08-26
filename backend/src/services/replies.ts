import { db } from "../db/index.js";
import { replies, announcements, profiles } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthContext } from "../types/index.js";
import { requireAuth } from "./role-check.js";
import { Errors } from "../utils/errors.js";

export async function createReply(ctx: AuthContext, announcementId: string, text: string) {
  requireAuth(ctx);

  const announcement = await db.query.announcements.findFirst({
    where: and(eq(announcements.id, announcementId), eq(announcements.churchId, ctx.churchId)),
  });
  if (!announcement) throw Errors.notFound("Announcement not found");
  if (announcement.locked) throw Errors.forbidden("This thread is locked");

  // Get author name from profile
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, ctx.userId),
  });

  const [reply] = await db.insert(replies).values({
    announcementId,
    authorId: ctx.userId,
    authorName: profile?.displayName || "Unknown",
    text,
  }).returning();

  return reply;
}

export async function deleteReply(ctx: AuthContext, replyId: string) {
  requireAuth(ctx);

  const reply = await db.query.replies.findFirst({
    where: eq(replies.id, replyId),
    with: { announcement: true },
  });

  if (!reply || reply.announcement.churchId !== ctx.churchId) {
    throw Errors.notFound("Reply not found");
  }

  const isAuthor = reply.authorId === ctx.userId;
  const isPastorOrAdmin = ctx.role === "pastor" || ctx.role === "admin";

  if (!isAuthor && !isPastorOrAdmin) {
    throw Errors.forbidden("You can only delete your own replies");
  }

  await db.delete(replies).where(eq(replies.id, replyId));
}

import { and, eq, ne, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { pushTokens, profiles } from "../db/schema.js";
import type { AuthContext } from "../types/index.js";
import { requireAuth } from "./role-check.js";
import { logger } from "../middleware/logger.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANNOUNCEMENT_CHANNEL = "announcements";

/**
 * Store (or move) a device's Expo push token for the caller.
 *
 * `token` is globally unique, so this upserts on the token itself: a phone that
 * was signed into another account re-points here instead of leaving the old
 * user subscribed. Scoped entirely to `ctx.userId` — a caller can only ever
 * claim a token for themselves.
 */
export async function registerPushToken(ctx: AuthContext, token: string, platform: string | null) {
  requireAuth(ctx);

  await db.insert(pushTokens)
    .values({ userId: ctx.userId, token, platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: ctx.userId, platform, updatedAt: new Date() },
    });
}

/** Forget a token — logout, or a device the member no longer wants notified. */
export async function removePushToken(ctx: AuthContext, token: string) {
  requireAuth(ctx);
  await db.delete(pushTokens)
    .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, ctx.userId)));
}

type Announcement = {
  id: string;
  churchId: string;
  authorId: string;
  titleAm: string;
  titleEn: string;
  body: string;
};

/** Trim a body to a notification-sized preview without cutting mid-grapheme awkwardly. */
function preview(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Fan a new announcement out to every member of the church as a push
 * notification, in each member's own language. Best-effort by contract: it
 * never throws and never blocks the request that created the announcement — a
 * push service having a bad day must not fail a pastor's post.
 *
 * Dormant until the app can actually acquire push tokens (needs an EAS
 * projectId + FCM); with no tokens stored this simply does nothing.
 */
export async function sendAnnouncementPush(a: Announcement): Promise<void> {
  try {
    const rows = await db
      .select({ token: pushTokens.token, language: profiles.language })
      .from(pushTokens)
      .innerJoin(profiles, eq(profiles.id, pushTokens.userId))
      .where(and(
        eq(profiles.churchId, a.churchId),
        isNull(profiles.deletedAt),
        // The author already knows — they just wrote it.
        ne(profiles.id, a.authorId),
      ));

    if (rows.length === 0) return;

    const messages = rows.map((r) => ({
      to: r.token,
      title: r.language === "en" ? a.titleEn : a.titleAm,
      body: preview(a.body),
      sound: "default" as const,
      channelId: ANNOUNCEMENT_CHANNEL,
      priority: "high" as const,
      data: { type: "announcement", announcement_id: a.id },
    }));

    // Expo accepts up to 100 messages per request.
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, event: "push.announcement", result: "http_error" }, "Expo push request failed");
        continue;
      }
      const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
      (json.data ?? []).forEach((ticket, j) => {
        // A token Expo reports as unregistered will never work again — prune it
        // so the list does not grow stale forever.
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(batch[j].to);
        }
      });
    }

    if (invalidTokens.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, invalidTokens));
    }

    logger.info(
      { announcementId: a.id, recipients: rows.length, pruned: invalidTokens.length, event: "push.announcement", result: "sent" },
      "Announcement push fanned out",
    );
  } catch (err) {
    // Never propagate — the announcement is already created and that must stand.
    logger.error({ err: err instanceof Error ? err.message : String(err), event: "push.announcement", result: "failed" }, "Announcement push failed");
  }
}

/** How many devices this account has registered — for tests and diagnostics. */
export async function countPushTokens(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  return row?.count ?? 0;
}

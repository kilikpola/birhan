import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { announcements, churches, telegramLinkCodes } from "../db/schema.js";
import { config, telegramEnabled } from "../config/index.js";
import { logger } from "../middleware/logger.js";
import { Errors } from "../utils/errors.js";
import type { AuthContext } from "../types/index.js";
import { requireAuth, requireRole } from "./role-check.js";
import {
  escapeTelegramHtml,
  isChatAdministrator,
  sendTelegramMessage,
} from "./telegram-api.js";

/**
 * Linking a church to its Telegram group, and mirroring announcements into it.
 *
 * The handshake is a short code rather than an OAuth-style redirect because
 * Telegram has no such flow for groups: the only way to learn a group's chat id
 * is for the bot to see a message in it. So the pastor generates a code here,
 * posts it in the group, and the webhook recognises it.
 *
 * That makes the code the whole security boundary, and it is a six-character
 * string typed into a room full of people. Three things carry the weight:
 * it expires in minutes, it is single-use, and the person who posts it must be
 * an administrator of that group.
 */

// I/O/0/1 are left out: the code is read off a phone screen and retyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** The roles that may speak for a church's Telegram presence. */
const TELEGRAM_ADMIN_ROLES = ["pastor", "admin", "super_admin"] as const;

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt, not Math.random: this is the only secret in the handshake.
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export interface TelegramLinkStatus {
  isLinked: boolean;
  chatId: string | null;
  chatTitle: string | null;
  verifiedAt: string | null;
}

export async function getTelegramLinkStatus(ctx: AuthContext): Promise<TelegramLinkStatus> {
  requireAuth(ctx);

  const church = await db.query.churches.findFirst({
    where: eq(churches.id, ctx.churchId),
  });
  if (!church) throw Errors.notFound("Church not found");

  // The title is not on the church row — it is only worth showing, so it comes
  // from whichever code did the linking, and its absence is not an error.
  let chatTitle: string | null = null;
  if (church.telegramChatId) {
    const source = await db.query.telegramLinkCodes.findFirst({
      where: and(
        eq(telegramLinkCodes.churchId, ctx.churchId),
        eq(telegramLinkCodes.chatId, church.telegramChatId),
      ),
      orderBy: [desc(telegramLinkCodes.consumedAt)],
    });
    chatTitle = source?.chatTitle ?? null;
  }

  return {
    isLinked: Boolean(church.telegramChatId),
    chatId: church.telegramChatId,
    chatTitle,
    verifiedAt: church.telegramVerifiedAt ? church.telegramVerifiedAt.toISOString() : null,
  };
}

export interface IssuedLinkCode {
  code: string;
  expiresAt: string;
}

export async function createTelegramLinkCode(ctx: AuthContext): Promise<IssuedLinkCode> {
  requireAuth(ctx);
  requireRole(ctx, [...TELEGRAM_ADMIN_ROLES]);

  if (!telegramEnabled) {
    throw Errors.unavailable(
      "TELEGRAM_DISABLED",
      "Telegram is not configured on this server yet.",
    );
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(telegramLinkCodes)
    .where(and(
      eq(telegramLinkCodes.churchId, ctx.churchId),
      gt(telegramLinkCodes.createdAt, since),
    ));

  if ((recent?.count ?? 0) >= config.telegramCodesPerHour) {
    throw Errors.rateLimited(
      `Too many link codes. Try again in an hour (limit ${config.telegramCodesPerHour} per hour).`,
    );
  }

  // Any code still outstanding for this church is retired first. Two live codes
  // for one church means a code the pastor has already given up on still works.
  await db
    .update(telegramLinkCodes)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(telegramLinkCodes.churchId, ctx.churchId),
      isNull(telegramLinkCodes.consumedAt),
    ));

  const expiresAt = new Date(Date.now() + config.telegramCodeTtlMinutes * 60 * 1000);

  // `code` is unique, so a collision is a constraint violation rather than a
  // silent overwrite. Retry a few times before giving up.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      await db.insert(telegramLinkCodes).values({
        churchId: ctx.churchId,
        createdBy: ctx.userId,
        code,
        expiresAt,
      });
      return { code, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      const isUnique =
        typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
      if (!isUnique) throw err;
    }
  }

  throw Errors.internal("Could not allocate a Telegram link code");
}

export async function unlinkTelegramGroup(ctx: AuthContext): Promise<void> {
  requireAuth(ctx);
  requireRole(ctx, [...TELEGRAM_ADMIN_ROLES]);

  await db
    .update(churches)
    .set({ telegramChatId: null, telegramVerifiedAt: null })
    .where(eq(churches.id, ctx.churchId));

  // Outstanding codes go with it, or an old code could re-link the group after
  // someone deliberately disconnected it.
  await db
    .update(telegramLinkCodes)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(telegramLinkCodes.churchId, ctx.churchId),
      isNull(telegramLinkCodes.consumedAt),
    ));

  logger.info({ churchId: ctx.churchId, event: "telegram.unlink" }, "Telegram group unlinked");
}

// ---------------------------------------------------------------------------
// Redemption — called from the webhook, never from a user request
// ---------------------------------------------------------------------------

export type RedeemOutcome =
  | { status: "linked"; churchNameAm: string; churchNameEn: string }
  | { status: "unknown_code" }
  | { status: "expired" }
  | { status: "used" }
  | { status: "not_a_group" }
  | { status: "not_admin" }
  | { status: "chat_taken" };

export interface RedeemInput {
  code: string;
  chatId: string;
  chatType: string;
  chatTitle: string | null;
  fromTelegramId: string | null;
}

/**
 * Turns a code posted in a group into a link.
 *
 * Every refusal is a distinct status because the bot answers in the group and a
 * pastor staring at a silent chat cannot tell "expired" from "wrong code" —
 * and those have different fixes.
 */
export async function redeemTelegramLinkCode(input: RedeemInput): Promise<RedeemOutcome> {
  const code = input.code.trim().toUpperCase();

  // A channel has no membership list to check, and a private chat is not a
  // congregation. Only real groups can be linked.
  if (input.chatType !== "group" && input.chatType !== "supergroup") {
    return { status: "not_a_group" };
  }

  const row = await db.query.telegramLinkCodes.findFirst({
    where: eq(telegramLinkCodes.code, code),
  });
  if (!row) return { status: "unknown_code" };
  if (row.consumedAt) return { status: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  // Holding the code is not enough — it was just posted in a room where anyone
  // could copy it. The account redeeming it has to run this group.
  if (!input.fromTelegramId) return { status: "not_admin" };
  if (!(await isChatAdministrator(input.chatId, input.fromTelegramId))) {
    return { status: "not_admin" };
  }

  const church = await db.query.churches.findFirst({ where: eq(churches.id, row.churchId) });
  if (!church) return { status: "unknown_code" };

  // One group, one church — enforced by a unique index, checked here so the
  // bot can say which situation it is instead of surfacing a constraint error.
  const holder = await db.query.churches.findFirst({
    where: eq(churches.telegramChatId, input.chatId),
  });
  if (holder && holder.id !== row.churchId) return { status: "chat_taken" };

  let won = false;
  try {
    await db.transaction(async (tx) => {
      // Conditional on still being unconsumed, so two people pasting the code at
      // the same moment cannot both win.
      const consumed = await tx
        .update(telegramLinkCodes)
        .set({
          consumedAt: new Date(),
          chatId: input.chatId,
          chatTitle: input.chatTitle,
          redeemedByTelegramId: input.fromTelegramId,
        })
        .where(and(
          eq(telegramLinkCodes.id, row.id),
          isNull(telegramLinkCodes.consumedAt),
        ))
        .returning();

      // Someone else redeemed it between the read above and here. They are
      // doing the linking and posting the confirmation; this request must not
      // post a second one.
      if (consumed.length === 0) return;

      await tx
        .update(churches)
        .set({ telegramChatId: input.chatId, telegramVerifiedAt: new Date() })
        .where(eq(churches.id, row.churchId));

      won = true;
    });
  } catch (err) {
    // The partial unique index on churches(telegram_chat_id) is the real
    // arbiter of "one group, one church" — the check above can lose a race
    // against another church linking this same chat. Report it as what it is
    // rather than letting a constraint error become a 500 and a retry loop.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      return { status: "chat_taken" };
    }
    throw err;
  }

  if (!won) return { status: "used" };

  logger.info(
    { churchId: row.churchId, chatId: input.chatId, event: "telegram.link" },
    "Telegram group linked to church",
  );

  return { status: "linked", churchNameAm: church.nameAm, churchNameEn: church.nameEn };
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export function renderAnnouncement(title: string, body: string): string {
  const safeTitle = escapeTelegramHtml(title.trim());
  const safeBody = escapeTelegramHtml(body.trim());
  return safeTitle ? `<b>${safeTitle}</b>\n\n${safeBody}` : safeBody;
}

export type PostOutcome =
  | { success: true }
  | { success: false; error: "not_linked" | "disabled" | "send_failed"; detail?: string };

/**
 * Mirrors one announcement into the church's group.
 *
 * Returns an outcome instead of throwing on delivery failure. The announcement
 * itself is already published in the app at this point, and a Telegram group
 * that is muted, deleted, or has kicked the bot must not read as "your
 * announcement failed" — the app offers a retry instead.
 */
export async function postAnnouncementToTelegram(
  ctx: AuthContext,
  announcementId: string,
): Promise<PostOutcome> {
  requireAuth(ctx);
  requireRole(ctx, [...TELEGRAM_ADMIN_ROLES]);

  const announcement = await db.query.announcements.findFirst({
    where: and(
      eq(announcements.id, announcementId),
      // Church-scoped: a pastor cannot push another congregation's post.
      eq(announcements.churchId, ctx.churchId),
    ),
  });
  if (!announcement) throw Errors.notFound("Announcement not found");

  if (!telegramEnabled) return { success: false, error: "disabled" };

  const church = await db.query.churches.findFirst({ where: eq(churches.id, ctx.churchId) });
  if (!church?.telegramChatId) return { success: false, error: "not_linked" };

  const title = announcement.titleAm || announcement.titleEn;
  const result = await sendTelegramMessage(
    church.telegramChatId,
    renderAnnouncement(title, announcement.body),
  );

  if (!result.ok) {
    // 403 means the bot was removed from the group or blocked. The link is
    // dead, and leaving it in place would make every future post fail the same
    // way with no explanation, so drop it and let the pastor re-link.
    if (result.errorCode === 403) {
      await db
        .update(churches)
        .set({ telegramChatId: null, telegramVerifiedAt: null })
        .where(eq(churches.id, ctx.churchId));
      logger.warn(
        { churchId: ctx.churchId, event: "telegram.link_dropped" },
        "Telegram rejected the bot for this chat — link cleared",
      );
      return { success: false, error: "not_linked" };
    }
    return { success: false, error: "send_failed", detail: result.error };
  }

  await db
    .update(announcements)
    .set({ postedToTelegram: true })
    .where(eq(announcements.id, announcementId));

  return { success: true };
}

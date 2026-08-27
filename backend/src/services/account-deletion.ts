import { and, eq, isNull, desc } from "drizzle-orm";
import { verify } from "@node-rs/argon2";

import { db } from "../db/index.js";
import {
  churches,
  profiles,
  replies,
  telegramLinkCodes,
  users,
} from "../db/schema.js";
import { logger } from "../middleware/logger.js";
import { Errors } from "../utils/errors.js";
import type { AuthContext } from "../types/index.js";
import { requireAuth } from "./role-check.js";
import { removeChatMember } from "./telegram-api.js";
import { markRevokedLocally, revokeUserTokens } from "./revocation.js";

/**
 * Deleting your own Birhan account.
 *
 * Two things pull against each other here, and the resolution is deliberate.
 * The person must genuinely be gone. The church's threads must still make
 * sense afterwards. So the profiles row survives — announcements and replies
 * point at it, and a pastor deleting their account must not silently take a
 * year of announcements with them — and everything identifying is stripped out
 * of it. What is left is a tombstone: it holds an id and a deletion date.
 *
 * Ordering matters and does not match the obvious reading of "do it all in one
 * transaction". Telegram is a network call to a third party; holding a database
 * transaction open across it would hold locks for as long as Telegram feels
 * like taking, and rolling back afterwards would mean ejecting someone from
 * their church's group and then leaving their account intact. So the database
 * work commits first, in one transaction, and the Telegram removal follows as
 * best-effort cleanup. The user asked to be deleted; that is the part that has
 * to succeed.
 */

/**
 * What replies by a deleted author carry instead of a name.
 *
 * `replies.authorName` is denormalised text rendered straight into the thread,
 * so it cannot be left as it was. A sentinel rather than a translated string
 * because the backend does not know which language the reader will be using —
 * the app maps this to its own i18n. Changing it means changing
 * src/lib/account.ts too.
 */
export const DELETED_AUTHOR_SENTINEL = "__deleted__";

export interface TelegramRemoval {
  /** The group's title if Birhan ever recorded one, otherwise null. */
  chatTitle: string | null;
  removed: boolean;
  /** Why not, when not. Never contains anything about another person. */
  reason?: "not_admin" | "disabled" | "failed";
}

export interface DeletionResult {
  deleted: true;
  telegram: TelegramRemoval[];
}

/**
 * Removes the person from the church groups Birhan actually administers.
 *
 * The scope limit is real and worth stating rather than hiding: the bot can
 * only eject someone from a chat where it is an administrator, which in
 * practice means groups a pastor linked to this church through Birhan. It
 * cannot touch a group it does not administer, a channel, or anything
 * unrelated to Birhan — and it should not be able to.
 */
async function removeFromChurchGroups(
  churchId: string,
  telegramUserId: string,
): Promise<TelegramRemoval[]> {
  const church = await db.query.churches.findFirst({ where: eq(churches.id, churchId) });
  if (!church?.telegramChatId) return [];

  // Only worth showing; its absence is not an error.
  const source = await db.query.telegramLinkCodes.findFirst({
    where: and(
      eq(telegramLinkCodes.churchId, churchId),
      eq(telegramLinkCodes.chatId, church.telegramChatId),
    ),
    orderBy: [desc(telegramLinkCodes.consumedAt)],
  });
  const chatTitle = source?.chatTitle ?? null;

  const outcome = await removeChatMember(church.telegramChatId, telegramUserId);

  if (!outcome.ok) {
    logger.warn(
      { churchId, event: "account.telegram_removal_failed", reason: outcome.reason },
      "Could not remove a deleted account from the church group",
    );
    return [{ chatTitle, removed: false, reason: outcome.reason }];
  }

  return [{ chatTitle, removed: true }];
}

/**
 * Deletes the caller's own account.
 *
 * Only ever the caller's own. A super_admin removing somebody else's account is
 * a different thing with a different authorisation story — a different actor, a
 * different audit trail, and no password of theirs to re-enter — and it is not
 * this function. There is deliberately no userId parameter to pass.
 */
export async function deleteOwnAccount(
  ctx: AuthContext,
  password: string,
): Promise<DeletionResult> {
  requireAuth(ctx);

  const user = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!user || !user.passwordHash) throw Errors.notFound("Account not found");

  // Deletion is irreversible, so it takes more than a valid session. A stolen
  // unlocked phone should not be enough to erase someone's account.
  const valid = await verify(user.passwordHash, password);
  if (!valid) throw Errors.unauthenticated();

  const profile = await db.query.profiles.findFirst({
    where: and(eq(profiles.id, ctx.userId), isNull(profiles.deletedAt)),
  });
  if (!profile) throw Errors.notFound("Account not found");

  // Read before the transaction clears it — this is the only place the Telegram
  // identity is still available, and the removal happens after the commit.
  const telegramUserId = profile.telegramUserId;
  const churchId = profile.churchId;

  await db.transaction(async (tx) => {
    // The tombstone. Keeps the id, because announcements and replies reference
    // it; loses everything that says who this was.
    await tx
      .update(profiles)
      .set({
        displayName: DELETED_AUTHOR_SENTINEL,
        phone: null,
        branchId: null,
        churchRole: null,
        telegramUserId: null,
        telegramUsername: null,
        telegramVerifiedAt: null,
        pastorDocPath: null,
        pastorBranchName: null,
        pastorRejectedReason: null,
        pastorStatus: null,
        role: "member",
        deletedAt: new Date(),
      })
      .where(eq(profiles.id, ctx.userId));

    // Their replies stay so the threads still read, with the name taken off.
    await tx
      .update(replies)
      .set({ authorName: DELETED_AUTHOR_SENTINEL })
      .where(eq(replies.authorId, ctx.userId));

    // Credentials go. Nulling the address rather than keeping it also frees it
    // for reuse — someone who deletes an account and later changes their mind
    // should be able to sign up again with their own email.
    await tx
      .update(users)
      .set({ email: null, phone: null, passwordHash: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));

    // The JWT is stateless and this one is still in date. Without this, the
    // token in the app's keychain keeps authenticating for up to 30 days.
    await revokeUserTokens(ctx.userId, tx as unknown as typeof db);
  });

  // Only now, after the commit. Applying it inside the transaction would lock
  // out an account whose deletion had in fact rolled back.
  markRevokedLocally(ctx.userId);

  logger.info({ userId: ctx.userId, event: "account.deleted" }, "Account deleted");

  // Committed. Telegram is cleanup from here — a failure is reported, never
  // raised, because the deletion the person asked for has already happened.
  let telegram: TelegramRemoval[] = [];
  if (telegramUserId) {
    try {
      telegram = await removeFromChurchGroups(churchId, telegramUserId);
    } catch (err) {
      logger.warn(
        { err, event: "account.telegram_removal_error" },
        "Telegram removal threw after a completed deletion",
      );
      telegram = [{ chatTitle: null, removed: false, reason: "failed" }];
    }
  }

  return { deleted: true, telegram };
}

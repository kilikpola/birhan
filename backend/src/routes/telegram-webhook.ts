import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";

import { config, telegramEnabled } from "../config/index.js";
import { logger } from "../middleware/logger.js";
import { redeemTelegramLinkCode } from "../services/telegram.js";
import { sendTelegramMessage, escapeTelegramHtml } from "../services/telegram-api.js";

/**
 * Where Telegram delivers updates.
 *
 * Mounted on its own path prefix rather than under /api/v1/telegram, because
 * that prefix is behind authMiddleware and this endpoint is necessarily public
 * — Telegram has no bearer token to present. What it does present is the secret
 * set in setWebhook, returned in X-Telegram-Bot-Api-Secret-Token, and that
 * header is the whole gate.
 *
 * Every path answers 200. Telegram retries anything else, and a retry loop over
 * an update we have already refused is just noise.
 */
const router = new Hono();

function secretMatches(presented: string | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(config.telegramWebhookSecret, "utf8");
  // timingSafeEqual throws on a length mismatch, and the length of a secret is
  // not worth leaking either, so compare only equal-length buffers.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string; title?: string };
    from?: { id?: number | string; is_bot?: boolean };
  };
}

/**
 * Pulls a link code out of whatever the pastor actually typed.
 *
 * Accepts `/link ABC123`, `/link@BirhanBot ABC123`, and a bare `ABC123`,
 * because people will type all three and being strict here means a silent bot.
 *
 * `explicit` records which form it was, and it decides whether the bot is
 * allowed to answer. Six uppercase alphanumerics is also just… a word — SUNDAY,
 * AMEN12, PSALM1. If group privacy is ever disabled (the docs advise against
 * it, but the option is there) the bot sees every message in every linked
 * group, and answering every six-letter word with "that code was not
 * recognised" would make it a nuisance in a church's chat.
 */
interface ExtractedCode {
  code: string;
  /** True when the message actually used the `/link` command form. */
  explicit: boolean;
}

function extractCode(text: string): ExtractedCode | null {
  const trimmed = text.trim();
  const withoutCommand = trimmed.replace(/^\/link(@\w+)?\s*/i, "");
  const explicit = withoutCommand !== trimmed;
  const candidate = withoutCommand.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(candidate) ? { code: candidate, explicit } : null;
}

const REPLIES: Record<string, { am: string; en: string }> = {
  linked: {
    am: "ተገናኝቷል። የ%1 ማስታወቂያዎች ከዚህ በኋላ ወደዚህ ቡድን ይላካሉ።",
    en: "Linked. Announcements from %1 will now be posted in this group.",
  },
  unknown_code: {
    am: "ይህ ኮድ አልታወቀም። እባክዎ በመተግበሪያው ውስጥ አዲስ ኮድ ይፍጠሩ።",
    en: "That code was not recognised. Generate a new one in the Birhan app.",
  },
  expired: {
    am: "የኮዱ ጊዜ አልፎበታል። በመተግበሪያው ውስጥ አዲስ ኮድ ይፍጠሩ።",
    en: "That code has expired. Generate a new one in the Birhan app.",
  },
  used: {
    am: "ይህ ኮድ ቀደም ሲል ጥቅም ላይ ውሏል። አዲስ ኮድ ይፍጠሩ።",
    en: "That code has already been used. Generate a new one.",
  },
  not_a_group: {
    am: "ይህ ትእዛዝ በቡድን ውስጥ ብቻ ይሠራል።",
    en: "This only works inside a group chat.",
  },
  not_admin: {
    am: "ኮዱን የሚልከው ሰው የዚህ ቡድን አስተዳዳሪ መሆን አለበት።",
    en: "The person sending the code must be an administrator of this group.",
  },
  chat_taken: {
    am: "ይህ ቡድን ቀደም ሲል ከሌላ ቤተ ክርስቲያን ጋር ተገናኝቷል።",
    en: "This group is already linked to a different church.",
  },
};

router.post("/", async (c) => {
  if (!telegramEnabled) return c.json({ ok: true });

  if (!secretMatches(c.req.header("x-telegram-bot-api-secret-token"))) {
    // Deliberately not 401: an attacker probing the URL learns nothing from a
    // 200, and Telegram itself never sees this branch.
    logger.warn({ event: "telegram.webhook", result: "bad_secret" }, "Rejected Telegram update");
    return c.json({ ok: true });
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json();
  } catch {
    return c.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text;
  const chat = message?.chat;
  if (!text || !chat?.id || !chat.type) return c.json({ ok: true });

  // Bots posting codes at each other is not a flow worth supporting.
  if (message?.from?.is_bot) return c.json({ ok: true });

  const extracted = extractCode(text);
  if (!extracted) return c.json({ ok: true });

  const chatId = String(chat.id);
  const outcome = await redeemTelegramLinkCode({
    code: extracted.code,
    chatId,
    chatType: chat.type,
    chatTitle: chat.title ?? null,
    fromTelegramId: message?.from?.id != null ? String(message.from.id) : null,
  });

  // A bare token that turned out not to be a code was, on the balance of
  // probability, an ordinary message. Do the lookup — it costs one indexed read
  // and a real bare code still links — but say nothing unless it worked.
  if (!extracted.explicit && outcome.status !== "linked") return c.json({ ok: true });

  const copy = REPLIES[outcome.status] ?? REPLIES.unknown_code;
  const name = outcome.status === "linked" ? outcome.churchNameAm || outcome.churchNameEn : "";
  // Function replacement, not a string: a church name containing `$&` or `$'`
  // would otherwise be re-expanded by String.replace into something other than
  // the name.
  const fill = (template: string) => template.replace("%1", () => escapeTelegramHtml(name));
  const am = fill(copy.am);
  const en = fill(copy.en);

  // Bilingual, same as everything else the project says out loud.
  await sendTelegramMessage(chatId, `${am}\n\n${en}`);

  return c.json({ ok: true });
});

export default router;

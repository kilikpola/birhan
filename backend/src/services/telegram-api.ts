import { config, telegramEnabled } from "../config/index.js";
import { logger } from "../middleware/logger.js";

/**
 * The wire to Telegram's Bot API.
 *
 * Deliberately the same shape as mail-transport.ts: a thin transport that never
 * throws, returns a discriminated result, and knows nothing about churches or
 * announcements. Telegram is a third party that can be slow, rate-limit us, or
 * be blocked by the network — none of which may be allowed to turn into a
 * failed request for the pastor who was only publishing an announcement.
 */

const API_ROOT = "https://api.telegram.org";

export interface TelegramResult<T = unknown> {
  ok: boolean;
  result?: T;
  /** Machine-readable label: Telegram's description, or a transport-level word. */
  error?: string;
  /** Telegram's own error code, when it answered at all. */
  errorCode?: number;
}

/**
 * Calls one Bot API method.
 *
 * `disabled` is returned rather than thrown when no token is configured, so a
 * deployment without Telegram behaves like a deployment whose group is simply
 * not linked instead of erroring on every announcement.
 */
export async function callTelegram<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<TelegramResult<T>> {
  if (!telegramEnabled) return { ok: false, error: "disabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.telegramTimeoutMs);

  try {
    const res = await fetch(`${API_ROOT}/bot${config.telegramBotToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // Telegram answers JSON on success and on refusal alike, but a proxy or a
    // captive network can return an HTML page with a 200, so parse defensively.
    let body: { ok?: boolean; result?: T; description?: string; error_code?: number };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, error: "unparseable_response", errorCode: res.status };
    }

    if (!body.ok) {
      return {
        ok: false,
        error: body.description || `http_${res.status}`,
        errorCode: body.error_code ?? res.status,
      };
    }

    return { ok: true, result: body.result };
  } catch (err) {
    const label =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: label };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Escapes for Telegram's HTML parse mode.
 *
 * Announcement bodies are written by pastors in a free-text box, so an
 * unescaped `<` is not hypothetical — and Telegram rejects the whole message
 * when the markup does not parse, which would present as "the announcement
 * posted in the app but never reached the group".
 */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram hard-caps a sendMessage text at 4096 UTF-16 code units. */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Cuts an already-escaped HTML message to Telegram's limit without breaking it.
 *
 * The naive slice is a trap. By the time we get here `&` has become `&amp;`, so
 * a cut can land inside an entity and leave a trailing `&am` — Telegram then
 * rejects the *entire* message with 400 "can't parse entities", and the pastor
 * sees a failed send rather than a shortened post. A cut can equally land
 * between the halves of a surrogate pair and produce a lone code unit.
 *
 * So: cut, then walk back off anything half-finished. Both trailing fragments
 * are bounded and cheap to detect, and dropping a few characters from a message
 * that is already being truncated costs nothing.
 */
export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;

  let cut = text.slice(0, MAX_MESSAGE_LENGTH - 1);

  // A lone high surrogate at the end has lost its pair.
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut = cut.slice(0, -1);

  // A trailing `&`, `&am`, `&#12` … is the start of an entity we cut in half.
  // The longest entity we can emit is `&quot;` (6), so a short bounded look-back
  // is enough; only strip when there is no `;` closing it.
  cut = cut.replace(/&[a-zA-Z#0-9]{0,8}$/, "");

  return `${cut}…`;
}

export async function sendTelegramMessage(
  chatId: string,
  html: string,
): Promise<TelegramResult<{ message_id: number }>> {
  const result = await callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: truncateForTelegram(html),
    parse_mode: "HTML",
    // A church announcement is the content, not a link preview of whatever URL
    // happened to be in it.
    link_preview_options: { is_disabled: true },
  });

  if (!result.ok) {
    logger.warn({ chatId, error: result.error, errorCode: result.errorCode, event: "telegram.send" },
      "Telegram sendMessage failed");
  }
  return result;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
}

/**
 * Whether a Telegram account administers a chat.
 *
 * Used to gate redemption: possessing the code is not enough, because the code
 * is typed into a chat where everyone present can read it. Requiring the person
 * who posts it to be an admin of that group means a bystander who copies it out
 * cannot attach some other group to the church.
 */
export async function isChatAdministrator(chatId: string, userId: string): Promise<boolean> {
  const res = await callTelegram<TelegramChatMember>("getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
  if (!res.ok || !res.result) return false;
  return res.result.status === "creator" || res.result.status === "administrator";
}

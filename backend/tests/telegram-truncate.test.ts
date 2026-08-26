import { describe, it, expect } from "vitest";

/**
 * Truncation happens inside `sendTelegramMessage`, so the route-level suite —
 * which mocks the transport — cannot see it. This exercises the real function.
 *
 * What it is really guarding: the cut happens *after* HTML escaping, so a naive
 * slice can leave a half-written `&amp;`. Telegram does not truncate or ignore
 * that; it rejects the entire sendMessage with 400 "can't parse entities", and
 * the pastor sees a failed post rather than a shortened one.
 */
const { truncateForTelegram, escapeTelegramHtml } = await import("../src/services/telegram-api.js");

const LIMIT = 4096;

describe("truncateForTelegram", () => {
  it("leaves a message that already fits completely alone", () => {
    const text = "የሰንበት ጥሪ";
    expect(truncateForTelegram(text)).toBe(text);
  });

  it("leaves a message of exactly the limit alone", () => {
    const text = "a".repeat(LIMIT);
    expect(truncateForTelegram(text)).toBe(text);
  });

  it("never returns more than the limit", () => {
    expect(truncateForTelegram("a".repeat(10000)).length).toBeLessThanOrEqual(LIMIT);
  });

  it("does not leave a half-written HTML entity at the end", () => {
    // Every "&" is "&amp;" once escaped, so the boundary lands mid-entity.
    const escaped = escapeTelegramHtml("&".repeat(5000));
    const out = truncateForTelegram(escaped);

    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out.endsWith("…")).toBe(true);
    // Nothing after the last ";" may look like the start of an entity.
    expect(out.replace(/…$/, "")).not.toMatch(/&[a-zA-Z#0-9]*$/);
  });

  it("handles the boundary landing inside every offset of an entity", () => {
    // Walk the cut across a whole entity rather than trusting one lucky length.
    for (let pad = 0; pad < 8; pad += 1) {
      const escaped = "x".repeat(pad) + escapeTelegramHtml("&".repeat(5000));
      const out = truncateForTelegram(escaped);
      expect(out.replace(/…$/, "")).not.toMatch(/&[a-zA-Z#0-9]*$/);
    }
  });

  it("does not split a surrogate pair and leave a lone code unit", () => {
    // 🙏 is two UTF-16 code units; an odd-length prefix would cut through it.
    const out = truncateForTelegram("a" + "🙏".repeat(4000));
    const last = out.replace(/…$/, "");
    const code = last.charCodeAt(last.length - 1);
    expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
  });
});

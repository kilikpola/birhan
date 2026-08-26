import { Hono } from "hono";

import {
  createTelegramLinkCode,
  getTelegramLinkStatus,
  postAnnouncementToTelegram,
  unlinkTelegramGroup,
} from "../services/telegram.js";

/**
 * The church-facing half of Telegram. Everything here runs behind
 * authMiddleware and acts on the caller's own church — no church id is ever
 * accepted from the request body, because the JWT already says which one it is.
 */
const router = new Hono();

router.get("/status", async (c) => {
  const ctx = c.get("authContext");
  return c.json(await getTelegramLinkStatus(ctx));
});

router.post("/link-code", async (c) => {
  const ctx = c.get("authContext");
  return c.json(await createTelegramLinkCode(ctx), 201);
});

router.delete("/link", async (c) => {
  const ctx = c.get("authContext");
  await unlinkTelegramGroup(ctx);
  return c.body(null, 204);
});

/**
 * Mirrors an already-published announcement into the group.
 *
 * Always 200, with the outcome in the body. A group the bot was kicked out of
 * is not a failure of this request — the announcement is published either way,
 * and the app shows a retry rather than an error.
 */
router.post("/announcements/:id", async (c) => {
  const ctx = c.get("authContext");
  const result = await postAnnouncementToTelegram(ctx, c.req.param("id"));
  return c.json(result);
});

export default router;

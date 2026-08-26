import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createReply, deleteReply } from "../services/replies.js";
import { requireVerifiedEmail } from "../middleware/require-verified-email.js";

const router = new Hono();

const createSchema = z.object({
  text: z.string().min(1).max(500),
});

router.post("/:id/replies", requireVerifiedEmail, zValidator("json", createSchema), async (c) => {
  const ctx = c.get("authContext");
  const announcementId = c.req.param("id");
  const body = c.req.valid("json");
  const reply = await createReply(ctx, announcementId, body.text);
  return c.json(reply, 201);
});

router.delete("/:id", async (c) => {
  const ctx = c.get("authContext");
  const replyId = c.req.param("id");
  await deleteReply(ctx, replyId);
  return c.body(null, 204);
});

export default router;

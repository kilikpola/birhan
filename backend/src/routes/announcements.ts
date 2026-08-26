import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  setAnnouncementLock,
} from "../services/announcements.js";
import { requireVerifiedEmail } from "../middleware/require-verified-email.js";

const router = new Hono();

router.get("/", async (c) => {
  const ctx = c.get("authContext");
  const cursor = c.req.query("cursor");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const announcements = await listAnnouncements(ctx, cursor, limit);
  return c.json({ announcements });
});

router.get("/:id", async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  const replyLimit = parseInt(c.req.query("replyLimit") || "200", 10);
  const announcement = await getAnnouncement(ctx, id, Number.isNaN(replyLimit) ? 200 : replyLimit);
  return c.json(announcement);
});

const createSchema = z.object({
  titleAm: z.string().min(1),
  titleEn: z.string().min(1),
  body: z.string().min(1),
});

router.post("/", requireVerifiedEmail, zValidator("json", createSchema), async (c) => {
  const ctx = c.get("authContext");
  const body = c.req.valid("json");
  const announcement = await createAnnouncement(ctx, body);
  return c.json(announcement, 201);
});

const updateSchema = z.object({
  titleAm: z.string().min(1).optional(),
  titleEn: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

router.patch("/:id", requireVerifiedEmail, zValidator("json", updateSchema), async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const announcement = await updateAnnouncement(ctx, id, body);
  return c.json(announcement);
});

router.delete("/:id", async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  await deleteAnnouncement(ctx, id);
  return c.body(null, 204);
});

const lockSchema = z.object({ locked: z.boolean() });

router.post("/:id/lock", zValidator("json", lockSchema), async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const announcement = await setAnnouncementLock(ctx, id, body.locked);
  return c.json(announcement);
});

export default router;

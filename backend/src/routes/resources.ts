import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listResources,
  getResourceUploadUrl,
  commitResource,
  getResourceDownloadUrl,
  deleteResource,
} from "../services/resources.js";
import { requireVerifiedEmail } from "../middleware/require-verified-email.js";

const router = new Hono();

router.get("/", async (c) => {
  const ctx = c.get("authContext");
  const cursor = c.req.query("cursor");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const resources = await listResources(ctx, cursor, limit);
  return c.json({ resources });
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
});

router.post("/upload-url", requireVerifiedEmail, zValidator("json", uploadUrlSchema), async (c) => {
  const ctx = c.get("authContext");
  const body = c.req.valid("json");
  const result = await getResourceUploadUrl(ctx, body);
  return c.json(result);
});

const commitSchema = z.object({
  resourceId: z.string().uuid(),
  key: z.string().min(1),
  titleAm: z.string().min(1),
  titleEn: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["sermon_notes", "study_guide", "calendar", "announcement_doc", "other"]),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  rightsConfirmed: z.boolean(),
});

router.post("/", requireVerifiedEmail, zValidator("json", commitSchema), async (c) => {
  const ctx = c.get("authContext");
  const body = c.req.valid("json");
  const resource = await commitResource(ctx, body);
  return c.json(resource, 201);
});

router.get("/:id/download-url", async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  const result = await getResourceDownloadUrl(ctx, id);
  return c.json(result);
});

router.delete("/:id", async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  await deleteResource(ctx, id);
  return c.body(null, 204);
});

export default router;

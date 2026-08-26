import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getPastorDocUploadUrl,
  submitPastorVerification,
  getPastorVerificationStatus,
} from "../services/pastor-verification.js";
import { requireVerifiedEmail } from "../middleware/require-verified-email.js";

const router = new Hono();

router.post("/upload-url", requireVerifiedEmail, async (c) => {
  const ctx = c.get("authContext");
  const body = await c.req.json();
  const result = await getPastorDocUploadUrl(ctx, body.filename, body.mimeType);
  return c.json(result);
});

const submitSchema = z.object({
  docPath: z.string().min(1),
  /** Branch the applicant leads; created for them when a super_admin approves. */
  branchName: z.string().min(1).max(200).optional(),
});

router.post("/", requireVerifiedEmail, zValidator("json", submitSchema), async (c) => {
  const ctx = c.get("authContext");
  const body = c.req.valid("json");
  const result = await submitPastorVerification(ctx, body.docPath, body.branchName);
  return c.json(result);
});

router.get("/status", async (c) => {
  const ctx = c.get("authContext");
  const status = await getPastorVerificationStatus(ctx);
  return c.json(status);
});

export default router;

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  listPastorApplications,
  getPastorApplicationDocumentUrl,
  approvePastorApplication,
  rejectPastorApplication,
} from "../services/pastor-verification.js";
import {
  getPlatformStats,
  listAdminChurches,
  listChurchRequests,
  approveChurchRequest,
  rejectChurchRequest,
} from "../services/admin.js";

const router = new Hono();

/**
 * `?status=` is a bare query string, so it is whatever the caller typed.
 *
 * Casting it straight to the union — which is what both list routes used to do
 * — hands an arbitrary string to Postgres as an enum value, and `?status=bogus`
 * (or `?status=`, which is an empty string rather than undefined, so the
 * service's default never fires) comes back as
 * `invalid input value for enum church_request_status`. The error handler has
 * no reason to treat that as anything but unexpected, so it surfaces as a 500.
 *
 * Anything unrecognised becomes `undefined`, which is exactly the "no filter"
 * the services already default to.
 */
const LIST_STATUSES = ["pending", "approved", "rejected"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

function parseStatus(raw: string | undefined): ListStatus | undefined {
  return LIST_STATUSES.includes(raw as ListStatus) ? (raw as ListStatus) : undefined;
}

const rejectSchema = z.object({ reason: z.string().min(1) });

router.get("/stats", async (c) => {
  const ctx = c.get("authContext");
  const stats = await getPlatformStats(ctx);
  return c.json(stats);
});

router.get("/churches", async (c) => {
  const ctx = c.get("authContext");
  const churches = await listAdminChurches(ctx);
  return c.json({ churches });
});

router.get("/church-requests", async (c) => {
  const ctx = c.get("authContext");
  const status = parseStatus(c.req.query("status"));
  const requests = await listChurchRequests(ctx, status);
  return c.json({ requests });
});

router.post("/church-requests/:id/approve", async (c) => {
  const ctx = c.get("authContext");
  const requestId = c.req.param("id");
  const result = await approveChurchRequest(ctx, requestId);
  return c.json(result);
});

router.post("/church-requests/:id/reject", zValidator("json", rejectSchema), async (c) => {
  const ctx = c.get("authContext");
  const requestId = c.req.param("id");
  const body = c.req.valid("json");
  const result = await rejectChurchRequest(ctx, requestId, body.reason);
  return c.json(result);
});

router.get("/pastor-applications", async (c) => {
  const ctx = c.get("authContext");
  const status = parseStatus(c.req.query("status"));
  const applications = await listPastorApplications(ctx, status);
  return c.json({ applications });
});

router.get("/pastor-applications/:id/document", async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const result = await getPastorApplicationDocumentUrl(ctx, userId);
  return c.json(result);
});

router.post("/pastor-applications/:id/approve", async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const result = await approvePastorApplication(ctx, userId);
  return c.json(result);
});

router.post("/pastor-applications/:id/reject", zValidator("json", rejectSchema), async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const body = c.req.valid("json");
  const result = await rejectPastorApplication(ctx, userId, body.reason);
  return c.json(result);
});

export default router;
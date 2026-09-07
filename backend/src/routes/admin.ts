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
import {
  listChurchPeople,
  listChurchBranches,
  addBranchToChurch,
  deleteBranch,
  makePastor,
  removePastor,
} from "../services/church-admin.js";
import { getBranchHistory } from "../services/branch-change.js";
import { Errors } from "../utils/errors.js";

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

/**
 * A branch choice sent with approve / make-pastor. At most one of the two is
 * meaningful; the service takes `branchId` first and treats `newBranchName` as
 * the create path. Both optional — omitting them keeps the current branch (and,
 * on approve, falls back to the branch the applicant claimed).
 */
const branchChoiceSchema = z.object({
  branchId: z.string().uuid().optional(),
  newBranchName: z.string().trim().min(1).max(200).optional(),
});

const addBranchSchema = z.object({
  nameAm: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  /** Present → this is a child of that mother branch. Absent → a mother branch. */
  parentBranchId: z.string().uuid().optional(),
});

/**
 * Parse the optional branch body from a request that may carry no body at all.
 *
 * The approve / make-pastor buttons POST either an empty body or a small
 * choice. A missing body is fine (empty choice); a present-but-malformed one is
 * a 400, not the 500 a bare ZodError would become on its way out.
 */
async function parseBranchChoice(c: { req: { json: () => Promise<unknown> } }) {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = branchChoiceSchema.safeParse(raw ?? {});
  if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid branch choice");
  return parsed.data;
}

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
  const choice = await parseBranchChoice(c);
  const result = await approvePastorApplication(ctx, userId, choice);
  return c.json(result);
});

router.post("/pastor-applications/:id/reject", zValidator("json", rejectSchema), async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const body = c.req.valid("json");
  const result = await rejectPastorApplication(ctx, userId, body.reason);
  return c.json(result);
});

// --- People & branches within a church (the church drill-in) ---

router.get("/churches/:churchId/people", async (c) => {
  const ctx = c.get("authContext");
  const churchId = c.req.param("churchId");
  const people = await listChurchPeople(ctx, churchId);
  return c.json({ people });
});

router.get("/churches/:churchId/branches", async (c) => {
  const ctx = c.get("authContext");
  const churchId = c.req.param("churchId");
  const branches = await listChurchBranches(ctx, churchId);
  return c.json({ branches });
});

router.post("/churches/:churchId/branches", zValidator("json", addBranchSchema), async (c) => {
  const ctx = c.get("authContext");
  const churchId = c.req.param("churchId");
  const body = c.req.valid("json");
  const branch = await addBranchToChurch(ctx, churchId, body);
  return c.json(branch, 201);
});

router.delete("/churches/:churchId/branches/:branchId", async (c) => {
  const ctx = c.get("authContext");
  const churchId = c.req.param("churchId");
  const branchId = c.req.param("branchId");
  const result = await deleteBranch(ctx, churchId, branchId);
  return c.json(result);
});

router.post("/people/:id/make-pastor", async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const choice = await parseBranchChoice(c);
  const result = await makePastor(ctx, userId, choice);
  return c.json(result);
});

router.post("/people/:id/remove-pastor", async (c) => {
  const ctx = c.get("authContext");
  const userId = c.req.param("id");
  const result = await removePastor(ctx, userId);
  return c.json(result);
});

/** A branch's current members and its ex-members (people who moved away). */
router.get("/branches/:branchId/history", async (c) => {
  const ctx = c.get("authContext");
  const history = await getBranchHistory(ctx, c.req.param("branchId"));
  return c.json(history);
});

export default router;
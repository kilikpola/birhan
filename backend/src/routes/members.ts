import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { listMembers } from "../services/members.js";
import {
  listBranchChangeRequests,
  approveBranchChange,
  rejectBranchChange,
  getBranchHistory,
  getMemberBranchHistory,
} from "../services/branch-change.js";

const router = new Hono();

router.get("/", async (c) => {
  const ctx = c.get("authContext");
  const limit = parseInt(c.req.query("limit") || "200", 10);
  const { members, total } = await listMembers(ctx, Number.isNaN(limit) ? 200 : limit);
  return c.json({ members, total });
});

// --- Branch-change requests (pastor / admin of the church) ---

const STATUSES = ["pending", "approved", "rejected"] as const;
function parseStatus(raw: string | undefined) {
  return STATUSES.includes(raw as (typeof STATUSES)[number]) ? (raw as (typeof STATUSES)[number]) : "pending";
}

router.get("/branch-change-requests", async (c) => {
  const ctx = c.get("authContext");
  const status = parseStatus(c.req.query("status"));
  const requests = await listBranchChangeRequests(ctx, status);
  return c.json({ requests });
});

router.post("/branch-change-requests/:id/approve", async (c) => {
  const ctx = c.get("authContext");
  const result = await approveBranchChange(ctx, c.req.param("id"));
  return c.json(result);
});

router.post(
  "/branch-change-requests/:id/reject",
  zValidator("json", z.object({ reason: z.string().min(1) })),
  async (c) => {
    const ctx = c.get("authContext");
    const body = c.req.valid("json");
    const result = await rejectBranchChange(ctx, c.req.param("id"), body.reason);
    return c.json(result);
  },
);

/** A branch's people, now and before (current members + ex-members). */
router.get("/branches/:branchId/history", async (c) => {
  const ctx = c.get("authContext");
  const history = await getBranchHistory(ctx, c.req.param("branchId"));
  return c.json(history);
});

/** One member's branch history. */
router.get("/:id/branch-history", async (c) => {
  const ctx = c.get("authContext");
  const history = await getMemberBranchHistory(ctx, c.req.param("id"));
  return c.json(history);
});

export default router;

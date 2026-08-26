import { Hono } from "hono";
import { listMembers } from "../services/members.js";

const router = new Hono();

router.get("/", async (c) => {
  const ctx = c.get("authContext");
  const limit = parseInt(c.req.query("limit") || "200", 10);
  const { members, total } = await listMembers(ctx, Number.isNaN(limit) ? 200 : limit);
  return c.json({ members, total });
});

export default router;

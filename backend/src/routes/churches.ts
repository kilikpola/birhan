import { Hono } from "hono";
import { listChurches, listBranches } from "../services/churches.js";

const router = new Hono();

router.get("/", async (c) => {
  const churches = await listChurches();
  return c.json({ churches });
});

router.get("/:id/branches", async (c) => {
  const churchId = c.req.param("id");
  const branches = await listBranches(churchId);
  return c.json({ branches });
});

export default router;

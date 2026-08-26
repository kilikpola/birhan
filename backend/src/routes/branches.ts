import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createBranch, updateBranch, deleteBranch } from "../services/branches.js";

const router = new Hono();

const createSchema = z.object({
  nameAm: z.string().min(1),
  nameEn: z.string().min(1),
});

router.post("/", zValidator("json", createSchema), async (c) => {
  const ctx = c.get("authContext");
  const body = c.req.valid("json");
  const branch = await createBranch(ctx, body);
  return c.json(branch, 201);
});

const updateSchema = z.object({
  nameAm: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
});

router.patch("/:id", zValidator("json", updateSchema), async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const branch = await updateBranch(ctx, id, body);
  return c.json(branch);
});

router.delete("/:id", async (c) => {
  const ctx = c.get("authContext");
  const id = c.req.param("id");
  await deleteBranch(ctx, id);
  return c.body(null, 204);
});

export default router;

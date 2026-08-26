import { Hono } from "hono";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

const router = new Hono();

router.get("/", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", database: "connected" });
  } catch {
    return c.json({ status: "error", database: "disconnected" }, 503);
  }
});

export default router;

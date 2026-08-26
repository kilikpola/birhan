import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { profiles, users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Errors } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";

const router = new Hono();

const patchMeSchema = z.object({
  displayName: z.string().min(1).optional(),
  phone: z.string().optional(),
  language: z.enum(["am", "en"]).optional(),
  branchId: z.string().uuid().optional().nullable(),
  churchRole: z.string().optional().nullable(),
}).strict();

router.get("/", async (c) => {
  const ctx = c.get("authContext");
  if (!ctx) throw Errors.unauthenticated();

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, ctx.userId),
    with: { church: true, branch: true },
  });

  if (!profile) throw Errors.notFound("Profile not found");

  // Verification state lives on the user, not the profile, but the app reads
  // both from here — it is the one call that can correct a token minted before
  // the address was confirmed.
  const user = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
    columns: { email: true, emailVerified: true },
  });

  return c.json({
    ...profile,
    email: user?.email ?? null,
    emailVerified: user?.emailVerified ?? false,
  });
});

router.patch("/", zValidator("json", patchMeSchema), async (c) => {
  const ctx = c.get("authContext");
  if (!ctx) throw Errors.unauthenticated();

  const body = c.req.valid("json");

  const updates: any = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.language !== undefined) updates.language = body.language;
  if (body.branchId !== undefined) updates.branchId = body.branchId;
  if (body.churchRole !== undefined) updates.churchRole = body.churchRole;

  if (body.phone !== undefined) {
    const normalized = normalizePhone(body.phone);
    if (!normalized) throw Errors.validation("Invalid phone number");

    const existing = await db.query.profiles.findFirst({
      where: eq(profiles.phone, normalized),
    });
    if (existing && existing.id !== ctx.userId) {
      throw Errors.conflict("Phone number already in use");
    }
    updates.phone = normalized;
  }

  const [updated] = await db.update(profiles)
    .set(updates)
    .where(eq(profiles.id, ctx.userId))
    .returning();

  return c.json(updated);
});

export default router;

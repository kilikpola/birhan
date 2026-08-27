import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { profiles, users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Errors } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";
import { deleteOwnAccount } from "../services/account-deletion.js";

const router = new Hono();

/**
 * Deletion takes the password again, not just a valid session.
 *
 * It is irreversible, and a session alone is whatever is sitting unlocked in
 * someone's hand. Re-entering the password is the difference between a deletion
 * and a mis-tap.
 */
const deleteMeSchema = z.object({
  password: z.string().min(1),
});

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

/**
 * Deletes the caller's own account. Irreversible.
 *
 * DELETE rather than POST because that is what it is, and the password travels
 * in the body rather than a query string so it stays out of access logs.
 *
 * Answers 200 with a per-group report even when Telegram removal failed: the
 * account is gone either way, and the app needs to be able to say which groups
 * it could not update rather than implying a reach the bot does not have.
 */
router.delete("/", zValidator("json", deleteMeSchema), async (c) => {
  const ctx = c.get("authContext");
  if (!ctx) throw Errors.unauthenticated();

  const { password } = c.req.valid("json");
  const result = await deleteOwnAccount(ctx, password);
  return c.json(result);
});

export default router;

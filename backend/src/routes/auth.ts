import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { users, profiles, churches, branches } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { resolveUserByIdentifier } from "../auth/index.js";
import { config } from "../config/index.js";
import { normalizePhone } from "../utils/phone.js";
import { Errors } from "../utils/errors.js";
import { SignJWT, jwtVerify } from "jose";
import { hash, verify } from "@node-rs/argon2";
import { optionalAuthMiddleware } from "../middleware/auth.js";
import { logger } from "../middleware/logger.js";
import { sendVerificationEmail } from "../services/email.js";
import {
  issueVerificationToken,
  resendVerification,
  verificationLink,
  verifyEmailToken,
} from "../services/email-verification.js";

const router = new Hono();

/**
 * The app speaks camelCase; the endpoint is specified in snake_case. Accept both
 * rather than making either side translate, and normalise straight after.
 */
const signupSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    password: z.string().min(8),

    displayName: z.string().min(1).max(120).optional(),
    display_name: z.string().min(1).max(120).optional(),

    churchId: z.string().uuid().optional(),
    church_id: z.string().uuid().optional(),

    branchId: z.string().uuid().nullish(),
    branch_id: z.string().uuid().nullish(),

    churchRole: z.string().max(120).nullish(),
    church_role: z.string().max(120).nullish(),

    language: z.enum(["am", "en"]).default("am"),
  })
  // Unknown keys are stripped, not rejected — which is exactly what has to
  // happen to `role`, `pastor_status`, `pastorStatus` and anything else that
  // grants privilege. A body that carries them still creates a plain member;
  // the fields are never read, so there is nothing to honour. Rejecting instead
  // would turn a harmless stray field into a failed signup.
  .refine((d) => d.email || d.phone, {
    message: "At least one of email or phone is required",
  })
  .refine((d) => d.displayName || d.display_name, { message: "display_name is required" })
  .refine((d) => d.churchId || d.church_id, { message: "church_id is required" });

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const resendSchema = z.object({
  email: z.string().email().optional(),
});

interface TokenClaims {
  userId: string;
  churchId: string;
  role: string;
  branchId: string | null;
  email: string | null;
  emailVerified: boolean;
}

async function createToken(claims: TokenClaims) {
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({
    user_id: claims.userId,
    church_id: claims.churchId,
    role: claims.role,
    branch_id: claims.branchId,
    // Lets the app show verification state, and gate its own write affordances,
    // without a network round trip — which matters on a connection that may not
    // be there.
    email: claims.email,
    email_verified: claims.emailVerified,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

/** Postgres unique-violation. Two signups racing on the same address land here. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// ---------------------------------------------------------------------------
// Signup — one transaction, or nothing
// ---------------------------------------------------------------------------
router.post("/signup", zValidator("json", signupSchema), async (c) => {
  const body = c.req.valid("json");

  const displayName = (body.displayName ?? body.display_name)!.trim();
  const churchId = (body.churchId ?? body.church_id)!;
  const branchId = body.branchId ?? body.branch_id ?? null;
  const churchRole = body.churchRole ?? body.church_role ?? null;
  const email = body.email ? body.email.toLowerCase().trim() : null;

  const normalizedPhone = body.phone ? normalizePhone(body.phone) : null;
  if (body.phone && !normalizedPhone) {
    throw Errors.validation("Invalid phone number");
  }

  const passwordHash = await hash(body.password);

  // Everything that has to exist for the account to be usable is created here,
  // together. The alternative — create the auth user, then insert the profile
  // in a second request — cannot work once email confirmation is in play: there
  // is no session yet at that point, the second call is rejected, and what is
  // left behind is an account with no profile, which can never log in and which
  // nobody can clean up but a DBA.
  let created: {
    userId: string;
    email: string | null;
    phone: string | null;
    verificationToken: string | null;
  };

  try {
    created = await db.transaction(async (tx) => {
      const church = await tx.query.churches.findFirst({ where: eq(churches.id, churchId) });
      if (!church) throw Errors.validation("Unknown church");

      if (branchId) {
        const branch = await tx.query.branches.findFirst({
          where: and(eq(branches.id, branchId), eq(branches.churchId, churchId)),
        });
        if (!branch) throw Errors.validation("Branch does not belong to that church");
      }

      if (email) {
        const existing = await tx.query.users.findFirst({ where: eq(users.email, email) });
        if (existing) throw Errors.conflict("Email already in use");
      }
      if (normalizedPhone) {
        const existing = await tx.query.users.findFirst({ where: eq(users.phone, normalizedPhone) });
        if (existing) throw Errors.conflict("Phone number already in use");
      }

      const [user] = await tx
        .insert(users)
        .values({ email, phone: normalizedPhone, passwordHash })
        .returning();

      await tx.insert(profiles).values({
        id: user.id,
        displayName,
        phone: normalizedPhone,
        churchId,
        branchId,
        churchRole,
        // Never taken from the request. A signup produces a member; every other
        // role is granted by a review someone else performs.
        role: "member",
        language: body.language,
      });

      // Issued inside the transaction so a rollback takes the token with it and
      // no link can ever point at an account that was not created.
      const verification = email
        ? await issueVerificationToken(tx, user.id, email)
        : null;

      return {
        userId: user.id,
        email: user.email,
        phone: user.phone,
        verificationToken: verification?.token ?? null,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race against a concurrent signup on the same address. The
      // transaction rolled back, so there is no half-made account to clean up.
      throw Errors.conflict("Email or phone number already in use");
    }
    throw err;
  }

  // Committed. Only now does anything leave the building — and a relay that is
  // down or slow must not turn a created account into a reported failure, so
  // sendVerificationEmail swallows its own errors and the user resends.
  let verificationSent = false;
  if (created.verificationToken && created.email) {
    verificationSent = await sendVerificationEmail({
      to: created.email,
      link: verificationLink(created.verificationToken),
    });
  }

  const token = await createToken({
    userId: created.userId,
    churchId,
    role: "member",
    branchId,
    email: created.email,
    emailVerified: false,
  });

  return c.json({
    token,
    user: {
      id: created.userId,
      email: created.email,
      phone: created.phone,
      emailVerified: false,
    },
    // False also when there is no email at all, or when SMTP is unconfigured.
    // The app uses it only to word the banner, never to gate anything.
    verificationSent,
  });
});

// ---------------------------------------------------------------------------
// Login — unconfirmed accounts sign in exactly like confirmed ones
// ---------------------------------------------------------------------------
router.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");

  const user = await resolveUserByIdentifier(body.identifier);
  if (!user || !user.passwordHash) {
    throw Errors.unauthenticated();
  }

  const valid = await verify(user.passwordHash, body.password);
  if (!valid) {
    throw Errors.unauthenticated();
  }

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });

  // No verification check here, and there must not be one. An unconfirmed
  // account reads everything; it is only writing that waits.
  const token = await createToken({
    userId: user.id,
    churchId: profile?.churchId || "",
    role: profile?.role || "member",
    branchId: profile?.branchId || null,
    email: user.email,
    emailVerified: user.emailVerified,
  });

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      emailVerified: user.emailVerified,
    },
  });
});

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/** True when the caller is the app (or curl) rather than a browser following the link. */
function wantsJson(format: string | undefined, accept: string): boolean {
  if (format === "json") return true;
  return accept.includes("application/json") && !accept.includes("text/html");
}

router.get("/verify-email", async (c) => {
  const token = c.req.query("token") || "";
  const result = await verifyEmailToken(token);

  const ok = result.status === "verified" || result.status === "already_verified";
  const canResend = result.status === "expired" || result.status === "used";

  if (wantsJson(c.req.query("format"), c.req.header("accept") || "")) {
    if (ok) return c.json({ status: result.status });

    const [status, code, message] = {
      used: [410, "TOKEN_USED", "This link has already been used."],
      expired: [410, "TOKEN_EXPIRED", "This link has expired."],
      invalid: [400, "TOKEN_INVALID", "This link is not valid."],
    }[result.status] as [number, string, string];

    return c.json({ error: { code, message }, canResend }, status as any);
  }

  // A browser followed the link — from a desktop, or from a mail client that
  // will not hand a custom scheme to the app. Answer with a page, not JSON.
  return c.html(verificationPage(result.status), (ok ? 200 : result.status === "invalid" ? 400 : 410) as any);
});

/**
 * The page a browser lands on. Bilingual, self-contained, no assets.
 *
 * On success it offers to hand off to the app. The hand-off carries no token —
 * the token has just been consumed here, and re-sending it would only produce
 * an "already used" inside the app.
 */
function verificationPage(status: string): string {
  const scheme = `${config.appScheme}://verify?status=${encodeURIComponent(status)}`;

  const copy: Record<string, { am: string; en: string }> = {
    verified: {
      am: "ኢሜይልዎ ተረጋግጧል። አሁን በብርሃን ውስጥ መጻፍ ይችላሉ።",
      en: "Your email is confirmed. You can now post in Birhan.",
    },
    already_verified: {
      am: "ይህ ኢሜይል ቀደም ሲል ተረጋግጧል።",
      en: "This email was already confirmed.",
    },
    used: {
      am: "ይህ አገናኝ ቀደም ሲል ጥቅም ላይ ውሏል። በመተግበሪያው ውስጥ አዲስ አገናኝ መጠየቅ ይችላሉ።",
      en: "This link has already been used. You can request a new one from the app.",
    },
    expired: {
      am: "የዚህ አገናኝ ጊዜ አልፎበታል። በመተግበሪያው ውስጥ አዲስ አገናኝ ይጠይቁ።",
      en: "This link has expired. Request a new one from the app.",
    },
    invalid: {
      am: "ይህ አገናኝ ትክክል አይደለም። እባክዎ ከኢሜይሉ ላይ ሙሉውን አድራሻ ይቅዱ።",
      en: "This link is not valid. Please copy the whole address from the email.",
    },
  };

  const { am, en } = copy[status] ?? copy.invalid;
  const ok = status === "verified" || status === "already_verified";

  return `<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ብርሃን · Birhan</title>
<style>
  body{margin:0;padding:32px 20px;font-family:system-ui,-apple-system,"Noto Serif Ethiopic",serif;
       background:#0b0b0c;color:#f2f2f2;display:flex;justify-content:center}
  main{max-width:26rem;width:100%}
  h1{font-size:1.25rem;margin:0 0 1.25rem}
  p{line-height:1.65;margin:0 0 1rem;font-size:1.05rem}
  .en{color:#b9b9bd}
  .mark{font-size:2.5rem;margin-bottom:.5rem}
  a.btn{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;border-radius:.5rem;
        background:#E3A93C;color:#1a1a1a;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<main>
  <div class="mark">${ok ? "✓" : "!"}</div>
  <h1>ብርሃን · Birhan</h1>
  <p>${am}</p>
  <p class="en">${en}</p>
  ${ok ? `<a class="btn" href="${scheme}">ብርሃንን ክፈት · Open Birhan</a>` : ""}
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
router.post("/resend-verification", optionalAuthMiddleware, async (c) => {
  const ctx = c.get("authContext");

  // A signed-in caller sends no body at all, so an absent or unparseable one is
  // normal here rather than an error.
  let body: { email?: string } = {};
  try {
    const parsed = resendSchema.safeParse(await c.req.json());
    if (parsed.success) body = parsed.data;
  } catch {
    // no body
  }

  // Signed in: this is the banner's resend button, asking about the caller's own
  // account. Nothing can be learned that the caller does not already know, so
  // answer honestly — including the rate limit, which the app needs to explain.
  if (ctx) {
    const outcome = await resendVerification(ctx.userId);

    if (outcome === "rate_limited") {
      throw Errors.rateLimited(
        `Too many verification emails. Try again in an hour (limit ${config.emailResendPerHour} per hour).`
      );
    }
    if (outcome === "no_email") {
      throw Errors.validation("This account has no email address to verify");
    }
    if (outcome === "send_failed") {
      // Nothing reached the mail endpoint. This is the caller's own account, so
      // there is nothing to protect by being vague, and the banner needs to
      // keep saying "not sent" rather than flipping to "check your inbox".
      throw Errors.unavailable(
        "MAIL_UNAVAILABLE",
        "We could not send the verification email just now. Please try again shortly."
      );
    }
    return c.json({ status: outcome === "already_verified" ? "already_verified" : "sent" });
  }

  // Not signed in: answered by address. Every path below returns the same body,
  // whether the address is registered, unregistered, already confirmed, or over
  // its hourly limit — otherwise this endpoint becomes a way to ask "does this
  // person have a Birhan account?", which for a congregation list is not a
  // question a stranger gets to ask.
  if (!body.email) {
    throw Errors.validation("email is required");
  }

  const address = body.email.toLowerCase().trim();
  const user = await db.query.users.findFirst({ where: eq(users.email, address) });

  if (user) {
    const outcome = await resendVerification(user.id);
    if (outcome === "rate_limited") {
      logger.info({ userId: user.id }, "Verification resend suppressed by rate limit");
    }
    if (outcome === "send_failed") {
      // The response below is identical either way — that is the point of this
      // path — so this log line is the only trace that the address had an
      // account and the mail still did not go out.
      logger.error({ userId: user.id }, "Verification resend by address could not be delivered");
    }
  }

  return c.json({
    status: "sent",
    message: "If that address has an unconfirmed Birhan account, a verification email is on its way.",
  });
});

// ---------------------------------------------------------------------------
// Session upkeep
// ---------------------------------------------------------------------------
router.post("/refresh", async (c) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw Errors.unauthenticated();

  const token = header.slice(7);
  let userId: string;
  try {
    const secret = new TextEncoder().encode(config.jwtSecret);
    const { payload } = await jwtVerify(token, secret, { clockTolerance: 60 });
    userId = payload.user_id as string;
  } catch {
    throw Errors.unauthenticated();
  }

  // Claims are re-read from the database rather than copied across. This is what
  // makes verification visible to a client that is already signed in: confirming
  // an address changes a row, and the next refresh is what turns that row into a
  // token the app can act on. Copying the old claims would leave a 30-day token
  // insisting the account is still unconfirmed.
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw Errors.unauthenticated();

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  if (!profile) throw Errors.unauthenticated();

  const newToken = await createToken({
    userId: user.id,
    churchId: profile.churchId,
    role: profile.role,
    branchId: profile.branchId,
    email: user.email,
    emailVerified: user.emailVerified,
  });

  return c.json({ token: newToken });
});

router.post("/logout", async (c) => {
  return c.json({ success: true });
});

router.post("/change-password", zValidator("json", changePasswordSchema), async (c) => {
  const authCtx = c.get("authContext");
  if (!authCtx) throw Errors.unauthenticated();

  const body = c.req.valid("json");
  const user = await db.query.users.findFirst({
    where: eq(users.id, authCtx.userId),
  });
  if (!user || !user.passwordHash) throw Errors.notFound("User not found");

  const valid = await verify(user.passwordHash, body.currentPassword);
  if (!valid) throw Errors.unauthenticated();

  const newHash = await hash(body.newPassword);
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, authCtx.userId));

  return c.json({ success: true });
});

export default router;

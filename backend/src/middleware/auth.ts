import { createMiddleware } from "hono/factory";
import { jwtVerify, importJWK } from "jose";
import { config } from "../config/index.js";
import { Errors } from "../utils/errors.js";
import type { AuthContext, Role } from "../types/index.js";

async function getJwtSecret() {
  // Simple symmetric key from secret
  const encoder = new TextEncoder();
  return encoder.encode(config.jwtSecret);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw Errors.unauthenticated();
  }

  const token = header.slice(7);
  try {
    const secret = await getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      clockTolerance: 60,
      maxTokenAge: "30d",
    });

    const userId = payload.user_id as string;
    const churchId = payload.church_id as string;
    const role = payload.role as Role;
    const branchId = (payload.branch_id as string | null) ?? null;

    if (!userId || !churchId || !role) {
      throw Errors.unauthenticated();
    }

    const ctx: AuthContext = {
      userId,
      churchId,
      role,
      branchId,
      // Carried in the token so a read never has to touch the database to know
      // the account's verification state. Tokens minted before verification
      // existed have neither claim; requireVerifiedEmail resolves those from
      // the database rather than guessing.
      email: (payload.email as string | null) ?? null,
      emailVerified: payload.email_verified === true,
    };
    c.set("authContext", ctx);
    await next();
  } catch (err) {
    throw Errors.unauthenticated();
  }
});

export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header("authorization");
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice(7);
    try {
      const secret = await getJwtSecret();
      const { payload } = await jwtVerify(token, secret, {
        clockTolerance: 60,
        maxTokenAge: "30d",
      });
      const ctx: AuthContext = {
        userId: payload.user_id as string,
        churchId: payload.church_id as string,
        role: payload.role as Role,
        branchId: (payload.branch_id as string | null) ?? null,
        email: (payload.email as string | null) ?? null,
        emailVerified: payload.email_verified === true,
      };
      c.set("authContext", ctx);
    } catch {
      // ignore invalid token for optional auth
    }
  }
  await next();
});

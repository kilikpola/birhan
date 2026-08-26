import type { AuthContext, Role } from "../types/index.js";
import { Errors } from "../utils/errors.js";

export function requireRole(ctx: AuthContext, allowed: Role[]) {
  if (!allowed.includes(ctx.role)) {
    throw Errors.forbidden(`Requires one of: ${allowed.join(", ")}`);
  }
}

export function requireAuth(ctx: AuthContext | undefined): asserts ctx is AuthContext {
  if (!ctx) {
    throw Errors.unauthenticated();
  }
}

import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { Errors } from "../utils/errors.js";

/**
 * Gate for writes.
 *
 * Birhan deliberately does not block login on an unconfirmed email. This app is
 * used where mail is slow or simply does not arrive, and locking someone out of
 * their Bible because a message went missing is the wrong failure. So reading —
 * scripture, announcements, resources — stays open to everyone, and only the
 * actions that put content in front of a congregation wait for confirmation.
 *
 * A phone-only account has no address to confirm and is never held here. That
 * is the difference between "unverified" and "nothing to verify", and conflating
 * the two would leave phone-only members permanently read-only.
 */
export const requireVerifiedEmail = createMiddleware(async (c, next) => {
  const ctx = c.get("authContext");
  if (!ctx) throw Errors.unauthenticated();

  if (ctx.email) {
    // Fast path: the token says there is an address, so the claim decides.
    if (!ctx.emailVerified) throw Errors.emailNotVerified();
    await next();
    return;
  }

  // No address in the token. That is either a phone-only account (allowed) or a
  // token minted before these claims existed (unknowable from the token alone).
  // One primary-key lookup settles it; the alternative is either locking out
  // every phone-only member or letting every stale token through.
  const user = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
    columns: { email: true, emailVerified: true },
  });

  if (user?.email && !user.emailVerified) throw Errors.emailNotVerified();

  await next();
});

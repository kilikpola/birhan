import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { db } from "../db/index.js";
import { config, infraConfig } from "../config/index.js";
import { normalizePhone } from "../utils/phone.js";
import { eq } from "drizzle-orm";
import { authAccounts, authJwks, authVerifications, sessions, users } from "../db/schema.js";

const plugins: any[] = [
  jwt({
    jwt: {
      expirationTime: "30d",
      definePayload: async ({ user }) => {
        const profile = await db.query.profiles.findFirst({
          where: (p, { eq }) => eq(p.id, user.id),
          with: { church: true, branch: true },
        });
        return {
          sub: user.id,
          email: user.email,
          phone: user.phone,
          user_id: user.id,
          church_id: profile?.churchId ?? null,
          role: profile?.role ?? "member",
          branch_id: profile?.branchId ?? null,
        };
      },
    },
  }),
];

// Better Auth Infrastructure plugins (optional, requires API key)
// WARNING: dash() sends auth events (signups, logins, IPs, geo) to Better Auth's servers.
// For church data, review data residency and privacy requirements before enabling.
if (infraConfig.enabled) {
  // Imported here rather than at the top of the file. @better-auth/infra needs
  // zod v4 and this project is on v3, so merely loading the module throws
  // (`z.url is not a function`) — at import time, before any code runs, taking
  // the whole server down with it. An integration that is off by default must
  // not be able to do that, so it is only reached when a key is configured.
  const { dash, sentinel } = await import("@better-auth/infra");

  plugins.push(
    dash({
      apiKey: infraConfig.apiKey,
      apiUrl: infraConfig.apiUrl,
      kvUrl: infraConfig.kvUrl,
      activityTracking: {
        enabled: true,
        updateInterval: 300000,
      },
    }),
    sentinel({
      apiKey: infraConfig.apiKey,
      apiUrl: infraConfig.apiUrl,
      kvUrl: infraConfig.kvUrl,
      security: {
        credentialStuffing: {
          enabled: true,
          thresholds: { challenge: 3, block: 5 },
        },
        compromisedPassword: {
          enabled: true,
          action: "block",
        },
        botBlocking: { action: "challenge" },
      },
    })
  );
}

export const auth = betterAuth({
  /**
   * The adapter has to be told which tables its models live in.
   *
   * Without `schema` it looks for `user`, `session`, `account`, `verification`
   * and `jwks` by those exact names. Ours are `users` and `sessions`, and the
   * other three did not exist at all — so every DB-backed /api/auth/* route
   * answered 500 (`The model "user" was not found in the schema object`),
   * including the JWKS endpoint this mount exists to serve.
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: authAccounts,
      verification: authVerifications,
      jwks: authJwks,
    },
  }),
  secret: config.betterAuthSecret,
  baseURL: config.betterAuthUrl,

  /**
   * OFF, deliberately, and this is the load-bearing line.
   *
   * Turning the adapter on without this would expose public
   * `POST /api/auth/sign-up/email` and `/sign-in/email`. Those routes sit
   * outside `rateLimitByIp` (which is scoped to /api/v1/auth/*), and far worse,
   * outside the signup transaction in routes/auth.ts — the only path that
   * creates the `profiles` row every account needs. `profiles.church_id` is NOT
   * NULL and has no default, so a user created here would have no profile,
   * could never log in through the app, and would permanently occupy the unique
   * email — locking the real person out of ever signing up.
   *
   * Birhan authenticates through /api/v1/auth/login (argon2 against
   * users.password_hash) and issues its own JWT. Better Auth is mounted only for
   * its plugin routes, so it has no reason to own credentials.
   */
  emailAndPassword: {
    enabled: false,
  },
  plugins,
  user: {
    additionalFields: {
      phone: {
        type: "string",
        required: false,
        unique: true,
      },
      phoneVerified: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      lastActiveAt: {
        type: "date",
        required: false,
      },
    },
  },
  advanced: {
    // better-auth 1.6 moved this under `database`; the old top-level key is
    // silently ignored, which would let it mint its own ids.
    database: {
      generateId: false,
    },
    /**
     * Belt and braces over `emailAndPassword.enabled: false`.
     *
     * That flag is the real control, but it is one boolean between the public
     * internet and an account-creation path that bypasses the signup
     * transaction. Anyone re-enabling email/password here — to get password
     * reset, say — would silently re-open sign-up too. These paths stay shut
     * either way, and the next person has to delete a line that says why.
     */
    disabledPaths: ["/sign-up/email", "/sign-in/email"],
  },
});

export async function resolveUserByIdentifier(identifier: string) {
  const normalizedPhone = normalizePhone(identifier);

  if (normalizedPhone) {
    const user = await db.query.users.findFirst({
      where: eq(users.phone, normalizedPhone),
    });
    if (user) return user;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, identifier.toLowerCase().trim()),
  });
  return user;
}

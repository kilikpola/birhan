import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl: process.env.DATABASE_URL!,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
  betterAuthUrl: process.env.BETTER_AUTH_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  s3Endpoint: process.env.S3_ENDPOINT!,
  s3Region: process.env.S3_REGION || "us-east-1",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID!,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  s3BucketResources: process.env.S3_BUCKET_RESOURCES!,
  s3BucketPastorDocs: process.env.S3_BUCKET_PASTOR_DOCS!,
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || "+251",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000").split(","),
  emailVerificationRequired: process.env.EMAIL_VERIFICATION_REQUIRED === "true",

  // --- Email verification -------------------------------------------------
  //
  // Mail leaves through a PHP endpoint on this same server, reached over the
  // loopback interface. There is no third-party relay and no SMTP credential:
  // the endpoint listens on 127.0.0.1 only, and the one thing that authorises a
  // request is an HMAC over its body. See deploy/mail/send.php.
  //
  // Node owns every token; the endpoint is handed a finished message and never
  // touches the database.
  mailEndpointUrl: process.env.MAIL_ENDPOINT_URL || "http://127.0.0.1:8025/send.php",

  /**
   * Shared secret for the request signature. Must be identical to the value in
   * /etc/birhan/mail.env on the server. Without it nothing is sent — an
   * unsigned request is exactly what the endpoint exists to refuse.
   */
  mailHmacSecret: process.env.MAIL_HMAC_SECRET || "",

  /**
   * Loopback should answer in milliseconds, but mail() blocks until Postfix has
   * queued the message, so give it room without letting a wedged endpoint hold
   * a signup request open.
   */
  mailTimeoutMs: parseInt(process.env.MAIL_TIMEOUT_MS || "10000", 10),

  emailFrom: process.env.EMAIL_FROM || "",
  emailFromName: process.env.EMAIL_FROM_NAME || "Birhan",

  /**
   * Public origin the verification link points at. Must be the address a phone
   * or a desktop browser can actually reach — BETTER_AUTH_URL is localhost in
   * development, which would produce a dead link in a real inbox.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, ""),

  /** Custom scheme the app registers (app.json `expo.scheme`). */
  appScheme: process.env.APP_SCHEME || "birhan",

  /** How long a verification link stays good. */
  emailTokenTtlHours: parseInt(process.env.EMAIL_TOKEN_TTL_HOURS || "24", 10),

  /** Verification emails a single account may trigger per hour. */
  emailResendPerHour: parseInt(process.env.EMAIL_RESEND_PER_HOUR || "3", 10),

  // --- Telegram -----------------------------------------------------------
  //
  // One bot serves every church. A church is tied to its group by a short code
  // the pastor generates in the app and posts in the group; the bot's webhook
  // redeems it. Nothing here is per-church configuration.

  /** From @BotFather. Empty disables the whole feature rather than half of it. */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",

  /**
   * Sent to Telegram in setWebhook and returned on every update as
   * X-Telegram-Bot-Api-Secret-Token. The webhook route is public — this header
   * is the only thing separating a real update from anyone who guesses the URL.
   */
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",

  /** Telegram is a third party over the internet, not loopback like mail. */
  telegramTimeoutMs: parseInt(process.env.TELEGRAM_TIMEOUT_MS || "10000", 10),

  /** Minutes a link code stays good. Long enough to switch apps, no longer. */
  telegramCodeTtlMinutes: parseInt(process.env.TELEGRAM_CODE_TTL_MINUTES || "10", 10),

  /** Link codes one church may generate per hour. */
  telegramCodesPerHour: parseInt(process.env.TELEGRAM_CODES_PER_HOUR || "6", 10),
};

/**
 * True once the bot has a token and the webhook has a secret.
 *
 * Both, not either: a bot that can send but whose webhook is unauthenticated
 * would let anyone who finds the URL link any group to any church, which is
 * worse than the feature simply being off.
 */
export const telegramEnabled = Boolean(config.telegramBotToken && config.telegramWebhookSecret);

/**
 * True once the local mail endpoint has been given a signing secret and a From
 * address. Without both, verification mail is logged rather than sent — there is
 * deliberately no unsigned fallback, because a request the endpoint would accept
 * without a signature is a request anyone else could forge.
 */
export const emailEnabled = Boolean(
  config.mailEndpointUrl && config.mailHmacSecret && config.emailFrom
);

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

requireEnv("DATABASE_URL", config.databaseUrl);
requireEnv("BETTER_AUTH_SECRET", config.betterAuthSecret);
requireEnv("BETTER_AUTH_URL", config.betterAuthUrl);
requireEnv("JWT_SECRET", config.jwtSecret);
requireEnv("S3_ENDPOINT", config.s3Endpoint);
requireEnv("S3_ACCESS_KEY_ID", config.s3AccessKeyId);
requireEnv("S3_SECRET_ACCESS_KEY", config.s3SecretAccessKey);

// Better Auth Infra (optional)
export const infraConfig = {
  apiKey: process.env.BETTER_AUTH_API_KEY,
  apiUrl: process.env.BETTER_AUTH_API_URL || "https://api.better-auth.com",
  kvUrl: process.env.BETTER_AUTH_KV_URL || "https://kv.better-auth.com",
  enabled: !!process.env.BETTER_AUTH_API_KEY,
};

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { auth } from "./auth/index.js";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config/index.js";
import { logger, requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/error.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitByIp, rateLimitByUser } from "./middleware/rate-limit.js";

import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import churchRoutes from "./routes/churches.js";
import announcementRoutes from "./routes/announcements.js";
import replyRoutes from "./routes/replies.js";
import resourceRoutes from "./routes/resources.js";
import branchRoutes from "./routes/branches.js";
import memberRoutes from "./routes/members.js";
import pastorVerificationRoutes from "./routes/pastor-verification.js";
import adminRoutes from "./routes/admin.js";
import healthRoutes from "./routes/health.js";
import telegramRoutes from "./routes/telegram.js";
import telegramWebhookRoutes from "./routes/telegram-webhook.js";

const app = new Hono();

app.use(requestLogger());
app.use(secureHeaders());
app.use(cors({
  origin: config.corsOrigins,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.onError(errorHandler);

// Public routes
app.route("/api/v1/health", healthRoutes);

// Telegram's webhook. Public by necessity — Telegram has no bearer token to
// present — and authenticated instead by the secret header it echoes back. It
// sits on its own prefix so the `/api/v1/telegram/*` auth guard below cannot
// accidentally be bypassed, or accidentally apply.
//
// Deliberately NOT rate limited. rateLimitByIp counts per window in *minutes*,
// and Telegram delivers every eligible group message from a small set of IPs —
// any limit low enough to be worth having is one a few busy congregations would
// cross, and the limiter answers 429, which Telegram retries and then drops. A
// dropped update is a link that silently never happens. The secret header is
// the gate; an unsigned request is refused before the body is even parsed, so
// there is very little here to exhaust.
app.route("/api/v1/telegram-webhook", telegramWebhookRoutes);
app.route("/api/v1/churches", churchRoutes);
// app.route() takes (path, router) only — the middleware has to be mounted
// separately or it is silently dropped and the endpoint runs unthrottled.
app.use("/api/v1/auth/*", rateLimitByIp(30, 60));
app.route("/api/v1/auth", authRoutes);

// Authenticated routes
app.use("/api/v1/me/*", authMiddleware);
app.route("/api/v1/me", meRoutes);

app.use("/api/v1/announcements/*", authMiddleware);
app.route("/api/v1/announcements", announcementRoutes);
app.route("/api/v1/announcements", replyRoutes);

app.use("/api/v1/replies/*", authMiddleware);
app.route("/api/v1/replies", replyRoutes);

app.use("/api/v1/resources/*", authMiddleware);
app.use("/api/v1/resources/*", rateLimitByUser(20, 24 * 60));
app.route("/api/v1/resources", resourceRoutes);

app.use("/api/v1/branches/*", authMiddleware);
app.route("/api/v1/branches", branchRoutes);

app.use("/api/v1/members/*", authMiddleware);
app.route("/api/v1/members", memberRoutes);

app.use("/api/v1/pastor-verification/*", authMiddleware);
app.route("/api/v1/pastor-verification", pastorVerificationRoutes);

app.use("/api/v1/telegram/*", authMiddleware);
app.route("/api/v1/telegram", telegramRoutes);

// Admin routes
app.use("/api/v1/admin/*", authMiddleware);
app.route("/api/v1/admin", adminRoutes);

// Better Auth core handler — serves /api/auth/* (sessions, sign-in flows, and
// all plugin routes incl. @better-auth/infra dash/sentinel). Was missing, so
// every /api/auth/* request 404'd and Dash ownership verification could not
// connect. Must be mounted AFTER the custom v1 routes.
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// Start server.
//
// Guarded, because the test suite imports this module for `app` and would
// otherwise bind port 3000 as a side effect of the import — which fails
// outright when a real server is already running on the box, and surfaces as an
// unhandled EADDRINUSE that Vitest warns can produce false positives.
if (config.nodeEnv !== "test") {
  const port = config.port;
  logger.info(`Server starting on port ${port}`);

  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(`Server listening on http://localhost:${info.port}`);
  });
}

export default app;

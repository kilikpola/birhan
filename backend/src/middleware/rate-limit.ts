import { createMiddleware } from "hono/factory";
import { Errors } from "../utils/errors.js";

// Simple in-memory rate limiter. Use Redis in production.
const ipStore = new Map<string, { count: number; resetAt: number }>();
const userStore = new Map<string, { count: number; resetAt: number }>();

function isLimited(store: Map<string, { count: number; resetAt: number }>, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  if (entry.count > limit) {
    return true;
  }
  store.set(key, entry);
  return false;
}

export function rateLimitByIp(limit: number, windowMinutes: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = `${c.req.method}:${c.req.path}:${ip}`;
    if (isLimited(ipStore, key, limit, windowMinutes * 60 * 1000)) {
      throw Errors.rateLimited();
    }
    await next();
  });
}

export function rateLimitByUser(limit: number, windowMinutes: number) {
  return createMiddleware(async (c, next) => {
    const auth = c.get("authContext");
    if (!auth) {
      await next();
      return;
    }
    const key = `${c.req.method}:${c.req.path}:${auth.userId}`;
    if (isLimited(userStore, key, limit, windowMinutes * 60 * 1000)) {
      throw Errors.rateLimited();
    }
    await next();
  });
}

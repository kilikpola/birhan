import type { Context, Next } from "hono";
import { AppError } from "../utils/errors.js";
import { logger } from "./logger.js";

export async function errorHandler(err: Error, c: Context) {
  const reqId = c.get("requestId") || "unknown";

  if (err instanceof AppError) {
    logger.warn({ reqId, code: err.code, status: err.status }, err.message);
    return c.json(err.toJSON(), err.status as any);
  }

  // Log full error server-side only
  logger.error({ reqId, err: err.stack || err.message }, "Unhandled error");

  return c.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    500 as any
  );
}

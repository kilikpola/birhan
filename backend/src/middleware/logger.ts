import { randomUUID } from "node:crypto";
import pino from "pino";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.nodeEnv === "production" ? "info" : "debug",
  transport: config.nodeEnv === "development" 
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

export function requestLogger() {
  return async (c: any, next: any) => {
    const reqId = randomUUID();
    c.set("requestId", reqId);
    const start = Date.now();

    await next();

    const duration = Date.now() - start;
    logger.info({
      reqId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
      userId: c.get("authContext")?.userId,
    }, "request");
  };
}

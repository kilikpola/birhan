import type { ApiError } from "../types/index.js";

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AppError";
  }

  toJSON(): { error: ApiError } {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, "UNAUTHENTICATED", "Authentication required"),
  forbidden: (msg = "Forbidden") => new AppError(403, "FORBIDDEN", msg),
  /**
   * Distinct from FORBIDDEN on purpose. The app has to tell "you lack the role"
   * apart from "confirm your email" — the second has an action attached to it
   * (resend) and the first does not.
   */
  emailNotVerified: (msg = "Confirm your email address before posting") =>
    new AppError(403, "EMAIL_NOT_VERIFIED", msg),
  notFound: (msg = "Not found") => new AppError(404, "NOT_FOUND", msg),
  validation: (msg: string) => new AppError(400, "VALIDATION_ERROR", msg),
  rateLimited: (msg = "Rate limit exceeded") => new AppError(429, "RATE_LIMITED", msg),
  conflict: (msg: string) => new AppError(409, "CONFLICT", msg),
  internal: (msg = "Internal server error") => new AppError(500, "INTERNAL", msg),
  /**
   * A dependency this request needed is down, and the caller should retry
   * rather than change anything. Used by resend when the mail endpoint refused
   * or could not be reached: nothing the user did is wrong, and answering "sent"
   * would leave them waiting on an inbox that will never receive anything.
   */
  unavailable: (code: string, msg: string) => new AppError(503, code, msg),
};

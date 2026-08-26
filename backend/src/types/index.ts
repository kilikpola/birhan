export type Role = "member" | "pending_pastor" | "pastor" | "admin" | "super_admin";
export type PastorStatus = "pending" | "approved" | "rejected";
export type Language = "am" | "en";
export type ResourceCategory = "sermon_notes" | "study_guide" | "calendar" | "announcement_doc" | "other";

export interface AuthContext {
  userId: string;
  churchId: string;
  role: Role;
  branchId: string | null;
  /** The account's email, or null for a phone-only account. From the JWT. */
  email: string | null;
  /**
   * Whether that email has been confirmed. Always false when there is no email
   * — there is nothing to confirm — so never read it on its own to decide
   * whether someone may write; use requireVerifiedEmail, which knows that a
   * phone-only account is not "unverified", it is "not applicable".
   */
  emailVerified: boolean;
}

export interface ApiError {
  code: string;
  message: string;
}

/**
 * Teach Hono what lives in c.get()/c.set().
 *
 * Without this every `c.get("authContext")` is `unknown`, which does NOT just
 * produce noise — it means the compiler cannot check that a handler reads the
 * auth context at all, and church scoping is exactly what that context carries.
 * Keep this augmentation in a file that is part of the program (it is imported
 * throughout) or the errors come back.
 */
declare module "hono" {
  interface ContextVariableMap {
    authContext: AuthContext;
    requestId: string;
  }
}

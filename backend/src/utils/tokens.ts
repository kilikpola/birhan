import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Split tokens for email verification links.
 *
 * A verification link is `selector.verifier`:
 *
 *   selector  16 hex chars, public, indexed. The database looks rows up by this.
 *   verifier  32 random bytes, base64url. Only sha256(verifier) is stored.
 *
 * The split exists so the secret half is never used as a lookup key. Searching
 * on a secret leaks timing through the index, and comparing it in SQL compares
 * byte-by-byte with an early exit; here the lookup is on the non-secret half and
 * the secret half is compared with timingSafeEqual over fixed-length digests.
 *
 * A stolen database yields only hashes, which cannot be turned back into links.
 */

const SELECTOR_BYTES = 8;   // 16 hex chars
const VERIFIER_BYTES = 32;  // 256 bits

export interface IssuedToken {
  /** Goes in the email. Never stored. */
  token: string;
  selector: string;
  verifierHash: string;
}

export function issueToken(): IssuedToken {
  const selector = randomBytes(SELECTOR_BYTES).toString("hex");
  const verifier = randomBytes(VERIFIER_BYTES).toString("base64url");
  return {
    token: `${selector}.${verifier}`,
    selector,
    verifierHash: hashVerifier(verifier),
  };
}

export function hashVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}

/** Splits a token from a link. Returns null for anything malformed. */
export function parseToken(token: string): { selector: string; verifier: string } | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;

  const selector = trimmed.slice(0, dot);
  const verifier = trimmed.slice(dot + 1);

  // The selector is generated as fixed-length hex; anything else cannot match a
  // stored row, and rejecting it here keeps junk out of the query.
  if (selector.length !== SELECTOR_BYTES * 2 || !/^[0-9a-f]+$/.test(selector)) return null;
  if (!verifier || verifier.length > 512) return null;

  return { selector, verifier };
}

/**
 * Constant-time comparison of a presented verifier against a stored hash.
 *
 * Both sides are hex sha256 digests, so they are always the same length and
 * timingSafeEqual never has to bail out early on a length mismatch (which would
 * itself be a signal).
 */
export function verifierMatches(verifier: string, storedHash: string): boolean {
  const presented = Buffer.from(hashVerifier(verifier), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (stored.length !== presented.length) return false;
  return timingSafeEqual(presented, stored);
}

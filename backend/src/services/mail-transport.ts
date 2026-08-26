import { createHmac } from "node:crypto";
import { config } from "../config/index.js";

/**
 * The wire to the local mail endpoint (deploy/mail/send.php).
 *
 * The endpoint listens on 127.0.0.1 and nowhere else, so this request never
 * touches a network the outside world can reach. That is the first half of why
 * it is not a spam relay; the second half is here — every request carries an
 * HMAC over its own body, and the endpoint refuses anything it cannot verify.
 *
 * Nothing about tokens, users or the database crosses this boundary. The
 * endpoint is handed four finished strings and its only job is to hand them to
 * Postfix.
 */

export interface MailMessage {
  to: string;
  subject: string;
  body_text: string;
  body_html: string;
}

export interface MailResult {
  ok: boolean;
  /** HTTP status, absent when the request never completed. */
  status?: number;
  /** Machine-readable reason from the endpoint, or a transport-level label. */
  error?: string;
  /** Endpoint-assigned id for the send, for correlating with its log. */
  id?: string;
}

/**
 * Signs `<timestamp>.<body>` rather than the body alone.
 *
 * Signing only the body would leave the timestamp unauthenticated, and an
 * unauthenticated timestamp defeats the replay window it exists to enforce:
 * anyone holding one captured request could re-send its body under a fresh
 * timestamp forever. Binding the two together means a captured request is
 * usable for exactly the 60 seconds the endpoint allows.
 *
 * Exported because the test suite signs its own requests with it.
 */
export function signRequest(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/**
 * POSTs one message. Never throws — the caller treats mail as best-effort, and a
 * dead endpoint must not become a failed signup.
 */
export async function postMail(message: MailMessage): Promise<MailResult> {
  // Signed over exactly the bytes that go on the wire. Serialise once and reuse
  // the same string for both, or a re-serialisation with different key order
  // would produce a body the signature does not cover.
  const body = JSON.stringify(message);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signRequest(config.mailHmacSecret, timestamp, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.mailTimeoutMs);

  try {
    const res = await fetch(config.mailEndpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-birhan-timestamp": timestamp,
        "x-birhan-signature": signature,
      },
      body,
      signal: controller.signal,
    });

    // The endpoint answers JSON on every path, including its refusals, but a
    // misconfigured PHP-FPM can still return an HTML error page — so parse
    // defensively rather than trusting the content type.
    let payload: { ok?: boolean; error?: string; id?: string } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false, status: res.status, error: "unparseable_response" };
    }

    if (!res.ok || payload.ok !== true) {
      return { ok: false, status: res.status, error: payload.error || `http_${res.status}` };
    }

    return { ok: true, status: res.status, id: payload.id };
  } catch (err) {
    // AbortError, ECONNREFUSED (endpoint down), anything else.
    const label =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: label };
  } finally {
    clearTimeout(timer);
  }
}

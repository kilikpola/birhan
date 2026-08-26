import { emailEnabled } from "../config/index.js";
import { logger } from "../middleware/logger.js";
import { postMail } from "./mail-transport.js";

/**
 * Verification mail: what it says, and handing it to the local endpoint.
 *
 * There is no SMTP relay and no provider account any more. Rendering happens
 * here, delivery happens in mail-transport.ts over loopback, and the actual
 * hand-off to the internet is Postfix on this box — see deploy/mail/README.md
 * for the Postfix, SPF, DKIM and PTR setup that decides whether Gmail accepts
 * any of it.
 */

export interface VerificationEmail {
  to: string;
  /** Full https link. Carries the token. */
  link: string;
}

/**
 * Amharic first, English below, in both subject and body. Plain and short: no
 * marketing, no images, no tracking pixel — a verification mail that looks like
 * a newsletter is a verification mail that lands in spam.
 */
export function renderVerificationEmail(link: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "የብርሃን ኢሜይልዎን ያረጋግጡ · Verify your Birhan email";

  const text = [
    "ብርሃን መጽሐፍ ቅዱስን ለማንበብ እና የቤተ ክርስቲያንዎን ማስታወቂያ ለመከታተል የሚያገለግል መተግበሪያ ነው።",
    "",
    "ኢሜይልዎን ለማረጋገጥ ይህን አድራሻ ይክፈቱ፡",
    link,
    "",
    "ይህ አገናኝ በ24 ሰዓት ውስጥ ጊዜው ያልፍበታል።",
    "እርስዎ ካልተመዘገቡ ይህን መልእክት ችላ ይበሉት።",
    "",
    "—",
    "",
    "Birhan is an app for reading the Bible and following your church's announcements.",
    "",
    "Open this link to verify your email address:",
    link,
    "",
    "The link expires in 24 hours.",
    "If you did not sign up for Birhan, you can ignore this message.",
  ].join("\n");

  // Same words, linked. No remote assets of any kind.
  const html = `<div style="font-family:system-ui,-apple-system,'Noto Serif Ethiopic',serif;font-size:16px;line-height:1.6;color:#111">
<p>ብርሃን መጽሐፍ ቅዱስን ለማንበብ እና የቤተ ክርስቲያንዎን ማስታወቂያ ለመከታተል የሚያገለግል መተግበሪያ ነው።</p>
<p>ኢሜይልዎን ለማረጋገጥ ይህን አገናኝ ይክፈቱ፡<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>ይህ አገናኝ በ24 ሰዓት ውስጥ ጊዜው ያልፍበታል።<br>እርስዎ ካልተመዘገቡ ይህን መልእክት ችላ ይበሉት።</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p>Birhan is an app for reading the Bible and following your church's announcements.</p>
<p>Open this link to verify your email address:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>The link expires in 24 hours.<br>If you did not sign up for Birhan, you can ignore this message.</p>
</div>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sends the verification mail.
 *
 * Never throws. A signup that already committed must not be reported as failed
 * because the mail endpoint was down, and the account is usable — read-only —
 * without the mail ever arriving. The caller shows "we couldn't send the email"
 * and the user resends.
 *
 * Returns true only if the endpoint confirmed it queued the message.
 */
export async function sendVerificationEmail({ to, link }: VerificationEmail): Promise<boolean> {
  const { subject, text, html } = renderVerificationEmail(link);

  if (!emailEnabled) {
    // Development, and any deployment that has not been given MAIL_HMAC_SECRET.
    // Logging the link keeps the flow testable without silently pretending the
    // mail went out.
    logger.warn(
      { to, link, event: "mail.send", result: "not_configured" },
      "Mail endpoint is not configured — verification email not sent. Set MAIL_HMAC_SECRET/EMAIL_FROM."
    );
    return false;
  }

  const startedAt = Date.now();
  const result = await postMail({ to, subject, body_text: text, body_html: html });
  const durationMs = Date.now() - startedAt;

  // Every attempt is logged with its outcome, successful or not. `event` is
  // constant so the whole history of a deployment's sending is one grep, and
  // the endpoint's own id ties this line to the corresponding line in
  // /var/log/birhan-mail/send.log.
  if (result.ok) {
    logger.info(
      { to, id: result.id, durationMs, event: "mail.send", result: "sent" },
      "Verification email accepted by mail endpoint"
    );
    return true;
  }

  logger.error(
    { to, status: result.status, error: result.error, durationMs, event: "mail.send", result: "failed" },
    "Verification email was not sent"
  );
  return false;
}

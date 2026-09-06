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

/**
 * Password-reset mail. Same plain, bilingual, asset-free style as verification —
 * a reset mail that looks like marketing lands in spam, and this one has to
 * arrive. The link expiry is spelled out so a stale link is not a mystery.
 */
export function renderPasswordResetEmail(link: string, ttlHours: number): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "የብርሃን የይለፍ ቃል ዳግም ማስጀመር · Reset your Birhan password";
  const hrs = String(ttlHours);

  const text = [
    "የብርሃን የይለፍ ቃልዎን ዳግም ለማስጀመር ጠይቀዋል።",
    "",
    "አዲስ የይለፍ ቃል ለማዘጋጀት ይህን አገናኝ ይክፈቱ፡",
    link,
    "",
    `ይህ አገናኝ በ${hrs} ሰዓት ውስጥ ጊዜው ያልፍበታል።`,
    "ይህን ካልጠየቁ ይህን መልእክት ችላ ይበሉት፤ የይለፍ ቃልዎ አይቀየርም።",
    "",
    "—",
    "",
    "You asked to reset your Birhan password.",
    "",
    "Open this link to set a new password:",
    link,
    "",
    `The link expires in ${hrs} hour${ttlHours === 1 ? "" : "s"}.`,
    "If you did not ask for this, you can ignore this message — your password will not change.",
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,'Noto Serif Ethiopic',serif;font-size:16px;line-height:1.6;color:#111">
<p>የብርሃን የይለፍ ቃልዎን ዳግም ለማስጀመር ጠይቀዋል።</p>
<p>አዲስ የይለፍ ቃል ለማዘጋጀት ይህን አገናኝ ይክፈቱ፡<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>ይህ አገናኝ በ${hrs} ሰዓት ውስጥ ጊዜው ያልፍበታል።<br>ይህን ካልጠየቁ ይህን መልእክት ችላ ይበሉት፤ የይለፍ ቃልዎ አይቀየርም።</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p>You asked to reset your Birhan password.</p>
<p>Open this link to set a new password:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p>The link expires in ${hrs} hour${ttlHours === 1 ? "" : "s"}.<br>If you did not ask for this, you can ignore this message — your password will not change.</p>
</div>`;

  return { subject, text, html };
}

/**
 * Sends the password-reset mail. Never throws — like the verification sender,
 * the caller stays deliberately vague to a stranger and honest to the
 * account-holder, and a mail outage must not become a stack trace.
 * Returns true only if the endpoint confirmed it queued the message.
 */
export async function sendPasswordResetEmail(
  { to, link, ttlHours }: { to: string; link: string; ttlHours: number },
): Promise<boolean> {
  const { subject, text, html } = renderPasswordResetEmail(link, ttlHours);

  if (!emailEnabled) {
    logger.warn(
      { to, link, event: "mail.send", result: "not_configured" },
      "Mail endpoint is not configured — password-reset email not sent.",
    );
    return false;
  }

  const startedAt = Date.now();
  const result = await postMail({ to, subject, body_text: text, body_html: html });
  const durationMs = Date.now() - startedAt;

  if (result.ok) {
    logger.info(
      { to, id: result.id, durationMs, event: "mail.send", result: "sent", kind: "password_reset" },
      "Password-reset email accepted by mail endpoint",
    );
    return true;
  }

  logger.error(
    { to, status: result.status, error: result.error, durationMs, event: "mail.send", result: "failed", kind: "password_reset" },
    "Password-reset email was not sent",
  );
  return false;
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

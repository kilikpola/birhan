-- Email verification.
--
-- Split-token design: the link carries `selector.verifier`. The selector is
-- public and is what the lookup runs on; only a sha256 of the verifier is
-- stored, so the table is worthless to anyone who steals it. The comparison of
-- the verifier happens in application code with timingSafeEqual.
--
-- Idempotent: db:migrate re-runs every file in this directory on every invocation.

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selector TEXT NOT NULL UNIQUE,
  verifier_hash TEXT NOT NULL,
  -- The address the token was issued for. Re-checked at verification so a link
  -- mailed to a previous address cannot verify a newer one.
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- NULL until the link is clicked. Set once; a second click is refused.
  consumed_at TIMESTAMPTZ,
  -- False for the token minted by signup, true for one the user asked for.
  -- The 3-per-hour budget counts resends only.
  is_resend BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Covers both "the newest token for this user" and the 3-per-hour resend count.
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_created_at_idx
  ON email_verification_tokens (user_id, created_at);

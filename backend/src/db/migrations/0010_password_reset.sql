-- Password reset tokens — split-token, same shape as email_verification_tokens.
-- The selector is the public lookup key; only sha256(verifier) is stored, so a
-- leaked table cannot be turned back into a working reset link.
--
-- Idempotent: migrate.ts re-runs every file on every boot.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selector      text NOT NULL UNIQUE,
  verifier_hash text NOT NULL,
  -- The address the link was mailed to. Checked again at reset so a link sent to
  -- an old address cannot reset an account whose email later changed.
  email         text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_selector_idx ON password_reset_tokens(selector);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx ON password_reset_tokens(user_id, created_at);

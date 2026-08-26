-- Give Better Auth the tables its adapter actually looks for.
--
-- `drizzleAdapter(db, { provider: "pg" })` was mounted with no `schema`, so it
-- looked for models named `user`, `session`, `account`, `verification` and
-- `jwks`. Two of those exist under different names (`users`, `sessions`) and
-- three did not exist at all, so every DB-backed /api/auth/* route answered
-- 500 with `The model "user" was not found in the schema object` — including
-- the JWKS endpoint the jwt plugin and Dash ownership verification need.
--
-- The fix is a real mapping (see src/auth/index.ts) plus the three missing
-- tables. Email/password is switched OFF in Better Auth, so `account` and
-- `verification` stay empty in normal operation: account creation belongs to
-- the atomic /api/v1/auth/signup transaction and nowhere else. They exist so
-- the adapter has somewhere to look rather than throwing.

-- Better Auth's user model carries `name` and `image`; ours never has. Display
-- names live on profiles.display_name. Added nullable and additive — no
-- existing row changes, and nothing writes them today.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;

-- Credentials/OAuth links. Empty while emailAndPassword is disabled and no
-- social provider is configured.
CREATE TABLE IF NOT EXISTS auth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  -- Better Auth's own password column. Ours stays in users.password_hash and is
  -- the only one the app's login reads; this is here for schema completeness.
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON auth_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_provider_account_idx
  ON auth_accounts(provider_id, account_id);

-- Short-lived values (password resets, email change tokens). Birhan's own email
-- verification does NOT use this — it uses email_verification_tokens, which is
-- split-token and stays the source of truth.
CREATE TABLE IF NOT EXISTS auth_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier);

-- The jwt plugin's signing keys. This is the one that actually has to work:
-- without it /api/auth/jwks cannot serve a key set, which is what Dash
-- ownership verification reads.
-- The full field list better-auth 1.7's jwt plugin declares
-- (node_modules/better-auth/dist/plugins/jwt/schema.mjs): publicKey,
-- privateKey, createdAt, expiresAt, alg, crv. Every one has to exist as a
-- column — a missing optional field is still refused, at request time rather
-- than at boot, so it presents as a 500 on /api/auth/jwks and nowhere else.
CREATE TABLE IF NOT EXISTS auth_jwks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  alg TEXT,
  crv TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent for anyone who applied an earlier draft of this file.
ALTER TABLE auth_jwks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE auth_jwks ADD COLUMN IF NOT EXISTS alg TEXT;
ALTER TABLE auth_jwks ADD COLUMN IF NOT EXISTS crv TEXT;

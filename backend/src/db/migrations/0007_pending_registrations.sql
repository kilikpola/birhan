-- Registration is not allowed to create an account until the backend has seen
-- the person's Telegram identity arrive through the bot.
--
-- That means there is a window — between "here are my details" and "Telegram
-- confirmed you" — where the details have to live somewhere. They must NOT live
-- in profiles/users: a row there is an account that can authenticate, and an
-- account that can authenticate before the check has passed defeats the check.
--
-- So they live here instead, briefly, and this table is the only thing that
-- exists for an unfinished registration. Nothing in it grants access.

CREATE TABLE IF NOT EXISTS pending_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly what signup needs to build the account, and nothing else.
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  -- Argon2, hashed by the same routes/auth.ts helper that hashes a real
  -- password, at the moment it arrives. A plaintext password is never written
  -- here, and this column is never read back out to anyone.
  password_hash TEXT NOT NULL,
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  church_role TEXT,
  language language NOT NULL DEFAULT 'am',

  -- The deep-link token, split the same way email verification splits its own
  -- (see utils/tokens.ts): the selector is public and indexed, only the hash of
  -- the verifier is stored. A stolen dump yields no usable links.
  token_selector TEXT NOT NULL UNIQUE,
  token_verifier_hash TEXT NOT NULL,

  -- Written by the webhook, never by a client request. Until telegram_user_id
  -- is non-null this registration cannot become an account.
  telegram_user_id TEXT,
  telegram_username TEXT,
  telegram_confirmed_at TIMESTAMPTZ,

  -- Set when signup consumes it, so one confirmed registration makes exactly
  -- one account.
  consumed_at TIMESTAMPTZ,

  -- Why the bot refused, when it did, so the app can show the person the same
  -- thing the bot told them in Telegram instead of leaving the screen spinning.
  -- Currently only ever 'telegram_taken'.
  rejected_reason TEXT,

  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The webhook looks a registration up by selector on every /start it sees.
CREATE INDEX IF NOT EXISTS pending_registrations_selector_idx
  ON pending_registrations(token_selector);

-- Backs the sweep of abandoned registrations.
CREATE INDEX IF NOT EXISTS pending_registrations_expires_idx
  ON pending_registrations(expires_at);

-- ---------------------------------------------------------------------------
-- The Telegram identity, once it belongs to a real account
-- ---------------------------------------------------------------------------

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_verified_at TIMESTAMPTZ;

-- One Telegram account, one Birhan account. This is the constraint that makes
-- "already linked to another account" a real answer rather than a hope: without
-- it, one person could mint unlimited accounts from a single Telegram identity,
-- which is the entire thing the requirement exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_user_id_idx
  ON profiles(telegram_user_id) WHERE telegram_user_id IS NOT NULL;

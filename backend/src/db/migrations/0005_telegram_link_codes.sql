-- Linking a church to its Telegram group.
--
-- churches.telegram_chat_id / telegram_verified_at already exist (0001). What
-- was missing is the handshake that fills them in: a short code a pastor
-- generates in the app and then posts in the group, which the bot's webhook
-- redeems.
--
-- The code is deliberately short — someone has to type it into a chat — so it
-- is protected by being single-use, short-lived, and rate-limited per church
-- rather than by being unguessable forever.

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Uppercase, ambiguity-free alphabet. Unique so a redemption can never match
  -- two churches at once.
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  -- Filled in on redemption, so the audit trail survives the church being
  -- relinked to a different group later.
  chat_id TEXT,
  chat_title TEXT,
  -- The Telegram account that posted the code. Not a Birhan user id.
  redeemed_by_telegram_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The webhook looks a code up on every message that looks like a redemption,
-- so this one carries the hot path.
CREATE INDEX IF NOT EXISTS telegram_link_codes_code_idx ON telegram_link_codes(code);
-- Backs the per-church rate limit on generation.
CREATE INDEX IF NOT EXISTS telegram_link_codes_church_created_idx
  ON telegram_link_codes(church_id, created_at DESC);

-- One church per group. Without this, two churches could both point at the same
-- chat and each would mirror its announcements into the other's congregation.
CREATE UNIQUE INDEX IF NOT EXISTS churches_telegram_chat_id_idx
  ON churches(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

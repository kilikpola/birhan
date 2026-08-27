-- Deleting an account.
--
-- Two things have to be true at once, and they pull in opposite directions:
-- the person must genuinely be gone, and the church's threads must still make
-- sense afterwards. A pastor who deletes their account should not take a year
-- of announcements with them, and a conversation should not turn into replies
-- answering nobody.
--
-- So the row survives and the person does not: profiles keeps its id, because
-- announcements and replies point at it, and loses everything that identifies
-- anyone. deleted_at is what makes it a tombstone rather than a member.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Rosters, member counts and anything else that means "people in this church"
-- filter on this, so the index carries that filter rather than a scan.
CREATE INDEX IF NOT EXISTS profiles_church_active_idx
  ON profiles(church_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Revoking the tokens a deleted account still holds
-- ---------------------------------------------------------------------------
--
-- The app's JWT is stateless by design: middleware/auth.ts verifies the
-- signature and the age, and never reads the database, which is what lets a
-- request be served without a round trip. The cost of that is real here —
-- deleting rows does not invalidate a token, and these last 30 days.
--
-- This table is the exception list. It is deliberately small and short-lived:
-- one row per deleted account, expiring when the longest-lived token it could
-- have minted would have expired anyway. Past that point the token is dead on
-- its own and the row is just clutter.
--
-- It is not read per request — see services/revocation.ts, which keeps it in
-- memory and refreshes it — so the stateless fast path stays stateless.

CREATE TABLE IF NOT EXISTS account_revocations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- revoked_at + the JWT's own 30-day lifetime.
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS account_revocations_expires_idx
  ON account_revocations(expires_at);

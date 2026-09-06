-- Expo push tokens — one row per device install. `token` is globally unique:
-- when a phone that was signed into one account signs into another, the token
-- moves to the new user (upsert on conflict), so a device never fans a church's
-- announcements to the wrong person.
--
-- Idempotent: migrate.ts re-runs every file on every boot.
CREATE TABLE IF NOT EXISTS push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);

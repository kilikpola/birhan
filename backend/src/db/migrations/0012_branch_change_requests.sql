-- Branch-change requests + membership history in one table.
--
-- A member who moves asks to switch branch; a pastor/admin of their church
-- approves. An APPROVED row is also the history record: from_branch_* is a
-- branch the person has now left ("ex branch"). Branch names are snapshotted so
-- history survives a later branch deletion (the ids go NULL, the names remain).
--
-- Idempotent: migrate.ts re-runs every file on every boot.
DO $$ BEGIN
  CREATE TYPE branch_change_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS branch_change_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  church_id        uuid NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  from_branch_id   uuid REFERENCES branches(id) ON DELETE SET NULL,
  from_branch_name text,
  to_branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  to_branch_name   text NOT NULL,
  status           branch_change_status NOT NULL DEFAULT 'pending',
  reason           text,
  rejected_reason  text,
  decided_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS branch_change_church_status_idx ON branch_change_requests(church_id, status);
CREATE INDEX IF NOT EXISTS branch_change_profile_idx ON branch_change_requests(profile_id);
CREATE INDEX IF NOT EXISTS branch_change_from_branch_idx ON branch_change_requests(from_branch_id);
-- One open request per person, enforced in the DB.
CREATE UNIQUE INDEX IF NOT EXISTS branch_change_one_pending_idx
  ON branch_change_requests(profile_id) WHERE status = 'pending';

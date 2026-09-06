-- Branch hierarchy: a branch may be a "mother" (top-level, parent_branch_id NULL)
-- or a "child" that belongs to exactly one mother. Two levels only — a child
-- cannot itself be a parent; that rule lives in the service, not the schema.
--
-- Idempotent: migrate.ts re-runs every file on every boot, so guard with
-- IF NOT EXISTS.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS parent_branch_id uuid REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS branches_parent_branch_id_idx ON branches(parent_branch_id);

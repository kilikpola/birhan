-- ============================================================
-- 16 — profiles.phone + profiles.church_role
--
-- The app has been writing and reading two columns that were never created:
--
--   church_role  src/app/auth.tsx:318,398 (insert), src/lib/auth.tsx:160 (insert),
--                src/lib/auth.tsx:72 (select)
--   phone        same inserts, same select
--
-- PostgREST answers an insert naming an unknown column with
--   PGRST204: Could not find the 'church_role' column of 'profiles'
--             in the schema cache
-- which surfaces in the app as the sign-up failing with a "church role is not
-- found" style message. Every sign-up path hits it, so no account could be
-- created against a database built only from 01–15.
--
-- `church_role` is the role INSIDE a congregation (choir leader, deacon, qes…)
-- and is presentational — it must not be confused with `profiles.role`, which
-- is the permission level ('member' | 'pending_pastor' | 'pastor' | 'admin' |
-- 'super_admin') that RLS reads. Nothing here grants any privilege.
--
-- Expand-only: both columns are nullable with no default, so the currently
-- deployed app version keeps working unchanged.
-- ============================================================

alter table profiles add column if not exists phone text;
alter table profiles add column if not exists church_role text;

-- Mirrors LAY_ROLES + CLERGY_ROLES in src/constants/roles.ts. Null stays legal
-- for the rows that predate this migration and for sign-ups that skip the step.
-- Adding a role to that file means adding it here in a later migration too.
alter table profiles drop constraint if exists profiles_church_role_check;
alter table profiles add constraint profiles_church_role_check
  check (
    church_role is null
    or church_role in (
      -- lay
      'member', 'choir', 'choir_leader', 'worship_leader', 'sunday_school',
      'youth_leader', 'elder', 'deacon', 'evangelist', 'prayer_leader',
      'womens_fellowship', 'mens_fellowship', 'secretary', 'treasurer',
      -- clergy
      'qes', 'pastor', 'assistant_pastor'
    )
  );

comment on column profiles.church_role is
  'Congregational role for display (choir leader, deacon, qes…). NOT a permission — RLS reads profiles.role.';
comment on column profiles.phone is
  'Optional contact number entered at sign-up, typically +251…';

-- PostgREST caches the schema; without this the API keeps returning PGRST204
-- until the connection pool recycles.
notify pgrst, 'reload schema';

-- ============================================================
-- 14_fix_profile_self_update.sql — close a cross-church access hole.
--
-- The self-update policy (02_rls, recreated in 04) constrained `role` but NOT
-- `church_id`. A member could therefore run
--     update profiles set church_id = '<any other church>' where id = auth.uid()
-- and, after their JWT refreshed (the token hook re-reads church_id), gain read
-- access to that church's announcements, replies, resources, roster, and
-- storage — full cross-tenant breach from a one-line client call. Comments in
-- 02_rls.sql and 08_push.sql claimed church_id was already locked; it wasn't.
--
-- This recreates the policy so a member may edit their own profile (name,
-- language, push token, request pastor) but can change NEITHER their role
-- (except the one-way member -> pending_pastor request) NOR their church.
-- Moving a member between churches stays a super_admin action
-- (profiles_update_super_admin), which is unaffected by this policy.
-- Run after 01–13.
-- ============================================================

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- church is immutable via self-update (null-safe): only super_admin moves
    -- a member between churches.
    and church_id is not distinct from (select church_id from profiles where id = auth.uid())
    -- role is immutable, except the narrow one-way member -> pending_pastor.
    and (
      role = (select role from profiles where id = auth.uid())
      or (
        (select role from profiles where id = auth.uid()) = 'member'
        and role = 'pending_pastor'
      )
    )
  );

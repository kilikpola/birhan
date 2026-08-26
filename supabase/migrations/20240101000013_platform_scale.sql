-- ============================================================
-- 13_platform_scale.sql — make the PLATFORM-WIDE queries (super-admin console)
-- scale to 100M+ profiles across all churches. Unlike member-facing queries,
-- these are not church-scoped: they filter/aggregate the whole profiles table.
-- Run after 01–12.
-- ============================================================

-- 1. Verification queue: `profiles where pastor_status = 'pending'`.
-- Almost every profile has pastor_status = NULL (ordinary members), so a
-- PARTIAL index is tiny — it holds only the handful of pastor applicants and
-- turns the queue (and its count) from a 100M-row scan into an index lookup.
create index if not exists idx_profiles_pastor_status
  on profiles(pastor_status, pastor_requested_at)
  where pastor_status is not null;

-- 2. "Count pastors" / any role filter: most rows are 'member', so a partial
-- index over the non-member roles stays small and answers role lookups fast.
create index if not exists idx_profiles_role
  on profiles(role)
  where role <> 'member';

-- 3. Churches directory sorts by member_count desc.
create index if not exists idx_churches_member_count
  on churches(member_count desc);

-- 4. Estimated counts for the dashboard tiles.
-- Exact count(*) on a 100M-row table is a full scan on every dashboard load.
-- For "total members / total churches" an ESTIMATE from planner statistics is
-- instant (O(1)) and plenty accurate for a headline number. Keep exact counts
-- only for the small, indexed sets (pending pastors, verified pastors).
-- Run ANALYZE periodically (autovacuum does this) to keep estimates fresh.
create or replace function public.platform_estimated_counts()
returns table(churches bigint, members bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select reltuples::bigint from pg_class where oid = 'public.churches'::regclass),
    (select reltuples::bigint from pg_class where oid = 'public.profiles'::regclass)
$$;

-- Only the console (super_admin) needs it, but the numbers aren't sensitive and
-- RLS still guards every underlying row read elsewhere.
grant execute on function public.platform_estimated_counts() to authenticated;

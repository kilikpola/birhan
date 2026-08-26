-- ============================================================
-- 12_scale_indexes.sql — indexes for the hot paths, so church-scoped
-- queries don't degrade into full table scans as the tables grow.
-- Run after 01–11.
--
-- On a large LIVE table, prefer CREATE INDEX CONCURRENTLY (no write lock)
-- run OUTSIDE a transaction. These use plain CREATE INDEX because the tables
-- are still small; swap to CONCURRENTLY if you apply this to a populated DB.
-- ============================================================

-- profiles.church_id — the single most-used filter in the app:
--   * roster load           (admin.tsx: profiles where church_id = ?)
--   * RLS church scoping     (auth_church_id() compared on profiles reads)
--   * member_count trigger   (updates churches on profile church_id change)
--   * push fan-out           (Edge Function: profiles where church_id = ?)
-- Without it every one of those is a sequential scan of ALL profiles.
create index if not exists idx_profiles_church on profiles(church_id);

-- replies.author_id — the reply rate-limit trigger runs
--   select count(*) from replies where author_id = ? and created_at > now()-1h
-- on EVERY reply insert. Without this it scans the whole replies table per post.
create index if not exists idx_replies_author on replies(author_id, created_at);

-- profiles.expo_push_token — push fan-out selects members of a church that
-- have a token. Partial index keeps it tiny (only rows that can be notified).
create index if not exists idx_profiles_push_token on profiles(church_id)
  where expo_push_token is not null;

-- church_requests.requested_by — a member reads their own requests (RLS +
-- "did my request go through" checks).
create index if not exists idx_church_requests_requester on church_requests(requested_by);

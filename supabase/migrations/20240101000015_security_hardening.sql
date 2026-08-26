-- ============================================================
-- 15_security_hardening.sql — close the remaining audit findings.
-- Run after 01–14. See memory birhan-security-audit.
-- ============================================================

-- 1) PUSH-TOKEN DISCLOSURE ----------------------------------------------------
-- `expo_push_token` lived on `profiles`, and `profiles_read_church` lets any
-- member SELECT fellow members' rows — so every member could read everyone
-- else's push token. Expo's push API is unauthenticated, so a token is enough
-- to spam/phish arbitrary notifications at a specific device. RLS is row-level,
-- not column-level, so the fix is to move tokens into their own table where a
-- member can touch ONLY their own row. The fan-out (service role) bypasses RLS
-- and still reads them all.
create table if not exists push_tokens (
  user_id    uuid primary key references profiles(id) on delete cascade,
  token      text not null,
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;

drop policy if exists push_tokens_self on push_tokens;
create policy push_tokens_self on push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Carry over any tokens already stored on profiles.
insert into push_tokens (user_id, token)
  select id, expo_push_token from profiles where expo_push_token is not null
  on conflict (user_id) do update set token = excluded.token, updated_at = now();

-- Remove the disclosure vector (also drops the partial index on the column).
alter table profiles drop column if exists expo_push_token;

-- 2) platform_estimated_counts() — lock to super_admin ------------------------
-- The RPC was SECURITY DEFINER and executable by any authenticated user,
-- leaking platform-wide totals. Guard it by JWT role.
create or replace function public.platform_estimated_counts()
returns table(churches bigint, members bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.auth_role() <> 'super_admin' then
    raise exception 'not authorized';
  end if;
  return query
    select (select reltuples::bigint from pg_class where oid = 'public.churches'::regclass),
           (select reltuples::bigint from pg_class where oid = 'public.profiles'::regclass);
end $$;

-- 3) replies.author_name spoofing --------------------------------------------
-- author_name was client-supplied and never checked against the caller's
-- profile, so a member could post a reply under someone else's name. Force both
-- the id and the display name from the authenticated user at insert time.
create or replace function public.set_reply_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  select display_name into new.author_name from profiles where id = auth.uid();
  return new;
end $$;

drop trigger if exists trg_reply_author on replies;
create trigger trg_reply_author
  before insert on replies
  for each row execute function public.set_reply_author();

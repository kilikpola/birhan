-- ============================================================
-- rls_regression.sql — regression tests for the security fixes made while
-- hardening Birhan. Each test simulates a signed-in user by setting the same
-- JWT claims the custom access token hook would produce (sub / church_id /
-- user_role), switching to the `authenticated` role so RLS applies, then
-- asserting a known-bad action is blocked (or a known-good action is allowed).
--
-- Run against a throwaway DB that has migrations 01–15 applied:
--   supabase start
--   for f in supabase/*.sql; do psql "$DB_URL" -f "$f"; done   # (or db reset)
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_regression.sql
--
-- Any failed assertion RAISEs, which with ON_ERROR_STOP=1 fails the CI job.
-- Covers: church_id tenant-escape (14), reply author spoofing (15),
-- platform_estimated_counts guard (15), member self-promotion (02/04).
-- ============================================================
\set ON_ERROR_STOP on

-- ---------- fixtures (run as postgres → RLS bypassed) ----------
insert into churches (id, name_am, name_en) values
  ('11111111-1111-1111-1111-111111111111', 'ቤተ ክርስቲያን ሀ', 'Church One'),
  ('22222222-2222-2222-2222-222222222222', 'ቤተ ክርስቲያን ለ', 'Church Two');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'member-a@test.invalid', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'pastor-p@test.invalid', '', now(), now(), now());

insert into profiles (id, display_name, church_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Member A',
   '11111111-1111-1111-1111-111111111111', 'member'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pastor P',
   '11111111-1111-1111-1111-111111111111', 'pastor');

insert into announcements (id, church_id, author_id, body) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test announcement');

-- Claims for Member A (as the token hook would stamp them).
-- Helper: `select set_config('request.jwt.claims', <json>, true)` inside each txn.

-- ---------- Test 1: a member CANNOT change their own church_id (fix 14) ----------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'church_id', '11111111-1111-1111-1111-111111111111',
    'user_role', 'member', 'role', 'authenticated')::text, true);
  do $$
  begin
    update public.profiles
      set church_id = '22222222-2222-2222-2222-222222222222'
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    raise exception 'FAIL 1: member was able to change church_id (tenant escape)';
  exception when insufficient_privilege then
    raise notice 'PASS 1: church_id change blocked by RLS';
  end $$;
rollback;

-- ---------- Test 2: a member CAN still edit their own display_name ----------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'church_id', '11111111-1111-1111-1111-111111111111',
    'user_role', 'member', 'role', 'authenticated')::text, true);
  update public.profiles set display_name = 'Member A Renamed'
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  do $$
  declare nm text;
  begin
    select display_name into nm from public.profiles
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    if nm <> 'Member A Renamed' then
      raise exception 'FAIL 2: allowed self-update did not take (got %)', nm;
    end if;
    raise notice 'PASS 2: display_name self-update allowed';
  end $$;
rollback;

-- ---------- Test 3: reply author_name is trigger-forced, not client-set (fix 15) ----------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'church_id', '11111111-1111-1111-1111-111111111111',
    'user_role', 'member', 'role', 'authenticated')::text, true);
  insert into public.replies (announcement_id, author_id, author_name, text)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SPOOFED NAME', 'hi');
  do $$
  declare nm text;
  begin
    select author_name into nm from public.replies
      where announcement_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and text = 'hi'
      order by created_at desc limit 1;
    if nm <> 'Member A' then
      raise exception 'FAIL 3: author_name was not forced to the profile name (got %)', nm;
    end if;
    raise notice 'PASS 3: reply author_name forced to profile display_name';
  end $$;
rollback;

-- ---------- Test 4: platform_estimated_counts() rejects non-super_admin (fix 15) ----------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'church_id', '11111111-1111-1111-1111-111111111111',
    'user_role', 'member', 'role', 'authenticated')::text, true);
  do $$
  declare rejected boolean := false;
  begin
    begin
      perform public.platform_estimated_counts();
    exception when others then
      rejected := true;
    end;
    if not rejected then
      raise exception 'FAIL 4: member could read platform_estimated_counts()';
    end if;
    raise notice 'PASS 4: platform_estimated_counts blocked for non-super_admin';
  end $$;
rollback;

-- ---------- Test 5: a member CANNOT self-promote their role (02/04 policy) ----------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'church_id', '11111111-1111-1111-1111-111111111111',
    'user_role', 'member', 'role', 'authenticated')::text, true);
  do $$
  begin
    update public.profiles set role = 'pastor'
      where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    raise exception 'FAIL 5: member self-promoted to pastor';
  exception when insufficient_privilege then
    raise notice 'PASS 5: role self-promotion blocked by RLS';
  end $$;
rollback;

-- If we got here, every assertion passed.
do $$ begin raise notice 'ALL RLS REGRESSION TESTS PASSED'; end $$;

-- ============================================================
-- Birhan — Row-Level Security  (run second)
-- Church scoping enforced at the DB, not in client code.
-- Replaces Firestore rules spec §4.
-- ============================================================

alter table churches      enable row level security;
alter table profiles      enable row level security;
alter table announcements enable row level security;
alter table replies       enable row level security;

-- Helpers: read church_id / role straight from the JWT ------
-- (populated by the custom access token hook, file 03)
create or replace function auth_church_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'church_id', '')::uuid
$$;

create or replace function auth_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'user_role', 'member')
$$;

-- CHURCHES ---------------------------------------------------
-- Everyone signed in or signing up (anon) can read the church list.
create policy churches_read on churches
  for select using (true);

-- Only a pastor/admin of THAT church may edit it.
create policy churches_update on churches
  for update to authenticated
  using (id = auth_church_id() and auth_role() in ('pastor','admin'));

-- PROFILES ---------------------------------------------------
-- You can read your own profile.
create policy profiles_read_self on profiles
  for select to authenticated using (id = auth.uid());

-- You can read fellow members of your church (for reply author names).
create policy profiles_read_church on profiles
  for select to authenticated using (church_id = auth_church_id());

-- You may create only your own profile, only as a 'member'.
create policy profiles_insert_self on profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'member');

-- You may update your own profile but NOT promote yourself or move churches.
-- Exception: A member is allowed a one-way transition to 'pending_pastor'.
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (
      role = (select role from profiles where id = auth.uid())
      or (
        (select role from profiles where id = auth.uid()) = 'member'
        and role = 'pending_pastor'
      )
    )
  );

-- ANNOUNCEMENTS ----------------------------------------------
-- Read: only your church's announcements.
create policy ann_read on announcements
  for select to authenticated
  using (church_id = auth_church_id());

-- Write: only a pastor/admin of that church.
create policy ann_insert on announcements
  for insert to authenticated
  with check (church_id = auth_church_id() and auth_role() in ('pastor','admin'));

create policy ann_update on announcements
  for update to authenticated
  using (church_id = auth_church_id() and auth_role() in ('pastor','admin'));

create policy ann_delete on announcements
  for delete to authenticated
  using (church_id = auth_church_id() and auth_role() in ('pastor','admin'));

-- REPLIES ----------------------------------------------------
-- Read replies on announcements belonging to your church.
create policy replies_read on replies
  for select to authenticated
  using (exists (
    select 1 from announcements a
    where a.id = replies.announcement_id and a.church_id = auth_church_id()
  ));

-- Create a reply only as yourself, only if the thread isn't locked,
-- and only on your church's announcements.
create policy replies_insert on replies
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from announcements a
      where a.id = announcement_id
        and a.church_id = auth_church_id()
        and a.locked = false
    )
  );

-- Delete your own reply, or any reply if you're a pastor/admin.
create policy replies_delete on replies
  for delete to authenticated
  using (
    author_id = auth.uid()
    or auth_role() in ('pastor','admin')
  );

-- ============================================================
-- 10_church_requests.sql — "Other" church flow (member request → console review)
-- Members can't create churches (that stays admin-only, no dup/spam rows).
-- Instead they submit a request; a super_admin approves it in admin-web, which
-- creates the church and links the member. Run after 01–09.
-- ============================================================

create table if not exists church_requests (
  id                uuid primary key default gen_random_uuid(),
  requested_by      uuid not null references profiles(id) on delete cascade,
  name_en           text not null,
  name_am           text,
  city              text,
  denomination      text,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  created_church_id uuid references churches(id),
  rejected_reason   text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_church_requests_status on church_requests(status, created_at);

alter table church_requests enable row level security;

-- A member may file a request as themselves.
drop policy if exists church_req_insert on church_requests;
create policy church_req_insert on church_requests
  for insert to authenticated
  with check (requested_by = auth.uid());

-- A member may read their own requests (to see status).
drop policy if exists church_req_read_own on church_requests;
create policy church_req_read_own on church_requests
  for select to authenticated
  using (requested_by = auth.uid());

-- super_admin may read all and update (approve / reject).
drop policy if exists church_req_read_super on church_requests;
create policy church_req_read_super on church_requests
  for select to authenticated
  using (public.auth_role() = 'super_admin');

drop policy if exists church_req_update_super on church_requests;
create policy church_req_update_super on church_requests
  for update to authenticated
  using (public.auth_role() = 'super_admin')
  with check (public.auth_role() = 'super_admin');

-- Approving a request creates a church row — so super_admin needs INSERT on
-- churches (02_rls only granted read + update). Still no self-serve creation.
drop policy if exists churches_insert_super_admin on churches;
create policy churches_insert_super_admin on churches
  for insert to authenticated
  with check (public.auth_role() = 'super_admin');

-- ============================================================
-- Birhan — Pastor Verification & RLS updates (Stage 1 - Corrected)
-- ============================================================

-- 1. Modify profiles.role check constraint to include pending_pastor and super_admin
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check 
  check (role in ('member', 'pastor', 'admin', 'super_admin', 'pending_pastor'));

-- 2. Add pastor verification metadata columns to profiles
alter table profiles 
  add column if not exists pastor_status text default null check (pastor_status in ('pending', 'approved', 'rejected')),
  add column if not exists pastor_doc_path text,
  add column if not exists pastor_rejected_reason text,
  add column if not exists pastor_requested_at timestamptz default null;

-- 3. Create branches table
create table if not exists branches (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references churches(id) on delete cascade,
  name_am     text not null,
  name_en     text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 4. Add branch_id reference to profiles
alter table profiles 
  add column if not exists branch_id uuid references branches(id) on delete set null;

-- 5. Enable Row-Level Security on branches
alter table branches enable row level security;

-- 6. RLS Policies for branches table
-- Everyone signed in can view branches
drop policy if exists branches_read on branches;
create policy branches_read on branches
  for select to authenticated using (true);

-- Only pastor, admin, or super_admin of the church can insert branches
drop policy if exists branches_insert on branches;
create policy branches_insert on branches
  for insert to authenticated
  with check (
    church_id = auth_church_id()
    and auth_role() in ('pastor', 'admin', 'super_admin')
  );

-- Only pastor, admin, or super_admin of the church can update branches
drop policy if exists branches_update on branches;
create policy branches_update on branches
  for update to authenticated
  using (
    church_id = auth_church_id()
    and auth_role() in ('pastor', 'admin', 'super_admin')
  );

-- Only pastor, admin, or super_admin of the church can delete branches
drop policy if exists branches_delete on branches;
create policy branches_delete on branches
  for delete to authenticated
  using (
    church_id = auth_church_id()
    and auth_role() in ('pastor', 'admin', 'super_admin')
  );

-- 7. RLS Policies for profiles table (Recreate to allow pending_pastor transition and super_admin read)
-- Recreate profiles_update_self to allow narrow member -> pending_pastor transition
drop policy if exists profiles_update_self on profiles;
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

-- super_admin can read all profiles
drop policy if exists profiles_select_super_admin on profiles;
create policy profiles_select_super_admin on profiles
  for select to authenticated
  using (public.auth_role() = 'super_admin');

-- super_admin can update profiles roles and fields
drop policy if exists profiles_update_super_admin on profiles;
create policy profiles_update_super_admin on profiles
  for update to authenticated
  using (public.auth_role() = 'super_admin')
  with check (public.auth_role() = 'super_admin');

-- 8. Setup storage bucket 'pastor-docs'
insert into storage.buckets (id, name, public)
values ('pastor-docs', 'pastor-docs', false)
on conflict (id) do nothing;

-- Enable RLS on storage bucket policies (applied to storage.objects)
-- Policy 1: Allow users to upload to their own folder path
drop policy if exists "Allow user upload" on storage.objects;
create policy "Allow user upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pastor-docs'
    and name like (auth.uid()::text || '/%')
  );

-- Policy 2: Only super_admin may read files in the pastor-docs bucket
drop policy if exists "Allow super admin read" on storage.objects;
create policy "Allow super admin read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pastor-docs'
    and public.auth_role() = 'super_admin'
  );

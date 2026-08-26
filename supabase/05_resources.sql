-- ============================================================
-- 05_resources.sql — Church Resources Schema & RLS Policies
-- ============================================================

-- 1. Create resources table
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  branch_id uuid references branches(id),
  uploaded_by uuid not null references profiles(id),
  title_am text,
  title_en text,
  description text,
  category text not null check (category in ('sermon_notes','study_guide','calendar','announcement_doc','other')),
  file_path text not null,
  file_size_bytes bigint not null,
  mime_type text not null,
  rights_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fast church resource queries
create index if not exists idx_resources_church on resources(church_id);

-- 2. Enable RLS
alter table resources enable row level security;

-- Member Read Policy: members of the church can read resources
create policy "resources_read_church"
  on resources for select
  using (
    church_id = public.auth_church_id()
  );

-- Pastor / Admin Write Policy: pastors & admins of the church can insert
create policy "resources_insert_pastor"
  on resources for insert
  with check (
    church_id = public.auth_church_id()
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
    and uploaded_by = auth.uid()
  );

-- Pastor / Admin Delete Policy: pastors & admins of the church can delete
create policy "resources_delete_pastor"
  on resources for delete
  using (
    church_id = public.auth_church_id()
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
  );

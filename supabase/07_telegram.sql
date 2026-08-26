-- ============================================================
-- 07_telegram.sql — Telegram Group Linking Schema & RLS
-- ============================================================

-- 1. Create telegram_link_codes table
create table if not exists telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references churches(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- Index for fast active link code lookup by webhook
create index if not exists idx_telegram_codes_code on telegram_link_codes(code) where consumed_at is null;

-- 2. Enable RLS
alter table telegram_link_codes enable row level security;

-- Pastor / Admin insert policy: only pastor/admin of that church can create link codes
drop policy if exists "telegram_codes_insert_pastor" on telegram_link_codes;
create policy "telegram_codes_insert_pastor" on telegram_link_codes
  for insert to authenticated
  with check (
    church_id = public.auth_church_id()
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
    and created_by = auth.uid()
  );

-- Pastor / Admin select policy: only pastor/admin of that church can view link codes
drop policy if exists "telegram_codes_select_pastor" on telegram_link_codes;
create policy "telegram_codes_select_pastor" on telegram_link_codes
  for select to authenticated
  using (
    church_id = public.auth_church_id()
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
  );

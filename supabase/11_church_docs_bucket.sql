-- ============================================================
-- 11_church_docs_bucket.sql — storage bucket for church resource documents.
-- The Resources feature (src/lib/resources.ts) uploads/downloads to a private
-- 'church-docs' bucket, but nothing created it (04 only makes 'pastor-docs').
-- Run after 01–10.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('church-docs', 'church-docs', false)
on conflict (id) do nothing;

-- Files live under "<churchId>/<resourceId>/<filename>", so the first path
-- segment scopes a document to its church.

-- Pastors/admins of a church may upload into that church's folder.
drop policy if exists "church_docs upload" on storage.objects;
create policy "church_docs upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'church-docs'
    and (storage.foldername(name))[1] = public.auth_church_id()::text
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
  );

-- Any member of the church may read (download / signed URL) its documents.
drop policy if exists "church_docs read" on storage.objects;
create policy "church_docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'church-docs'
    and (storage.foldername(name))[1] = public.auth_church_id()::text
  );

-- Pastors/admins may delete their church's documents.
drop policy if exists "church_docs delete" on storage.objects;
create policy "church_docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'church-docs'
    and (storage.foldername(name))[1] = public.auth_church_id()::text
    and public.auth_role() in ('pastor', 'admin', 'super_admin')
  );

-- ============================================================
-- Birhan — custom access token hook  (run third)
-- Puts church_id and role into the JWT so RLS reads them for
-- free (no per-query table lookup). Firebase "custom claims"
-- equivalent. After running, ENABLE it in:
--   Authentication → Hooks → Custom Access Token → custom_access_token_hook
-- ============================================================

-- SECURITY DEFINER + pinned search_path: the hook is invoked by
-- supabase_auth_admin, and profiles has RLS enabled. As SECURITY INVOKER the
-- hook's read of profiles is blocked by RLS and GoTrue returns 500 on EVERY
-- login. Running as definer (owner = postgres) reads profiles regardless of
-- RLS. The pinned search_path is required for a definer function.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims  jsonb;
  prof    record;
begin
  select church_id, role into prof
  from profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if prof.church_id is not null then
    claims := jsonb_set(claims, '{church_id}', to_jsonb(prof.church_id::text));
  else
    claims := jsonb_set(claims, '{church_id}', to_jsonb(''::text));
  end if;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(prof.role, 'member')));

  return jsonb_set(event, '{claims}', claims);
end $$;

-- Let the auth admin run the hook and read profiles.
grant execute on function custom_access_token_hook to supabase_auth_admin;
grant select on profiles to supabase_auth_admin;

-- NOTE: claims are refreshed when the token refreshes. If a pastor
-- promotes a member, that member must sign out/in (or wait for token
-- refresh) for the new role to take effect in their JWT. Acceptable
-- for launch — role changes are rare.

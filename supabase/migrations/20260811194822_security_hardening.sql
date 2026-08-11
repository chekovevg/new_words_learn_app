-- Record the complete live API-role cleanup explicitly. RLS determines which
-- rows are writable; these grants determine which relations and fields are
-- available through PostgREST.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.words from anon, authenticated;
revoke all on table public.ai_enrichment_usage from anon, authenticated;

grant select on table public.profiles to authenticated;
grant insert (id, email, name) on table public.profiles to authenticated;
grant update (name, legacy_html_seed_imported_at) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.words to authenticated;

revoke all on all sequences in schema public from anon, authenticated;

-- New public-schema objects created by the postgres owner start private. These
-- revokes are idempotent; supabase_admin is deliberately omitted because this
-- migration role cannot change that owner's defaults.
alter default privileges for role postgres in schema public
revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
revoke execute on functions from public, anon, authenticated;

-- Recreate every application-table policy with an explicit API role. This
-- replaces policies restored from older environments with an implicit PUBLIC
-- target.
alter table public.profiles enable row level security;
alter table public.words enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (public.is_self_or_admin(id));

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using (public.is_self_or_admin(id))
with check (public.is_self_or_admin(id));

drop policy if exists profiles_insert_self_or_admin on public.profiles;
create policy profiles_insert_self_or_admin
on public.profiles
for insert
to authenticated
with check (public.is_self_or_admin(id));

drop policy if exists words_select_self_or_admin on public.words;
create policy words_select_self_or_admin
on public.words
for select
to authenticated
using (public.is_self_or_admin(user_id));

drop policy if exists words_insert_self_or_admin on public.words;
create policy words_insert_self_or_admin
on public.words
for insert
to authenticated
with check (public.is_self_or_admin(user_id));

drop policy if exists words_update_self_or_admin on public.words;
create policy words_update_self_or_admin
on public.words
for update
to authenticated
using (public.is_self_or_admin(user_id))
with check (public.is_self_or_admin(user_id));

drop policy if exists words_delete_self_or_admin on public.words;
create policy words_delete_self_or_admin
on public.words
for delete
to authenticated
using (public.is_self_or_admin(user_id));

-- PostgreSQL grants EXECUTE to PUBLIC by default. Trigger-only functions must
-- never be callable through the API, while the explicitly guarded RPC helpers
-- remain available to authenticated callers.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
revoke all on function public.admin_delete_user(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_role(uuid, text) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_self_or_admin(uuid) from public, anon, authenticated;
revoke all on function public.consume_ai_enrichment_quota(integer) from public, anon, authenticated;

grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_self_or_admin(uuid) to authenticated;
grant execute on function public.consume_ai_enrichment_quota(integer) to authenticated;

-- All function bodies reference application objects with explicit schemas, so
-- an empty search path prevents caller-controlled object shadowing.
alter function public.set_updated_at() set search_path to '';
alter function public.handle_new_user() set search_path to '';
alter function public.admin_delete_user(uuid) set search_path to '';
alter function public.admin_set_role(uuid, text) set search_path to '';
alter function public.is_admin() set search_path to '';
alter function public.is_self_or_admin(uuid) set search_path to '';
alter function public.consume_ai_enrichment_quota(integer) set search_path to '';

create table if not exists public.ai_enrichment_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default current_date,
  item_count integer not null default 0 check (item_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.ai_enrichment_usage enable row level security;

create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;

  lock table public.profiles in share row exclusive mode;
  if exists (
    select 1 from public.profiles where id = target_user_id and role = 'admin'
  ) and (
    select count(*) from public.profiles where role = 'admin'
  ) <= 1 then
    raise exception 'Cannot delete the final admin';
  end if;

  delete from public.words where user_id = target_user_id;
  delete from public.profiles where id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

create or replace function public.admin_set_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;

  if new_role not in ('user', 'admin') then
    raise exception 'Invalid role';
  end if;

  lock table public.profiles in share row exclusive mode;
  if new_role = 'user' and exists (
    select 1 from public.profiles where id = target_user_id and role = 'admin'
  ) and (
    select count(*) from public.profiles where role = 'admin'
  ) <= 1 then
    raise exception 'Cannot demote the final admin';
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;
end;
$$;

create or replace function public.consume_ai_enrichment_quota(requested_items integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
  next_count integer;
begin
  if requester_id is null or requested_items < 1 or requested_items > 4 then
    return false;
  end if;

  insert into public.ai_enrichment_usage (user_id, usage_date, item_count)
  values (requester_id, current_date, requested_items)
  on conflict (user_id, usage_date) do update
    set item_count = public.ai_enrichment_usage.item_count + excluded.item_count
    where public.ai_enrichment_usage.item_count + excluded.item_count <= 500
  returning item_count into next_count;

  return next_count is not null and next_count <= 500;
end;
$$;

grant usage on schema public to authenticated;

revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, email, name) on table public.profiles to authenticated;
grant update (name, legacy_html_seed_imported_at) on table public.profiles to authenticated;

grant select, insert, update, delete on table public.words to authenticated;
revoke all on table public.ai_enrichment_usage from anon, authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.admin_set_role(uuid, text) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_self_or_admin(uuid) from public;
revoke all on function public.consume_ai_enrichment_quota(integer) from public;

grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_self_or_admin(uuid) to authenticated;
grant execute on function public.consume_ai_enrichment_quota(integer) to authenticated;

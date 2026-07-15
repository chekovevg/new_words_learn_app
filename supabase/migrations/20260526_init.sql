create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  legacy_html_seed_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  word text not null,
  translation text not null,
  language text not null default 'English',
  level text,
  example text,
  source text,
  confidence double precision,
  enriched boolean not null default false,
  learned boolean not null default false,
  word_key text not null,
  language_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint words_user_word_language_unique unique (user_id, word_key, language_key)
);

create table if not exists public.ai_enrichment_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default current_date,
  item_count integer not null default 0 check (item_count >= 0),
  primary key (user_id, usage_date)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists words_set_updated_at on public.words;
create trigger words_set_updated_at
before update on public.words
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_name text;
begin
  raw_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, raw_name, 'user')
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.profiles.name, excluded.name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.is_self_or_admin(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = target_user_id or public.is_admin();
$$;

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

alter table public.profiles enable row level security;
alter table public.words enable row level security;
alter table public.ai_enrichment_usage enable row level security;

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

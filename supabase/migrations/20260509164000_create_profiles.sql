create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  has_completed_initial_migration boolean not null default false,
  initial_migrated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_profiles_updated_at();

insert into public.profiles (
  user_id,
  display_name,
  avatar_url,
  created_at,
  updated_at
)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'ReadRead User'),
  nullif(trim(u.raw_user_meta_data ->> 'avatar_url'), ''),
  coalesce(u.created_at, timezone('utc', now())),
  timezone('utc', now())
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    user_id,
    display_name,
    avatar_url
  )
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'ReadRead User'),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile public.profiles;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  insert into public.profiles (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  update public.profiles
  set last_seen_at = timezone('utc', now())
  where user_id = v_user_id;

  select *
  into v_profile
  from public.profiles
  where user_id = v_user_id;

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

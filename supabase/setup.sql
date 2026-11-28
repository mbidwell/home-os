-- Home OS · Supabase setup, slice 1
-- Safe to run more than once. Only CREATE / ALTER / ADD: nothing is dropped, truncated, or deleted.
-- Run in the Supabase SQL editor of a NEW project used only for Home OS.

-- 1. Household membership: the only users who can see anything.
create table if not exists public.household_members (
  user_id  uuid primary key references auth.users(id),
  added_at timestamptz not null default now()
);
alter table public.household_members enable row level security;

-- True when the signed-in user is one of the household members.
create or replace function public.is_household_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.household_members where user_id = auth.uid());
$$;
revoke execute on function public.is_household_member() from public, anon;
grant execute on function public.is_household_member() to authenticated;

-- 2. Profiles: display names, resolved at display time. Soft delete only.
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.profiles enable row level security;

-- 3. Policies (created only if missing). No anon access anywhere.
--    household_members has no insert/update/delete policy: you manage it here in SQL.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'household_members' and policyname = 'members can read members') then
    create policy "members can read members" on public.household_members
      for select to authenticated using (public.is_household_member());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'members can read profiles') then
    create policy "members can read profiles" on public.profiles
      for select to authenticated using (public.is_household_member());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'members add own profile') then
    create policy "members add own profile" on public.profiles
      for insert to authenticated with check (user_id = auth.uid() and public.is_household_member());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'members edit own profile') then
    create policy "members edit own profile" on public.profiles
      for update to authenticated
      using (user_id = auth.uid() and public.is_household_member())
      with check (user_id = auth.uid() and public.is_household_member());
  end if;
end $$;

revoke all on public.household_members from anon;
revoke all on public.profiles from anon;

-- Newer Supabase projects don't grant table access to signed-in users by default.
-- RLS above still limits every row to household members.
grant select on public.household_members to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- 4. Add the two household users (do this by hand, never commit real IDs).
--    Copy each user's ID from Authentication > Users, then run:
--
--    insert into public.household_members (user_id) values ('PASTE-USER-ID-HERE')
--    on conflict (user_id) do nothing;

-- Home OS · Supabase setup (slices 1 and 2)
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

-- 5. Slice 2: grocery list, staples + Costco list, kitchen (fridge / freezer / pantry).
create table if not exists public.grocery_items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  store          text check (store in ('costco', 'wegmans', 'publix', 'harris_teeter')),
  note           text check (note is null or char_length(note) <= 120),
  pantry_item_id uuid,
  checked_at     timestamptz,
  created_by     uuid default auth.uid() references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- One table for both browsable lists: list = 'staples' (grouped by store) or 'costco' (grouped by category).
create table if not exists public.staples (
  id         uuid primary key default gen_random_uuid(),
  list       text not null default 'staples' check (list in ('staples', 'costco')),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  store      text check (store in ('costco', 'wegmans', 'publix', 'harris_teeter')),
  category   text check (category is null or char_length(category) <= 30),
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.pantry_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  location   text not null default 'fridge' check (location in ('fridge', 'freezer', 'garage_freezer', 'pantry')),
  status     text not null default 'have' check (status in ('have', 'low', 'out')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Server keeps updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['grocery_items', 'staples', 'pantry_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create or replace trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);

    -- Household members can read, add, and edit. No delete policy: removal is a soft delete (deleted_at).
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read') then
      execute format('create policy "members read" on public.%I for select to authenticated using (public.is_household_member())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members add') then
      execute format('create policy "members add" on public.%I for insert to authenticated with check (public.is_household_member())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members edit') then
      execute format('create policy "members edit" on public.%I for update to authenticated using (public.is_household_member()) with check (public.is_household_member())', t);
    end if;

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);

    -- Live updates between the two phones.
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. Add the two household users (do this by hand, never commit real IDs).
--    Copy each user's ID from Authentication > Users, then run:
--
--    insert into public.household_members (user_id) values ('PASTE-USER-ID-HERE')
--    on conflict (user_id) do nothing;

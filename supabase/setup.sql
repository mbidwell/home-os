-- Home OS · Supabase setup (slices 1 to 4)
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

-- 6. Slice 3: chores and tasks. One open instance per chore lives on the row (due_date);
--    every done / skip / reset is kept in task_events.
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'chore' check (kind in ('chore', 'task')),
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  category      text check (category is null or char_length(category) <= 40), -- chore group or task list
  assignee      uuid references auth.users(id),                              -- null = either of us
  priority      boolean not null default false,
  notes         text check (notes is null or char_length(notes) <= 2000),
  howto         text check (howto is null or char_length(howto) <= 4000),    -- one step per line
  active        boolean not null default true,
  repeat_mode   text not null default 'after' check (repeat_mode in ('after', 'fixed', 'once')),
  every         int not null default 1 check (every between 1 and 365),
  unit          text not null default 'week' check (unit in ('day', 'week', 'month', 'year')),
  week_of_month smallint check (week_of_month between 1 and 4),
  weekday       smallint check (weekday between 0 and 6),
  months        smallint[],                                                  -- active months, null = all year
  anchor_date   date,
  due_date      date,
  done_at       timestamptz,                                                 -- one-off tasks
  created_by    uuid default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.task_events (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.tasks(id),
  kind     text not null check (kind in ('done', 'skip', 'reset')),
  due_date date,                                  -- the instance this event closed
  at       timestamptz not null default now(),
  by_user  uuid default auth.uid() references auth.users(id)
);
-- Two phones closing the same instance (or both pressing Sunday reset) record it once.
create unique index if not exists task_events_once on public.task_events (task_id, kind, due_date);

do $$
declare t text;
begin
  foreach t in array array['tasks', 'task_events'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read') then
      execute format('create policy "members read" on public.%I for select to authenticated using (public.is_household_member())', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members add') then
      execute format('create policy "members add" on public.%I for insert to authenticated with check (public.is_household_member())', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;

  -- tasks can be edited; history (task_events) is add-only.
  execute 'create or replace trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at()';
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'members edit') then
    create policy "members edit" on public.tasks for update to authenticated using (public.is_household_member()) with check (public.is_household_member());
  end if;
end $$;

alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
grant select, insert, update on public.tasks to authenticated;
grant select, insert on public.task_events to authenticated;

-- 7. Slice 4: daily view and calendar.
-- calendar_events is written only by the calendar-sync Edge Function (service role). The app can only read it.
-- It never holds descriptions, attendees, locations, or meeting links.
create table if not exists public.calendar_events (
  uid        text primary key,                       -- source + feed UID (+ instance date for repeats)
  source     text not null check (source in ('google', 'outlook')),
  kind       text not null check (kind in ('event', 'meeting', 'shift', 'event_shift')),
  title      text,                                   -- null for Outlook ("Work meeting")
  shift_type text check (shift_type in ('working', 'on_call')),
  site       text,
  all_day    boolean not null default false,
  start_date date not null,
  end_date   date not null,
  starts_at  timestamptz,
  ends_at    timestamptz,
  seen_at    timestamptz not null default now(),
  removed_at timestamptz,                            -- gone from the feed: kept, never deleted
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_dates on public.calendar_events (start_date, end_date);

create table if not exists public.calendar_sync (
  source          text primary key check (source in ('google', 'outlook')),
  last_attempt_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  event_count     int
);

-- Household day settings: one row.
create table if not exists public.day_settings (
  id              int primary key default 1 check (id = 1),
  nap_start       time not null default '13:00',
  nap_end         time not null default '16:00',
  dinner          time not null default '18:00',
  bed             time not null default '20:00',
  post_call_hours int  not null default 10 check (post_call_hours between 0 and 24),
  baby            jsonb not null default '[]'::jsonb,  -- unused (the baby has his own app)
  updated_at      timestamptz not null default now()
);
insert into public.day_settings (id) values (1) on conflict (id) do nothing;

-- Per-day changes: "today the nap is 2-4", "I got activated".
create table if not exists public.day_overrides (
  date           date primary key,
  nap_start      time,
  nap_end        time,
  activated_from timestamptz,
  activated_to   timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists public.kid_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('appointment', 'supply')),
  title      text not null check (char_length(btrim(title)) between 1 and 120),
  starts_at  timestamptz,                              -- appointments
  status     text check (status in ('have', 'low', 'out')), -- supplies
  notes      text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

do $$
declare t text;
begin
  -- Read-only to the app.
  foreach t in array array['calendar_events', 'calendar_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'members read') then
      execute format('create policy "members read" on public.%I for select to authenticated using (public.is_household_member())', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
  -- Editable by household members.
  foreach t in array array['day_settings', 'day_overrides', 'kid_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create or replace trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
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
  end loop;
  foreach t in array array['calendar_events', 'calendar_sync', 'day_settings', 'day_overrides', 'kid_items'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.calendar_events enable row level security;
alter table public.calendar_sync enable row level security;
alter table public.day_settings enable row level security;
alter table public.day_overrides enable row level security;
alter table public.kid_items enable row level security;
grant select on public.calendar_events, public.calendar_sync to authenticated;
grant select, insert, update on public.day_settings, public.day_overrides, public.kid_items to authenticated;
-- The calendar-sync function writes with the service role, which newer projects also don't grant by default.
grant select, insert, update on public.calendar_events, public.calendar_sync to service_role;

-- 7b. Toddler nap is a window (nap_start to nap_end, e.g. 1-4 PM) and a length; the actual nap is set per day.
alter table public.day_settings add column if not exists nap_minutes int not null default 120 check (nap_minutes between 15 and 300);

-- 9. Slice 5: recipes and the meal plan.
create table if not exists public.recipes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  ingredients text check (ingredients is null or char_length(ingredients) <= 8000), -- one per line
  steps       text check (steps is null or char_length(steps) <= 12000),
  source_url  text check (source_url is null or char_length(source_url) <= 500),
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- One row per meal slot ("2026-12-01:dinner"). Clearing a slot sets recipe_id and text to null.
create table if not exists public.meal_plan (
  slot       text primary key check (slot ~ '^\d{4}-\d{2}-\d{2}:(dinner|lunch)$'),
  date       date not null,
  meal       text not null check (meal in ('dinner', 'lunch')),
  recipe_id  uuid references public.recipes (id),
  text       text check (text is null or char_length(text) <= 120),
  updated_at timestamptz not null default now()
);
create index if not exists meal_plan_date on public.meal_plan (date);

-- A starred recipe: listed first, and Copy for AI asks for it again.
alter table public.recipes add column if not exists favorite boolean not null default false;
-- Tags: quick (30 minutes or less) and kids like it.
alter table public.recipes add column if not exists quick boolean not null default false;
alter table public.recipes add column if not exists kid_friendly boolean not null default false;
-- How it's cooked: stove, oven, sheet_pan, air_fryer, pressure_cooker, slow_cooker, grill, microwave, no_cook.
alter table public.recipes add column if not exists method text check (method is null or char_length(method) <= 30);
-- Grocery items added for a planned meal remember which one ("2026-12-01:dinner"), so clearing the meal takes them back.
alter table public.grocery_items add column if not exists from_slot text check (from_slot is null or char_length(from_slot) <= 20);
-- Planning a recipe adds what it needs to grocery (Settings can turn this off).
alter table public.day_settings add column if not exists auto_grocery boolean not null default true;

-- Lunch planning is off until someone turns it on in Settings.
alter table public.day_settings add column if not exists lunch_plan boolean not null default false;
-- What the kitchen cooks with, for Copy for AI (e.g. {oven,air_fryer}).
alter table public.day_settings add column if not exists appliances text[] not null default '{}';

do $$
declare t text;
begin
  foreach t in array array['recipes', 'meal_plan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create or replace trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
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
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 8. Calendar sync every 30 minutes (after deploying the calendar-sync function).
--    Replace PROJECT-REF with your project's ref (the part before .supabase.co).
--
--    create extension if not exists pg_cron;
--    create extension if not exists pg_net;
--    select cron.schedule('homeos-calendar-sync', '*/30 * * * *',
--      $$ select net.http_post(url := 'https://PROJECT-REF.supabase.co/functions/v1/calendar-sync', body := '{}'::jsonb) $$);

-- 4. Add the two household users (do this by hand, never commit real IDs).
--    Copy each user's ID from Authentication > Users, then run:
--
--    insert into public.household_members (user_id) values ('PASTE-USER-ID-HERE')
--    on conflict (user_id) do nothing;

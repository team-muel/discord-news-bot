-- 008: User CRM Foundation
-- Global user profiles + per-guild memberships + activity counters
-- Idempotent: safe to re-run

-- ============================================
-- 23. User CRM
-- ============================================

-- 23.1 Global user profile (cross-guild identity)
-- Discord-provided fields (username, avatar, etc.) are NOT stored here.
-- Read them via Discord API at query time. Only unique aggregated data lives here.
create table if not exists public.user_profiles (
  user_id text primary key,
  badges text[] not null default '{}',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_last_active
  on public.user_profiles (last_active_at desc);

create index if not exists idx_user_profiles_tags
  on public.user_profiles using gin (tags);

-- 23.2 Per-guild membership and activity counters
-- Discord-provided fields (nickname, joined_at, roles) are NOT stored here.
create table if not exists public.guild_memberships (
  guild_id text not null,
  user_id text not null,
  message_count bigint not null default 0,
  command_count bigint not null default 0,
  reaction_given_count bigint not null default 0,
  reaction_received_count bigint not null default 0,
  session_count bigint not null default 0,
  first_seen_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists idx_guild_memberships_user
  on public.guild_memberships (user_id, last_active_at desc);

create index if not exists idx_guild_memberships_guild_active
  on public.guild_memberships (guild_id, last_active_at desc);

create index if not exists idx_guild_memberships_guild_messages
  on public.guild_memberships (guild_id, message_count desc);

-- 23.3 Atomic activity increment RPC
-- Upserts user_profiles + guild_memberships in one call,
-- increments the specified counter column by delta.
create or replace function public.track_user_activity(
  p_user_id text,
  p_guild_id text,
  p_counter text default 'message_count',
  p_delta bigint default 1
)
returns void
language plpgsql
security definer
as $$
begin
  -- Upsert global profile (touch timestamps only)
  insert into public.user_profiles (user_id, last_active_at, updated_at)
  values (p_user_id, now(), now())
  on conflict (user_id) do update set
    last_active_at = now(),
    updated_at = now();

  -- Upsert guild membership and increment the specified counter
  if p_counter = 'message_count' then
    insert into public.guild_memberships (guild_id, user_id, message_count, last_active_at, updated_at)
    values (p_guild_id, p_user_id, p_delta, now(), now())
    on conflict (guild_id, user_id) do update set
      message_count = public.guild_memberships.message_count + p_delta,
      last_active_at = now(),
      updated_at = now();
  elsif p_counter = 'command_count' then
    insert into public.guild_memberships (guild_id, user_id, command_count, last_active_at, updated_at)
    values (p_guild_id, p_user_id, p_delta, now(), now())
    on conflict (guild_id, user_id) do update set
      command_count = public.guild_memberships.command_count + p_delta,
      last_active_at = now(),
      updated_at = now();
  elsif p_counter = 'reaction_given_count' then
    insert into public.guild_memberships (guild_id, user_id, reaction_given_count, last_active_at, updated_at)
    values (p_guild_id, p_user_id, p_delta, now(), now())
    on conflict (guild_id, user_id) do update set
      reaction_given_count = public.guild_memberships.reaction_given_count + p_delta,
      last_active_at = now(),
      updated_at = now();
  elsif p_counter = 'reaction_received_count' then
    insert into public.guild_memberships (guild_id, user_id, reaction_received_count, last_active_at, updated_at)
    values (p_guild_id, p_user_id, p_delta, now(), now())
    on conflict (guild_id, user_id) do update set
      reaction_received_count = public.guild_memberships.reaction_received_count + p_delta,
      last_active_at = now(),
      updated_at = now();
  elsif p_counter = 'session_count' then
    insert into public.guild_memberships (guild_id, user_id, session_count, last_active_at, updated_at)
    values (p_guild_id, p_user_id, p_delta, now(), now())
    on conflict (guild_id, user_id) do update set
      session_count = public.guild_memberships.session_count + p_delta,
      last_active_at = now(),
      updated_at = now();
  else
    -- Unknown counter: just touch timestamps (ensure user exists)
    insert into public.guild_memberships (guild_id, user_id, last_active_at, updated_at)
    values (p_guild_id, p_user_id, now(), now())
    on conflict (guild_id, user_id) do update set
      last_active_at = now(),
      updated_at = now();
  end if;
end;
$$;

-- 23.4 RLS
alter table public.user_profiles enable row level security;
alter table public.guild_memberships enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='user_profiles_service_role'
  ) then
    create policy user_profiles_service_role on public.user_profiles
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='guild_memberships' and policyname='guild_memberships_service_role'
  ) then
    create policy guild_memberships_service_role on public.guild_memberships
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$$;

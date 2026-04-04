-- Migration: Add thread context columns to Discord data tables
-- Apply in Supabase SQL Editor (idempotent)
-- Purpose: Distinguish thread vs channel, preserve parent hierarchy

-- ── memory_sources: add thread context ────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_sources'
      and column_name = 'channel_type'
  ) then
    alter table public.memory_sources add column channel_type text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_sources'
      and column_name = 'parent_channel_id'
  ) then
    alter table public.memory_sources add column parent_channel_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_sources'
      and column_name = 'is_thread'
  ) then
    alter table public.memory_sources add column is_thread boolean default false;
  end if;
end $$;

-- ── community_interaction_events: add thread context ──────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_interaction_events'
      and column_name = 'channel_type'
  ) then
    alter table public.community_interaction_events add column channel_type text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_interaction_events'
      and column_name = 'parent_channel_id'
  ) then
    alter table public.community_interaction_events add column parent_channel_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_interaction_events'
      and column_name = 'is_thread'
  ) then
    alter table public.community_interaction_events add column is_thread boolean default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_interaction_events'
      and column_name = 'is_private_thread'
  ) then
    alter table public.community_interaction_events add column is_private_thread boolean default false;
  end if;
end $$;

-- ── memory_items: add thread context ──────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_items'
      and column_name = 'parent_channel_id'
  ) then
    alter table public.memory_items add column parent_channel_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memory_items'
      and column_name = 'is_thread'
  ) then
    alter table public.memory_items add column is_thread boolean default false;
  end if;
end $$;

-- ── Indexes for thread queries ────────────────────────────────────────────────
create index if not exists idx_memory_sources_parent_channel
  on public.memory_sources (parent_channel_id)
  where parent_channel_id is not null;

create index if not exists idx_community_events_parent_channel
  on public.community_interaction_events (parent_channel_id)
  where parent_channel_id is not null;

create index if not exists idx_memory_items_parent_channel
  on public.memory_items (parent_channel_id)
  where parent_channel_id is not null;

-- Migration: Ventyd Event Sourcing Tables for Sprint Pipelines
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Safe to re-run (uses IF NOT EXISTS)

-- 1. Event store — append-only log for all sprint pipeline events
create table if not exists public.ventyd_events (
  event_id text primary key,
  event_name text not null,
  entity_name text not null,
  entity_id text not null,
  body jsonb not null default '{}'::jsonb,
  event_created_at timestamptz not null default now(),
  version integer,

  -- Metadata for diagnostics
  created_at timestamptz not null default now()
);

comment on table public.ventyd_events is
  'Ventyd event sourcing store — immutable append-only event log for sprint pipelines';

-- Composite index: fast event replay per entity
create index if not exists idx_ventyd_events_entity
  on public.ventyd_events (entity_name, entity_id, event_created_at asc);

-- Index: query events by type (for audit / analytics)
create index if not exists idx_ventyd_events_name
  on public.ventyd_events (event_name, event_created_at desc);

-- Unique constraint on event_id ensures idempotent inserts
-- (inherent from PK, but explicitly noted for adapter design)

-- 2. RLS: only service_role can write/read event store
alter table public.ventyd_events enable row level security;

-- Drop+create to be idempotent
drop policy if exists "service_role_all_ventyd_events" on public.ventyd_events;
create policy "service_role_all_ventyd_events"
  on public.ventyd_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

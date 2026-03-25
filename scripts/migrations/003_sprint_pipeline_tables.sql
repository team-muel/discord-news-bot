-- Migration: Sprint Pipeline Persistence Tables
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Depends on: public.set_updated_at() function (created in base schema)
-- Safe to re-run (uses IF NOT EXISTS)

-- 1. Sprint pipelines (state machine persistence)
create table if not exists public.sprint_pipelines (
  sprint_id text primary key,
  trigger_id text,
  trigger_type text not null default 'manual',
  guild_id text,
  objective text,
  autonomy_level text not null default 'approve-ship',
  current_phase text not null default 'plan',
  phase_results jsonb default '{}'::jsonb,
  phase_order text[] default array['plan','implement','review','qa','ops-validate','ship','retro'],
  changed_files text[] default array[]::text[],
  total_phases_executed integer not null default 0,
  impl_review_loop_count integer not null default 0,
  max_impl_review_loops integer not null default 3,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_sprint_pipelines_phase
  on public.sprint_pipelines (current_phase, created_at desc);

create index if not exists idx_sprint_pipelines_guild
  on public.sprint_pipelines (guild_id, created_at desc);

drop trigger if exists trg_sprint_pipelines_updated_at on public.sprint_pipelines;
create trigger trg_sprint_pipelines_updated_at
before update on public.sprint_pipelines
for each row
execute function public.set_updated_at();

-- 2. Sprint journal entries (Supabase fallback for learning journal)
create table if not exists public.sprint_journal_entries (
  sprint_id text primary key,
  guild_id text not null default 'system',
  objective text,
  content text not null,
  tags text[] default array[]::text[],
  total_phases integer not null default 0,
  implement_review_loops integer not null default 0,
  changed_files text[] default array[]::text[],
  failed_phases text[] default array[]::text[],
  succeeded_phases text[] default array[]::text[],
  phase_timings jsonb default '{}'::jsonb,
  optimize_hints text[] default array[]::text[],
  bench_results text[] default array[]::text[],
  retro_output text,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_sprint_journal_entries_completed
  on public.sprint_journal_entries (completed_at desc);

create index if not exists idx_sprint_journal_entries_guild
  on public.sprint_journal_entries (guild_id, completed_at desc);

-- 3. RLS policies
alter table public.sprint_pipelines enable row level security;
alter table public.sprint_journal_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='sprint_pipelines' and policyname='sprint_pipelines_service_role'
  ) then
    create policy sprint_pipelines_service_role on public.sprint_pipelines
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='sprint_journal_entries' and policyname='sprint_journal_entries_service_role'
  ) then
    create policy sprint_journal_entries_service_role on public.sprint_journal_entries
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$$;

-- Migration: runtime service-table policy normalization
-- Date: 2026-04-11
-- Purpose:
--   1. Close low-ambiguity RLS gaps on runtime service tables
--   2. Replace the remaining always-true user_learning_prefs policy
--   3. Record the slice in public.schema_migrations when available
--
-- Safe to re-run.

alter table if exists public.api_idempotency_keys enable row level security;
alter table if exists public.api_rate_limits enable row level security;
alter table if exists public.discord_login_sessions enable row level security;
alter table if exists public.distributed_locks enable row level security;
alter table if exists public.schema_migrations enable row level security;
alter table if exists public.agent_telemetry_queue_tasks enable row level security;
alter table if exists public.user_learning_prefs enable row level security;

drop policy if exists "user can manage own prefs" on public.user_learning_prefs;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'api_idempotency_keys'
      and policyname = 'api_idempotency_keys_service_role_all'
  ) then
    create policy api_idempotency_keys_service_role_all on public.api_idempotency_keys
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'api_rate_limits'
      and policyname = 'api_rate_limits_service_role_all'
  ) then
    create policy api_rate_limits_service_role_all on public.api_rate_limits
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'discord_login_sessions'
      and policyname = 'discord_login_sessions_service_role_all'
  ) then
    create policy discord_login_sessions_service_role_all on public.discord_login_sessions
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'distributed_locks'
      and policyname = 'distributed_locks_service_role_all'
  ) then
    create policy distributed_locks_service_role_all on public.distributed_locks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'schema_migrations'
      and policyname = 'schema_migrations_service_role_all'
  ) then
    create policy schema_migrations_service_role_all on public.schema_migrations
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_telemetry_queue_tasks'
      and policyname = 'agent_telemetry_queue_tasks_service_role_all'
  ) then
    create policy agent_telemetry_queue_tasks_service_role_all on public.agent_telemetry_queue_tasks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_learning_prefs'
      and policyname = 'user_learning_prefs_service_role_all'
  ) then
    create policy user_learning_prefs_service_role_all on public.user_learning_prefs
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$$;

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (name, applied_by)
    values ('MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES', 'manual')
    on conflict (name) do nothing;
  end if;
end
$$;
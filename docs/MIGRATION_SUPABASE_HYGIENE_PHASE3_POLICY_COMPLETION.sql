-- Migration: Supabase hygiene phase 3 policy completion
-- Date: 2026-04-11
-- Purpose:
--   1. Close the remaining policyless RLS tables with explicit service_role ownership
--   2. Tighten obsidian_cache from world-readable to service_role-only
--   3. Record the slice in public.schema_migrations when available
--
-- Safe to re-run.

do $$
declare
  target_table text;
  target_tables text[] := array[
    'agent_sessions',
    'agent_steps',
    'alert_slots',
    'bot_state',
    'candles',
    'error_history',
    'guild_lore_docs',
    'logs',
    'macro_data',
    'macro_series',
    'market_regime',
    'news_capture_fingerprints',
    'news_sentiment',
    'obsidian_metadata',
    'research_preset_audit',
    'research_presets',
    'settings',
    'sources',
    'system_error_events',
    'system_telemetry',
    'trades',
    'trading_engine_configs',
    'trading_signals',
    'user_embeddings',
    'user_roles',
    'users',
    'youtube_log'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = target_table || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using ((select auth.role()) = ''service_role'') with check ((select auth.role()) = ''service_role'')',
        target_table || '_service_role_all',
        target_table
      );
    end if;
  end loop;
end
$$;

alter table if exists public.obsidian_cache enable row level security;

drop policy if exists cache_read on public.obsidian_cache;
drop policy if exists cache_write on public.obsidian_cache;
drop policy if exists cache_update on public.obsidian_cache;
drop policy if exists obsidian_cache_service_role_all on public.obsidian_cache;

create policy obsidian_cache_service_role_all on public.obsidian_cache
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

revoke all on public.obsidian_cache from anon;
revoke all on public.obsidian_cache from authenticated;
grant select, insert, update, delete on public.obsidian_cache to service_role;

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (name, applied_by)
    values ('MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION', 'manual')
    on conflict (name) do nothing;
  end if;
end
$$;
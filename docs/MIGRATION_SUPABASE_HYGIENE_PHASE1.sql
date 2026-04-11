-- Migration: Supabase hygiene phase 1
-- Date: 2026-04-11
-- Purpose:
--   1. Normalize the highest-risk permissive RLS policies
--   2. Remove the known duplicate ventyd_events policy
--   3. Pin search_path on the current mutable-function set
--   4. Add the live missing covering FK indexes
--
-- Safe to re-run.
-- Intentionally does NOT drop unused indexes yet.

-- =====================================
-- 1. Policy normalization
-- =====================================

alter table public.memory_items enable row level security;
alter table public.intents enable row level security;
alter table public.agent_trust_scores enable row level security;
alter table public.obsidian_query_log enable row level security;
alter table public.ventyd_events enable row level security;

drop policy if exists memory_items_guild_select on public.memory_items;
drop policy if exists memory_items_guild_write on public.memory_items;
drop policy if exists memory_items_guild_insert on public.memory_items;
drop policy if exists memory_items_guild_update on public.memory_items;
drop policy if exists memory_items_guild_delete on public.memory_items;

create policy memory_items_guild_select on public.memory_items
  for select
  using (
    (select auth.role()) = 'service_role'
    or guild_id = coalesce((select auth.jwt() ->> 'guild_id'), '')
  );

create policy memory_items_guild_insert on public.memory_items
  for insert
  with check (
    (select auth.role()) = 'service_role'
    or guild_id = coalesce((select auth.jwt() ->> 'guild_id'), '')
  );

create policy memory_items_guild_update on public.memory_items
  for update
  using (
    (select auth.role()) = 'service_role'
    or guild_id = coalesce((select auth.jwt() ->> 'guild_id'), '')
  )
  with check (
    (select auth.role()) = 'service_role'
    or guild_id = coalesce((select auth.jwt() ->> 'guild_id'), '')
  );

create policy memory_items_guild_delete on public.memory_items
  for delete
  using (
    (select auth.role()) = 'service_role'
    or guild_id = coalesce((select auth.jwt() ->> 'guild_id'), '')
  );

drop policy if exists intents_service_role_all on public.intents;
create policy intents_service_role_all on public.intents
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists trust_scores_service_role_all on public.agent_trust_scores;
create policy trust_scores_service_role_all on public.agent_trust_scores
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists query_log_read on public.obsidian_query_log;
drop policy if exists query_log_write on public.obsidian_query_log;

create policy query_log_read on public.obsidian_query_log
  for select
  using ((select auth.role()) = 'service_role');

create policy query_log_write on public.obsidian_query_log
  for insert
  with check ((select auth.role()) = 'service_role');

drop policy if exists service_role_all_ventyd_events on public.ventyd_events;
drop policy if exists ventyd_events_service_role on public.ventyd_events;

create policy ventyd_events_service_role on public.ventyd_events
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

revoke all on public.obsidian_query_log from anon;
revoke all on public.obsidian_query_log from authenticated;
grant select, insert on public.obsidian_query_log to service_role;

-- =====================================
-- 2. Missing covering FK indexes
-- =====================================

create index if not exists idx_agent_conversation_threads_last_session_id
  on public.agent_conversation_threads (last_session_id);

create index if not exists idx_agent_got_selection_events_candidate_node_id
  on public.agent_got_selection_events (candidate_node_id);

create index if not exists idx_agent_opencode_change_requests_source_action_log_id
  on public.agent_opencode_change_requests (source_action_log_id);

create index if not exists idx_agent_tool_learning_rules_source_candidate_id
  on public.agent_tool_learning_rules (source_candidate_id);

create index if not exists idx_alert_slots_user_id
  on public.alert_slots (user_id);

create index if not exists idx_error_history_source_id
  on public.error_history (source_id);

create index if not exists idx_logs_user_id
  on public.logs (user_id);

create index if not exists idx_memory_conflicts_item_a_id
  on public.memory_conflicts (item_a_id);

create index if not exists idx_memory_conflicts_item_b_id
  on public.memory_conflicts (item_b_id);

create index if not exists idx_retrieval_eval_runs_eval_set_id
  on public.retrieval_eval_runs (eval_set_id);

create index if not exists idx_retrieval_ranker_experiments_run_id
  on public.retrieval_ranker_experiments (run_id);

create index if not exists idx_sources_user_id
  on public.sources (user_id);

-- =====================================
-- 3. Pin search_path on mutable functions
-- =====================================

do $$
declare
  fn record;
  target_path text;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'set_updated_at',
        'acquire_rate_limit',
        'increment_obsidian_cache_hit',
        'cleanup_discord_login_sessions',
        'clear_expired_obsidian_cache',
        'get_platform_hypopg_candidates',
        'acquire_distributed_lease',
        'track_user_activity',
        'ensure_pg_cron_job',
        'get_platform_extension_status',
        'cleanup_agent_llm_call_logs',
        'cleanup_api_idempotency_keys',
        'update_intents_updated_at',
        'log_source_error',
        'search_memory_items_hybrid',
        'delete_orphaned_source'
      )
  loop
    target_path := case
      when fn.function_name in (
        'ensure_pg_cron_job',
        'get_platform_extension_status',
        'get_platform_hypopg_candidates'
      ) then 'public, pg_catalog, extensions'
      else 'public, extensions'
    end;

    execute format(
      'alter function %I.%I(%s) set search_path = %s',
      fn.schema_name,
      fn.function_name,
      fn.identity_args,
      target_path
    );
  end loop;
end
$$;

-- =====================================
-- 4. Track migration when schema_migrations exists
-- =====================================

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (name, applied_by)
    values ('MIGRATION_SUPABASE_HYGIENE_PHASE1', 'manual')
    on conflict (name) do nothing;
  end if;
end
$$;
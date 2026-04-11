-- COMBINED MIGRATION SCRIPT\n-- Run this in Supabase Studio SQL Editor\n-- Each migration is safe to re-run (IF NOT EXISTS)\n\n-- =====================================\n-- MIGRATION_SCHEMA_TRACKING\n-- =====================================\n-- Migration tracking table for Supabase schema migrations
-- Apply this FIRST before using the migration tracking system
-- Safe to re-run (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT,
  applied_by TEXT DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(name);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

COMMENT ON TABLE schema_migrations IS 'Tracks which SQL migrations have been applied to this database';
COMMENT ON COLUMN schema_migrations.name IS 'Migration file name (e.g. MIGRATION_THREAD_CONTEXT_COLUMNS)';
COMMENT ON COLUMN schema_migrations.checksum IS 'SHA256 of the migration file content at apply time';
COMMENT ON COLUMN schema_migrations.applied_by IS 'Who applied: manual, cli, or ci';\n\n-- =====================================\n-- MIGRATION_THREAD_CONTEXT_COLUMNS\n-- =====================================\n-- Migration: Add thread context columns to Discord data tables
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
  where parent_channel_id is not null;\n\n-- =====================================\n-- OBSIDIAN_HEADLESS_MIGRATION\n-- =====================================\n-- Obsidian RAG Cache Tables
-- Created: 2026-03-14

-- Obsidian document cache
-- Stores frequently accessed vault files with TTL-based eviction
CREATE TABLE IF NOT EXISTS obsidian_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  frontmatter JSONB DEFAULT '{}',
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_accessed_at TIMESTAMP WITH TIME ZONE,
  hit_count INTEGER DEFAULT 0,
  CONSTRAINT valid_cache_ttl CHECK (cached_at > now() - interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_obsidian_cache_file_path ON obsidian_cache(file_path);
CREATE INDEX IF NOT EXISTS idx_obsidian_cache_cached_at ON obsidian_cache(cached_at DESC);
CREATE INDEX IF NOT EXISTS idx_obsidian_cache_hit_count ON obsidian_cache(hit_count DESC);

-- Obsidian graph metadata
-- Stores vault structure: titles, tags, relationships (for fast routing)
CREATE TABLE IF NOT EXISTS obsidian_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  title TEXT,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  backlinks TEXT[] DEFAULT '{}',
  links TEXT[] DEFAULT '{}',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT valid_sync CHECK (synced_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_file_path ON obsidian_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_category ON obsidian_metadata(category);
CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_tags ON obsidian_metadata USING GIN(tags);

-- Obsidian RAG query log
-- Tracks queries for analytics and performance tuning
CREATE TABLE IF NOT EXISTS obsidian_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT,
  user_id TEXT,
  question TEXT NOT NULL,
  inferred_intent TEXT,
  document_count INTEGER,
  document_paths TEXT[] DEFAULT '{}',
  response_tokens INTEGER,
  execution_time_ms INTEGER,
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_created_at ON obsidian_query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_guild_id ON obsidian_query_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_intent ON obsidian_query_log(inferred_intent);

-- Enable RLS for cache (optional, admin-only write)
ALTER TABLE obsidian_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE obsidian_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE obsidian_query_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Policy: Anyone can read cache (world-readable)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_cache' AND policyname = 'cache_read'
  ) THEN
    CREATE POLICY cache_read ON obsidian_cache FOR SELECT USING (true);
  END IF;

  -- Policy: Only service role can write cache
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_cache' AND policyname = 'cache_write'
  ) THEN
    CREATE POLICY cache_write ON obsidian_cache FOR INSERT WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_cache' AND policyname = 'cache_update'
  ) THEN
    CREATE POLICY cache_update ON obsidian_cache FOR UPDATE USING (auth.role() = 'service_role');
  END IF;

  -- Policy: Log reads
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_query_log' AND policyname = 'query_log_read'
  ) THEN
    CREATE POLICY query_log_read ON obsidian_query_log FOR SELECT USING (true);
  END IF;

  -- Policy: Anyone can insert logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_query_log' AND policyname = 'query_log_write'
  ) THEN
    CREATE POLICY query_log_write ON obsidian_query_log FOR INSERT WITH CHECK (true);
  END IF;
END
$$;

-- Function: Auto-clear expired cache entries (optional, call periodically)
CREATE OR REPLACE FUNCTION clear_expired_obsidian_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM obsidian_cache
  WHERE cached_at < (now() - interval '1 hour');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant privileges
GRANT SELECT ON obsidian_cache TO anon, authenticated;
GRANT INSERT, UPDATE ON obsidian_cache TO service_role;
GRANT SELECT, INSERT ON obsidian_query_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON obsidian_metadata TO service_role;\n\n-- =====================================\n-- MIGRATION_OBSIDIAN_CACHE_HIT_INCREMENT\n-- =====================================\n-- Migration: Atomic hit_count increment for obsidian_cache
-- Date: 2026-04-04
-- Purpose: Eliminate N+1 SELECT+UPDATE pattern in flushHitCounts.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION increment_obsidian_cache_hit(
  p_file_path TEXT,
  p_increment INT DEFAULT 1,
  p_accessed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE obsidian_cache
  SET hit_count = hit_count + p_increment,
      last_accessed_at = p_accessed_at
  WHERE file_path = p_file_path;
$$;\n\n-- =====================================\n-- MIGRATION_DEDUPE_LEARNING\n-- =====================================\n-- Migration: Persistent dedupe + User learning preferences
-- Run in Supabase SQL Editor (or via supabase db push if using CLI)
-- Created: 2025

-- ═══════════════════════════════════════════════
-- 1. news_capture_fingerprints
--    영속 뉴스 수집 dedupe 테이블
--    재시작 후에도 중복 수집 방지
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS news_capture_fingerprints (
  id            bigserial    PRIMARY KEY,
  guild_id      text         NOT NULL,
  fingerprint   text         NOT NULL,
  goal_preview  text,
  expires_at    timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_news_fingerprint UNIQUE (guild_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_nfp_guild_fp
  ON news_capture_fingerprints (guild_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_nfp_expires
  ON news_capture_fingerprints (expires_at)
  WHERE expires_at IS NOT NULL;

-- Auto-purge expired rows (optional: add pg_cron job)
-- SELECT cron.schedule('purge-news-fingerprints', '0 3 * * *',
--   $$DELETE FROM news_capture_fingerprints WHERE expires_at < now()$$);

-- ═══════════════════════════════════════════════
-- 2. user_learning_prefs
--    유저별 학습 자동 저장 on/off 토글
--    기본값: enabled = true (옵트인)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_learning_prefs (
  user_id     text         NOT NULL,
  guild_id    text         NOT NULL,
  enabled     boolean      NOT NULL DEFAULT true,
  updated_by  text,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_user_learning_prefs PRIMARY KEY (user_id, guild_id)
);

-- RLS: 사용자는 자신의 행만 조회/수정 가능
ALTER TABLE user_learning_prefs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_learning_prefs'
      AND policyname = 'user can manage own prefs'
  ) THEN
    CREATE POLICY "user can manage own prefs"
      ON user_learning_prefs
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- ═══════════════════════════════════════════════
-- 완료 확인
-- ═══════════════════════════════════════════════
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_name IN ('news_capture_fingerprints', 'user_learning_prefs')
  AND table_schema = 'public';\n\n-- =====================================\n-- MIGRATION_DISTRIBUTED_LOCK_RPC\n-- =====================================\n-- Migration: Atomic distributed lease acquisition via RPC
-- Replaces the TOCTOU-vulnerable two-step UPDATE -> INSERT pattern
-- with a single INSERT ... ON CONFLICT ... DO UPDATE ... WHERE statement.
--
-- Apply BEFORE deploying the code that calls this function.
-- The code includes a legacy fallback, so deploying code first is safe but suboptimal.

create or replace function public.acquire_distributed_lease(
  p_name text,
  p_owner text,
  p_lease_ms integer
)
returns boolean
language plpgsql
as $$
declare
  v_lease_until timestamptz := now() + make_interval(secs => greatest(5000, p_lease_ms) / 1000.0);
begin
  -- Single atomic statement: INSERT if new, UPDATE if unlocked/expired/re-entrant.
  -- PostgreSQL row-level locking ensures only one concurrent caller succeeds.
  insert into public.distributed_locks (name, owner_token, expires_at, updated_at)
  values (p_name, p_owner, v_lease_until, now())
  on conflict (name) do update
    set owner_token = p_owner,
        expires_at  = v_lease_until,
        updated_at  = now()
    where
      distributed_locks.owner_token is null
      or distributed_locks.expires_at < now()
      or distributed_locks.owner_token = p_owner;

  return found;
end;
$$;\n\n
-- =====================================
-- MIGRATION_SUPABASE_HYGIENE_PHASE1
-- =====================================
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
-- MIGRATION_AUTONOMY_REPORTING_BASELINE
-- =====================================
-- Migration: autonomy reporting baseline

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.memory_jobs (
  id text primary key,
  guild_id text not null,
  job_type text not null,
  status text not null default 'queued',
  next_attempt_at timestamptz not null default now(),
  window_started_at timestamptz,
  window_ended_at timestamptz,
  input jsonb,
  output jsonb,
  error text,
  deadlettered_at timestamptz,
  deadletter_reason text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (job_type in ('short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot', 'consolidation')),
  check (status in ('queued', 'running', 'completed', 'failed', 'canceled'))
);

alter table public.memory_jobs add column if not exists next_attempt_at timestamptz;
alter table public.memory_jobs add column if not exists deadlettered_at timestamptz;
alter table public.memory_jobs add column if not exists deadletter_reason text;

update public.memory_jobs
set next_attempt_at = coalesce(next_attempt_at, created_at, now())
where next_attempt_at is null;

alter table public.memory_jobs alter column next_attempt_at set default now();
alter table public.memory_jobs alter column next_attempt_at set not null;

alter table public.memory_jobs drop constraint if exists memory_jobs_job_type_check;
alter table public.memory_jobs
  add constraint memory_jobs_job_type_check
  check (job_type in ('short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot', 'consolidation'));

create index if not exists idx_memory_jobs_guild_status_created
  on public.memory_jobs (guild_id, status, created_at desc);

create index if not exists idx_memory_jobs_type_status
  on public.memory_jobs (job_type, status, created_at desc);

create index if not exists idx_memory_jobs_status_next_attempt
  on public.memory_jobs (status, next_attempt_at asc)
  where status = 'queued';

drop trigger if exists trg_memory_jobs_updated_at on public.memory_jobs;
create trigger trg_memory_jobs_updated_at
before update on public.memory_jobs
for each row
execute function public.set_updated_at();

create table if not exists public.memory_job_deadletters (
  id bigint generated by default as identity primary key,
  job_id text,
  guild_id text not null,
  job_type text not null,
  attempts integer not null,
  error text not null,
  input jsonb,
  output jsonb,
  recovery_status text not null default 'pending',
  recovery_attempts integer not null default 0,
  recovered_at timestamptz,
  last_recovery_error text,
  failed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (job_type in ('short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot', 'consolidation')),
  check (recovery_status in ('pending', 'requeued', 'ignored')),
  check (recovery_attempts >= 0)
);

alter table public.memory_job_deadletters add column if not exists recovery_status text;
alter table public.memory_job_deadletters add column if not exists recovery_attempts integer;
alter table public.memory_job_deadletters add column if not exists recovered_at timestamptz;
alter table public.memory_job_deadletters add column if not exists last_recovery_error text;
alter table public.memory_job_deadletters add column if not exists updated_at timestamptz;

update public.memory_job_deadletters
set recovery_status = coalesce(recovery_status, 'pending')
where recovery_status is null;

update public.memory_job_deadletters
set recovery_attempts = coalesce(recovery_attempts, 0)
where recovery_attempts is null;

update public.memory_job_deadletters
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.memory_job_deadletters alter column recovery_status set default 'pending';
alter table public.memory_job_deadletters alter column recovery_status set not null;
alter table public.memory_job_deadletters alter column recovery_attempts set default 0;
alter table public.memory_job_deadletters alter column recovery_attempts set not null;
alter table public.memory_job_deadletters alter column updated_at set default now();
alter table public.memory_job_deadletters alter column updated_at set not null;

alter table public.memory_job_deadletters drop constraint if exists memory_job_deadletters_job_type_check;
alter table public.memory_job_deadletters
  add constraint memory_job_deadletters_job_type_check
  check (job_type in ('short_summary', 'topic_synthesis', 'durable_extraction', 'reindex', 'conflict_scan', 'onboarding_snapshot', 'consolidation'));

create index if not exists idx_memory_job_deadletters_guild_created
  on public.memory_job_deadletters (guild_id, created_at desc);

create index if not exists idx_memory_job_deadletters_job_id
  on public.memory_job_deadletters (job_id);

create index if not exists idx_memory_job_deadletters_recovery
  on public.memory_job_deadletters (recovery_status, created_at desc);

drop trigger if exists trg_memory_job_deadletters_updated_at on public.memory_job_deadletters;
create trigger trg_memory_job_deadletters_updated_at
before update on public.memory_job_deadletters
for each row
execute function public.set_updated_at();

create table if not exists public.agent_llm_call_logs (
  id bigint generated by default as identity primary key,
  guild_id text,
  session_id text,
  requested_by text,
  action_name text,
  provider text not null,
  model text,
  experiment_name text,
  experiment_arm text,
  experiment_key_hash text,
  latency_ms integer not null default 0,
  success boolean not null default true,
  error_code text,
  prompt_chars integer not null default 0,
  output_chars integer not null default 0,
  avg_logprob numeric(10, 6),
  estimated_cost_usd numeric(12, 6),
  created_at timestamptz not null default now(),
  check (latency_ms >= 0),
  check (prompt_chars >= 0),
  check (output_chars >= 0),
  check (estimated_cost_usd is null or estimated_cost_usd >= 0)
);

create index if not exists idx_agent_llm_call_logs_guild_created
  on public.agent_llm_call_logs (guild_id, created_at desc);

create index if not exists idx_agent_llm_call_logs_provider_created
  on public.agent_llm_call_logs (provider, created_at desc);

create index if not exists idx_agent_llm_call_logs_experiment
  on public.agent_llm_call_logs (experiment_name, experiment_arm, created_at desc);

create table if not exists public.agent_weekly_reports (
  id bigint generated by default as identity primary key,
  report_key text not null unique,
  report_kind text not null,
  guild_id text,
  provider text,
  action_prefix text,
  baseline_from timestamptz,
  baseline_to timestamptz,
  candidate_from timestamptz,
  candidate_to timestamptz,
  baseline_summary jsonb not null default '{}'::jsonb,
  candidate_summary jsonb not null default '{}'::jsonb,
  delta_summary jsonb not null default '{}'::jsonb,
  top_actions jsonb not null default '{}'::jsonb,
  markdown text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (report_kind in ('llm_latency_weekly', 'go_no_go_weekly', 'hybrid_weekly', 'rollback_rehearsal_weekly', 'memory_queue_weekly', 'self_improvement_patterns', 'jarvis_optimize_result', 'cross_loop_origin', 'convergence_report'))
);

alter table public.agent_weekly_reports drop constraint if exists agent_weekly_reports_report_kind_check;
alter table public.agent_weekly_reports
  add constraint agent_weekly_reports_report_kind_check
  check (
    report_kind in (
      'llm_latency_weekly',
      'go_no_go_weekly',
      'hybrid_weekly',
      'rollback_rehearsal_weekly',
      'memory_queue_weekly',
      'self_improvement_patterns',
      'jarvis_optimize_result',
      'cross_loop_origin',
      'convergence_report'
    )
  );

create index if not exists idx_agent_weekly_reports_kind_created
  on public.agent_weekly_reports (report_kind, created_at desc);

create index if not exists idx_agent_weekly_reports_guild_created
  on public.agent_weekly_reports (guild_id, created_at desc);

drop trigger if exists trg_agent_weekly_reports_updated_at on public.agent_weekly_reports;
create trigger trg_agent_weekly_reports_updated_at
before update on public.agent_weekly_reports
for each row
execute function public.set_updated_at();

alter table public.memory_jobs enable row level security;
alter table public.memory_job_deadletters enable row level security;
alter table public.agent_llm_call_logs enable row level security;
alter table public.agent_weekly_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'memory_jobs'
      and policyname = 'memory_jobs_guild_all'
  ) then
    create policy memory_jobs_guild_all on public.memory_jobs
      for all
      using (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''))
      with check (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'memory_job_deadletters'
      and policyname = 'memory_deadletters_guild_all'
  ) then
    create policy memory_deadletters_guild_all on public.memory_job_deadletters
      for all
      using (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''))
      with check (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_llm_call_logs'
      and policyname = 'agent_llm_call_logs_guild_all'
  ) then
    create policy agent_llm_call_logs_guild_all on public.agent_llm_call_logs
      for all
      using (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''))
      with check (auth.role() = 'service_role' or guild_id = coalesce(auth.jwt() ->> 'guild_id', ''));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_weekly_reports'
      and policyname = 'agent_weekly_reports_guild_all'
  ) then
    create policy agent_weekly_reports_guild_all on public.agent_weekly_reports
      for all
      using (auth.role() = 'service_role' or coalesce(guild_id, '') = coalesce(auth.jwt() ->> 'guild_id', ''))
      with check (auth.role() = 'service_role' or coalesce(guild_id, '') = coalesce(auth.jwt() ->> 'guild_id', ''));
  end if;
end
$$;

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (name, applied_by)
    values ('MIGRATION_AUTONOMY_REPORTING_BASELINE', 'manual')
    on conflict (name) do nothing;
  end if;
end
$$;

-- =====================================
-- MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES
-- =====================================
-- Migration: runtime service-table policy normalization

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

-- =====================================
-- MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION
-- =====================================
-- Migration: Supabase hygiene phase 3 policy completion

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

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    insert into public.schema_migrations (name, applied_by)
    values ('MIGRATION_SUPABASE_HYGIENE_PHASE1', 'manual')
    on conflict (name) do nothing;
  end if;
end
$$;
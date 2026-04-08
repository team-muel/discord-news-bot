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
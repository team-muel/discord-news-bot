-- Migration: Atomic hit_count increment for obsidian_cache
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
$$;

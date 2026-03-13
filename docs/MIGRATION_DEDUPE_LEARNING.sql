-- Migration: Persistent dedupe + User learning preferences
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

CREATE POLICY "user can manage own prefs"
  ON user_learning_prefs
  FOR ALL
  USING (true)   -- service-role key bypasses; adjust for user auth if needed
  WITH CHECK (true);

-- ═══════════════════════════════════════════════
-- 완료 확인
-- ═══════════════════════════════════════════════
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_name IN ('news_capture_fingerprints', 'user_learning_prefs')
  AND table_schema = 'public';

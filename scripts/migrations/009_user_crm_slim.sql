-- 009: Slim CRM tables — drop Discord-provided columns
-- Run AFTER 008_user_crm.sql on existing deployments that had the wider schema.
-- Idempotent: DROP COLUMN IF EXISTS is safe to re-run.

-- ============================================
-- 23. User CRM — remove redundant columns
-- ============================================

-- 23.1 user_profiles: drop columns that should be read from Discord API
alter table if exists public.user_profiles
  drop column if exists username,
  drop column if exists discriminator,
  drop column if exists display_name,
  drop column if exists avatar_hash,
  drop column if exists banner_hash,
  drop column if exists locale;

-- 23.2 guild_memberships: drop columns that should be read from Discord API
alter table if exists public.guild_memberships
  drop column if exists nickname,
  drop column if exists joined_at,
  drop column if exists roles;

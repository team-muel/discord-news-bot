-- Migration 008: Observer Layer — observation persistence for autonomous agent evolution
-- Date: 2026-04-04
-- Purpose: Store structured observations from the Observer Layer (Phase F)
-- Safe to re-run (IF NOT EXISTS guards).

-- ──── Observations Table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  sprint_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Time-series queries: "recent observations for a guild"
CREATE INDEX IF NOT EXISTS idx_observations_guild_time
  ON public.observations (guild_id, detected_at DESC);

-- Channel-specific queries: "all error-pattern observations"
CREATE INDEX IF NOT EXISTS idx_observations_channel_time
  ON public.observations (channel, guild_id, detected_at DESC);

-- Unconsumed observations: for Intent Formation Engine (Phase G)
CREATE INDEX IF NOT EXISTS idx_observations_unconsumed
  ON public.observations (guild_id, detected_at DESC)
  WHERE consumed_at IS NULL;

-- RLS
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'observations' AND policyname = 'observations_service_role'
  ) THEN
    CREATE POLICY observations_service_role ON public.observations
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

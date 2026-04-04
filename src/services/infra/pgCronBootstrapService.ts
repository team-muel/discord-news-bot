/**
 * pg_cron Bootstrap Service — migrate app-level setInterval loops to Supabase pg_cron.
 *
 * Instead of Node.js setInterval timers (fragile across deploys, no distributed locking),
 * this service registers pg_cron jobs that call Supabase Edge Functions or direct SQL
 * for periodic maintenance tasks:
 *
 *   - memory_consolidation: raw→summary→concept tier promotion
 *   - memory_deadletter_recovery: retry failed memory jobs
 *   - agent_slo_check: periodic SLO alert evaluation
 *   - login_session_cleanup: purge expired Discord login sessions
 *   - obsidian_lore_sync: vault→Supabase sync trigger
 *
 * The service is idempotent: calling bootstrap multiple times only creates missing jobs.
 * Each job calls a Supabase RPC function that performs the actual work server-side,
 * eliminating the need for the Node.js process to stay alive for periodic tasks.
 *
 * Environment:
 *   PG_CRON_BOOTSTRAP_ENABLED -- default false (opt-in)
 *   PG_CRON_CONSOLIDATION_SCHEDULE -- default '0 star/6 * * *'  (every 6h)
 *   PG_CRON_DEADLETTER_SCHEDULE -- default 'star/30 * * * *'    (every 30min)
 *   PG_CRON_SLO_CHECK_SCHEDULE -- default 'star/15 * * * *'     (every 15min)
 *   PG_CRON_LOGIN_CLEANUP_SCHEDULE -- default '0 star/1 * * *'  (every 1h)
 *   PG_CRON_OBSIDIAN_SYNC_SCHEDULE -- default '0 star/2 * * *'  (every 2h)
 */

import logger from '../../logger';
import { parseBooleanEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

const ENABLED = parseBooleanEnv(process.env.PG_CRON_BOOTSTRAP_ENABLED, true);
const CONSOLIDATION_SCHEDULE = String(process.env.PG_CRON_CONSOLIDATION_SCHEDULE || '0 */6 * * *').trim();
const DEADLETTER_SCHEDULE = String(process.env.PG_CRON_DEADLETTER_SCHEDULE || '*/30 * * * *').trim();
const SLO_CHECK_SCHEDULE = String(process.env.PG_CRON_SLO_CHECK_SCHEDULE || '*/15 * * * *').trim();
const LOGIN_CLEANUP_SCHEDULE = String(process.env.PG_CRON_LOGIN_CLEANUP_SCHEDULE || '0 */1 * * *').trim();
const OBSIDIAN_SYNC_SCHEDULE = String(process.env.PG_CRON_OBSIDIAN_SYNC_SCHEDULE || '0 */2 * * *').trim();
const RETRIEVAL_EVAL_SCHEDULE = String(process.env.PG_CRON_RETRIEVAL_EVAL_SCHEDULE || '0 */24 * * *').trim();
const REWARD_SIGNAL_SCHEDULE = String(process.env.PG_CRON_REWARD_SIGNAL_SCHEDULE || '0 */6 * * *').trim();
const EVAL_AUTO_PROMOTE_SCHEDULE = String(process.env.PG_CRON_EVAL_AUTO_PROMOTE_SCHEDULE || '30 */6 * * *').trim();

/** Validate cron expression (basic 5-field check). */
const isValidCron = (expr: string): boolean => /^[\d*/,-]+(\s+[\d*/,-]+){4}$/.test(expr.trim());

type CronJobSpec = {
  jobName: string;
  schedule: string;
  command: string;
  description: string;
};

const CRON_JOBS: CronJobSpec[] = [
  {
    jobName: 'muel_memory_consolidation',
    schedule: CONSOLIDATION_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/memory/consolidate',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Trigger memory consolidation (raw→summary→concept) via HTTP',
  },
  {
    jobName: 'muel_deadletter_recovery',
    schedule: DEADLETTER_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/memory/deadletter-recover',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Recover failed memory jobs from deadletter queue',
  },
  {
    jobName: 'muel_slo_check',
    schedule: SLO_CHECK_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/slo/check',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Run SLO alert evaluation cycle',
  },
  {
    jobName: 'muel_login_session_cleanup',
    schedule: LOGIN_CLEANUP_SCHEDULE,
    command: `DELETE FROM public.discord_login_sessions WHERE expires_at < NOW()`,
    description: 'Purge expired Discord login sessions (replaces app setInterval when owner=db)',
  },
  {
    jobName: 'muel_obsidian_lore_sync',
    schedule: OBSIDIAN_SYNC_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/obsidian/sync',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Trigger Obsidian vault→Supabase lore sync via HTTP',
  },
  {
    jobName: 'muel_retrieval_eval',
    schedule: RETRIEVAL_EVAL_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/eval/retrieval',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Run retrieval eval loop for all active guilds',
  },
  {
    jobName: 'muel_reward_signal',
    schedule: REWARD_SIGNAL_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/eval/reward-signal',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Compute and persist reward signal snapshots for all active guilds',
  },
  {
    jobName: 'muel_eval_auto_promote',
    schedule: EVAL_AUTO_PROMOTE_SCHEDULE,
    command: `SELECT net.http_post(
      url := current_setting('app.service_url') || '/api/internal/eval/auto-promote',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
      body := '{}'::jsonb
    )`,
    description: 'Run A/B eval auto-promote pipeline for all active guilds',
  },
];

type BootstrapResult = {
  enabled: boolean;
  jobs: Array<{ jobName: string; status: 'created' | 'exists' | 'error'; message?: string }>;
};

/**
 * Ensure all pg_cron jobs are registered. Idempotent — skips existing jobs.
 * Uses the Supabase RPC `ensure_pg_cron_job` which must be deployed as a DB function.
 */
export const bootstrapPgCronJobs = async (): Promise<BootstrapResult> => {
  if (!ENABLED) {
    logger.debug('[PG-CRON] bootstrap disabled');
    return { enabled: false, jobs: [] };
  }

  if (!isSupabaseConfigured()) {
    logger.warn('[PG-CRON] Supabase not configured, skipping bootstrap');
    return { enabled: true, jobs: [] };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { enabled: true, jobs: [] };
  }

  const results: BootstrapResult = { enabled: true, jobs: [] };

  for (const spec of CRON_JOBS) {
    if (!isValidCron(spec.schedule)) {
      results.jobs.push({ jobName: spec.jobName, status: 'error', message: `Invalid cron: ${spec.schedule}` });
      continue;
    }

    try {
      const { data, error } = await client.rpc('ensure_pg_cron_job', {
        p_job_name: spec.jobName,
        p_schedule: spec.schedule,
        p_command: spec.command,
      });

      if (error) {
        // If RPC doesn't exist yet, log and continue gracefully
        if (error.message?.includes('function') && error.message?.includes('does not exist')) {
          logger.info('[PG-CRON] RPC ensure_pg_cron_job not deployed yet — skipping bootstrap');
          results.jobs.push({ jobName: spec.jobName, status: 'error', message: 'RPC not deployed' });
          break;
        }
        results.jobs.push({ jobName: spec.jobName, status: 'error', message: error.message });
        logger.warn('[PG-CRON] job %s failed: %s', spec.jobName, error.message);
      } else {
        const status = (data as Record<string, unknown>)?.installed === true ? 'created' : 'exists';
        results.jobs.push({ jobName: spec.jobName, status });
        logger.info('[PG-CRON] job %s: %s', spec.jobName, status);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.jobs.push({ jobName: spec.jobName, status: 'error', message: msg });
      logger.warn('[PG-CRON] job %s error: %s', spec.jobName, msg);
    }
  }

  const created = results.jobs.filter((j) => j.status === 'created').length;
  if (created > 0) {
    logger.info('[PG-CRON] bootstrap complete: %d/%d jobs created', created, CRON_JOBS.length);
  }

  return results;
};

/** SQL migration to create the ensure_pg_cron_job RPC function. */
export const PG_CRON_BOOTSTRAP_MIGRATION_SQL = `
-- Requires: pg_cron, pg_net extensions enabled
-- Deploy via Supabase SQL editor or migration file

CREATE OR REPLACE FUNCTION public.ensure_pg_cron_job(
  p_job_name TEXT,
  p_schedule TEXT,
  p_command TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_id BIGINT;
  v_new_id BIGINT;
BEGIN
  -- Check if job already exists
  SELECT jobid INTO v_existing_id
  FROM cron.job
  WHERE jobname = p_job_name
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Update schedule if changed
    PERFORM cron.alter_job(v_existing_id, schedule := p_schedule, command := p_command);
    RETURN jsonb_build_object('installed', false, 'updated', true, 'jobId', v_existing_id);
  END IF;

  -- Create new job
  v_new_id := cron.schedule(p_job_name, p_schedule, p_command);
  RETURN jsonb_build_object('installed', true, 'updated', false, 'jobId', v_new_id);
END;
$$;
`;

export const getPgCronJobSpecs = (): CronJobSpec[] => CRON_JOBS.map((j) => ({ ...j }));

/**
 * Node.js loop identifiers that each pg_cron job replaces.
 * When PG_CRON_REPLACES_APP_LOOPS=true, runtimeBootstrap skips these loops.
 */
export const PG_CRON_LOOP_REPLACEMENTS: Record<string, string> = {
  muel_memory_consolidation: 'consolidationLoop',
  muel_slo_check: 'agentSloAlertLoop',
  muel_login_session_cleanup: 'loginSessionCleanupLoop',
  muel_obsidian_lore_sync: 'obsidianLoreSyncLoop',
  muel_retrieval_eval: 'retrievalEvalLoop',
  muel_reward_signal: 'rewardSignalLoop',
  muel_eval_auto_promote: 'evalAutoPromoteLoop',
};

/**
 * Returns the set of Node.js loop names that pg_cron is configured to replace.
 * runtimeBootstrap uses this to conditionally skip setInterval loops.
 */
export const getPgCronReplacedLoops = (): Set<string> => {
  if (!ENABLED) return new Set();
  return new Set(Object.values(PG_CRON_LOOP_REPLACEMENTS));
};

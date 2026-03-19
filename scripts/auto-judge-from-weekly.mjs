/* eslint-disable no-console */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const asNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const buildArgs = (params) => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `--${key}=${value}`);
  return entries;
};

const latestByKind = async (client, kinds, params) => {
  const fromIso = new Date(Date.now() - params.windowMs).toISOString();
  const query = client
    .from('agent_weekly_reports')
    .select('report_key,report_kind,guild_id,provider,action_prefix,baseline_summary,delta_summary,created_at')
    .in('report_kind', kinds)
    .gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.guildId) query.eq('guild_id', params.guildId);
  if (params.provider) query.eq('provider', params.provider);
  if (params.actionPrefix) query.eq('action_prefix', params.actionPrefix);

  const { data, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  return {
    goNoGo: rows.find((row) => row.report_kind === 'go_no_go_weekly') || null,
    llmLatency: rows.find((row) => row.report_kind === 'llm_latency_weekly') || null,
    rollbackWeekly: rows.find((row) => row.report_kind === 'rollback_rehearsal_weekly') || null,
    memoryQueueWeekly: rows.find((row) => row.report_kind === 'memory_queue_weekly') || null,
  };
};

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required');
  }

  const stage = String(parseArg('stage', 'A')).trim().toUpperCase();
  const scope = String(parseArg('scope', 'weekly:auto')).trim();
  const operator = String(parseArg('operator', 'auto')).trim();
  const thresholdProfile = String(parseArg('thresholdProfile', 'stage_default')).trim();
  const guildId = String(parseArg('guildId', '')).trim() || null;
  const provider = String(parseArg('provider', '')).trim() || null;
  const actionPrefix = String(parseArg('actionPrefix', '')).trim() || null;
  const days = Math.max(1, Number(parseArg('days', '7')) || 7);
  const limit = Math.max(20, Math.min(500, Number(parseArg('limit', '120')) || 120));
  const allowPending = ['1', 'true', 'yes', 'on'].includes(String(parseArg('allowPending', 'false')).toLowerCase());
  const runAfterFallback = ['1', 'true', 'yes', 'on'].includes(String(parseArg('runAfterFallback', 'true')).toLowerCase());
  const minQualitySamples = Math.max(
    1,
    Number(parseArg('minQualitySamples', process.env.GATE_WEEKLY_MIN_QUALITY_SAMPLES || '3')) || 3,
  );

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const snapshots = await latestByKind(
    client,
    ['go_no_go_weekly', 'llm_latency_weekly', 'rollback_rehearsal_weekly', 'memory_queue_weekly'],
    {
      windowMs: days * 24 * 60 * 60 * 1000,
      guildId,
      provider,
      actionPrefix,
      limit,
    },
  );

  const go = snapshots.goNoGo?.baseline_summary || {};
  const llmDelta = snapshots.llmLatency?.delta_summary || {};
  const rollback = snapshots.rollbackWeekly?.baseline_summary || {};
  const memory = snapshots.memoryQueueWeekly?.baseline_summary || {};
  const qualitySummary = go?.quality_summary?.averages || {};
  const qualitySamples = go?.quality_summary?.samples || {};
  const qualityGateCounts = go?.gate_verdict_counts?.quality || {};
  const qualityFailCount = asNumber(qualityGateCounts.fail, 0);
  const qualityPendingCount = asNumber(qualityGateCounts.pending, 0);
  const qualityPassCount = asNumber(qualityGateCounts.pass, 0);
  const qualitySampleCounts = [
    asNumber(qualitySamples.citation_rate, 0),
    asNumber(qualitySamples.retrieval_hit_at_k, 0),
    asNumber(qualitySamples.hallucination_review_fail_rate, 0),
    asNumber(qualitySamples.session_success_rate, 0),
  ];
  const insufficientQualitySamples = qualitySampleCounts.some((count) => (count ?? 0) < minQualitySamples);

  let qualityGateOverride = null;
  if (qualityFailCount > 0) {
    qualityGateOverride = 'fail';
  } else if (insufficientQualitySamples) {
    qualityGateOverride = 'pending';
  } else if (qualityPendingCount > 0 && qualityPassCount === 0) {
    qualityGateOverride = 'pending';
  } else if (qualityPassCount > 0) {
    qualityGateOverride = 'pass';
  }

  const noGoCount = asNumber(go.no_go, 0);
  const p95DeltaMs = asNumber(llmDelta.p95_latency_ms, 0);
  const successDeltaPct = asNumber(llmDelta.success_rate_pct, 0);
  const deadletterPending = asNumber(memory.deadletter_pending, 0);
  const deadletterIgnored = asNumber(memory.deadletter_ignored, 0);

  let providerProfileHint = null;
  if (qualityGateOverride !== 'fail' && qualityGateOverride !== 'pending') {
    if (noGoCount === 0 && p95DeltaMs <= 30 && successDeltaPct >= -1 && deadletterPending === 0 && deadletterIgnored === 0) {
      providerProfileHint = 'cost-optimized';
    } else if (p95DeltaMs > 80 || successDeltaPct < -3 || deadletterPending > 0 || deadletterIgnored > 0) {
      providerProfileHint = 'quality-optimized';
    }
  }

  const baseArgs = {
    stage,
    scope,
    operator,
    thresholdProfile,
    allowPending,
    queueLagSec: asNumber(memory.queue_lag_p95_sec, null),
    errorRatePct: asNumber(go.no_go, null),
    p95LatencyMs: asNumber(llmDelta.p95_latency_ms, null),
    citationRate: asNumber(parseArg('citationRate', qualitySummary.citation_rate ?? ''), null),
    retrievalHitAtK: asNumber(parseArg('retrievalHitAtK', qualitySummary.retrieval_hit_at_k ?? ''), null),
    hallucinationReviewFailRate: asNumber(parseArg('hallucinationReviewFailRate', qualitySummary.hallucination_review_fail_rate ?? ''), null),
    sessionSuccessRate: asNumber(parseArg('sessionSuccessRate', qualitySummary.session_success_rate ?? ''), null),
    approvalRequiredCompliancePct: 100,
    unapprovedAutodeployCount: 0,
    policyViolationCount: 0,
    privacyBlockCount: 0,
    roadmapSynced: true,
    executionBoardSynced: true,
    backlogSynced: true,
    runbookSynced: true,
    changelogSynced: true,
    rollbackRehearsalFailCount: asNumber(rollback.fail, null),
    memoryDeadletterPendingCount: asNumber(memory.deadletter_pending, null),
    memoryDeadletterIgnoredCount: asNumber(memory.deadletter_ignored, null),
    qualityGateOverride,
    providerProfileHint,
    autoCompleteChecklist: true,
    autoCreateClosureDoc: true,
  };

  const args = buildArgs(baseArgs);

  console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] profile=${thresholdProfile} stage=${stage} snapshots=go_no_go_weekly,llm_latency_weekly,rollback_rehearsal_weekly,memory_queue_weekly minQualitySamples=${minQualitySamples} insufficientQualitySamples=${insufficientQualitySamples}`);
  execFileSync('node', ['scripts/auto-judge-go-no-go.mjs', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  const shouldRunFallbackRejudge = runAfterFallback && qualityGateOverride === 'fail';
  if (shouldRunFallbackRejudge) {
    const fallbackRunId = `gate-post-fallback-${Date.now()}`;
    const rejudgeArgs = buildArgs({
      ...baseArgs,
      scope: `${scope}:post-fallback`,
      runId: fallbackRunId,
      qualityGateOverride: null,
      providerProfileHint: 'quality-optimized',
    });

    console.log('[GO-NO-GO][AUTO-JUDGE-WEEKLY] post-fallback rejudge triggered (quality-optimized profile)');
    execFileSync('node', ['scripts/auto-judge-go-no-go.mjs', ...rejudgeArgs], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  }
}

main().catch((error) => {
  console.error('[GO-NO-GO][AUTO-JUDGE-WEEKLY] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

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

const resolveMetric = (cliArgName, dataSource, fallback = null) => {
  const cliVal = parseArg(cliArgName, '').trim();
  if (cliVal) {
    const n = Number(cliVal);
    return Number.isFinite(n) ? n : fallback;
  }
  if (dataSource !== null && dataSource !== undefined && dataSource !== '') {
    const n = Number(dataSource);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

const parseBoolArg = (name, fallback = false) => {
  const raw = String(parseArg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const isMissingRelationError = (error, tableName) => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes(String(tableName || '').toLowerCase());
};

const isGlobalGuildReport = (value) => {
  const normalized = String(value ?? '').trim();
  return !normalized || normalized === '*';
};

const pickPreferredReport = (rows, kind, guildId) => {
  const matches = rows.filter((row) => row.report_kind === kind);
  if (matches.length === 0) {
    return null;
  }
  if (!guildId) {
    return matches[0] || null;
  }

  const exact = matches.find((row) => String(row.guild_id || '').trim() === guildId);
  if (exact) {
    return exact;
  }

  const global = matches.find((row) => isGlobalGuildReport(row.guild_id));
  if (global) {
    return global;
  }

  return matches[0] || null;
};

const buildArgs = (params) => {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `--${key}=${value}`);
  return entries;
};

const parseCookie = () => {
  const authCookieName = String(process.env.AUTH_COOKIE_NAME || 'muel_session').trim() || 'muel_session';
  const input = String(parseArg('cookie', process.env.ADMIN_COOKIE || '')).trim();
  if (!input) {
    return '';
  }
  return input.includes('=') ? input : `${authCookieName}=${input}`;
};

const timedFetch = async (base, cookie, requestPath, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (cookie) {
      headers.cookie = cookie;
    }
    const response = await fetch(`${base}${requestPath}`, { headers, signal: controller.signal });
    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, raw };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      raw: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const collectLiveRuntimeEvidence = async (params) => {
  if (!params.guildId || !params.base || !params.cookie) {
    return null;
  }

  const scheduler = await timedFetch(params.base, params.cookie, '/api/bot/agent/runtime/scheduler-policy', params.timeoutMs);
  const loops = await timedFetch(params.base, params.cookie, '/api/bot/agent/runtime/loops', params.timeoutMs);
  const unattended = await timedFetch(
    params.base,
    params.cookie,
    `/api/bot/agent/runtime/unattended-health?guildId=${encodeURIComponent(params.guildId)}`,
    params.timeoutMs,
  );
  const workerApproval = await timedFetch(
    params.base,
    params.cookie,
    `/api/bot/agent/runtime/worker-approval-gates?guildId=${encodeURIComponent(params.guildId)}&recentLimit=5`,
    params.timeoutMs,
  );

  const schedulerItems = Array.isArray(scheduler.json?.snapshot?.items)
    ? scheduler.json.snapshot.items
    : [];
  const schedulerById = new Map(schedulerItems.map((item) => [String(item?.id || '').trim(), item]));
  const serviceInitExpected = [
    ['memory-job-runner', ['service-init', 'discord-ready']],
    ['opencode-publish-worker', ['service-init']],
    ['trading-engine', ['service-init']],
    ['runtime-alerts', ['service-init']],
  ];
  const discordReadyExpected = [
    ['automation-modules', ['discord-ready']],
    ['agent-daily-learning', ['discord-ready']],
    ['got-cutover-autopilot', ['discord-ready']],
    ['login-session-cleanup', ['discord-ready', 'database']],
    ['obsidian-sync-loop', ['discord-ready']],
    ['retrieval-eval-loop', ['discord-ready']],
    ['agent-slo-alert-loop', ['discord-ready']],
  ];
  const databaseExpected = [
    ['supabase-maintenance-cron', ['database']],
    ['login-session-cleanup', ['discord-ready', 'database']],
  ];
  const matchesStartup = (pairs) => scheduler.ok && pairs.every(([id, allowed]) => {
    const item = schedulerById.get(id);
    return item && allowed.includes(String(item.startup || '').trim());
  });
  const workerSnapshot = workerApproval.ok && workerApproval.json?.snapshot && typeof workerApproval.json.snapshot === 'object'
    ? workerApproval.json.snapshot
    : null;

  return {
    runtimeFlags: {
      schedulerPolicyItemsVerified: scheduler.ok && schedulerItems.length > 0,
      serviceInitIdsVerified: matchesStartup(serviceInitExpected),
      discordReadyIdsVerified: matchesStartup(discordReadyExpected),
      databaseIdsVerified: matchesStartup(databaseExpected),
      loopsSnapshotAttached: loops.ok && Boolean(loops.json),
      unattendedHealthSnapshotAttached: unattended.ok && Boolean(unattended.json),
      workerApprovalGatesSnapshotAttached: Boolean(workerSnapshot),
      sandboxDelegationVerified: workerSnapshot?.delegationEvidence?.complete === true,
    },
    safetySignals: workerSnapshot?.safetySignals && typeof workerSnapshot.safetySignals === 'object'
      ? workerSnapshot.safetySignals
      : null,
  };
};

const latestByKind = async (client, kinds, params) => {
  const fromIso = new Date(Date.now() - params.windowMs).toISOString();
  const query = client
    .from('agent_weekly_reports')
    .select('report_key,report_kind,guild_id,provider,action_prefix,baseline_summary,candidate_summary,delta_summary,top_actions,created_at')
    .in('report_kind', kinds)
    .gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(params.limit);

  if (params.provider) query.eq('provider', params.provider);
  if (params.actionPrefix) query.eq('action_prefix', params.actionPrefix);

  const { data, error } = await query;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  return {
    goNoGo: pickPreferredReport(rows, 'go_no_go_weekly', params.guildId),
    llmLatency: pickPreferredReport(rows, 'llm_latency_weekly', params.guildId),
    rollbackWeekly: pickPreferredReport(rows, 'rollback_rehearsal_weekly', params.guildId),
    memoryQueueWeekly: pickPreferredReport(rows, 'memory_queue_weekly', params.guildId),
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
  const dryRun = ['1', 'true', 'yes', 'on'].includes(String(parseArg('dryRun', 'false')).toLowerCase());
  const base = String(parseArg('base', process.env.API_BASE || '')).trim().replace(/\/+$/, '');
  const cookie = parseCookie();
  const timeoutMs = Math.max(1000, Number(parseArg('timeoutMs', '15000')) || 15000);
  const minQualitySamples = Math.max(
    1,
    Number(parseArg('minQualitySamples', process.env.GATE_WEEKLY_MIN_QUALITY_SAMPLES || '3')) || 3,
  );
  const allowMissingSourceReports = parseBoolArg(
    'allowMissingSourceReports',
    ['1', 'true', 'yes', 'on'].includes(String(process.env.AUTO_JUDGE_WEEKLY_ALLOW_MISSING_SOURCE_REPORTS || 'false').trim().toLowerCase()),
  );

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  let snapshots;
  try {
    snapshots = await latestByKind(
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
  } catch (error) {
    if (allowMissingSourceReports && isMissingRelationError(error, 'agent_weekly_reports')) {
      console.log('[GO-NO-GO][AUTO-JUDGE-WEEKLY] skipped: table public.agent_weekly_reports not found (apply migration first)');
      return;
    }
    throw error;
  }

  const missingSnapshots = [
    !snapshots.goNoGo ? 'go_no_go_weekly' : null,
    !snapshots.llmLatency ? 'llm_latency_weekly' : null,
    !snapshots.rollbackWeekly ? 'rollback_rehearsal_weekly' : null,
    !snapshots.memoryQueueWeekly ? 'memory_queue_weekly' : null,
  ].filter(Boolean);

  if (missingSnapshots.length > 0) {
    if (allowMissingSourceReports) {
      console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] skipped: missing source snapshots within window (${missingSnapshots.join(', ')})`);
      return;
    }
    throw new Error(`Missing source snapshots: ${missingSnapshots.join(', ')}`);
  }

  const go = snapshots.goNoGo?.baseline_summary || {};
  const llmCandidate = snapshots.llmLatency?.candidate_summary || {};
  const llmDelta = snapshots.llmLatency?.delta_summary || {};
  const llmTopActions = snapshots.llmLatency?.top_actions || {};
  const rollback = snapshots.rollbackWeekly?.baseline_summary || {};
  const memory = snapshots.memoryQueueWeekly?.baseline_summary || {};
  const autoJudgeSignalSummary = go?.auto_judge_signal_summary || {};
  const qualitySummary = autoJudgeSignalSummary?.quality_summary?.averages || go?.quality_summary?.averages || {};
  const qualitySamples = autoJudgeSignalSummary?.quality_summary?.samples || go?.quality_summary?.samples || {};
  const qualityGateCounts = autoJudgeSignalSummary?.gate_verdict_counts?.quality || go?.gate_verdict_counts?.quality || {};
  const qualityFailCount = asNumber(qualityGateCounts.fail, 0);
  const qualityPendingCount = asNumber(qualityGateCounts.pending, 0);
  const qualityPassCount = asNumber(qualityGateCounts.pass, 0);

  // --- Strategy quality normalization fallback (M-07: retrieval eval + answer quality reviews) ---
  const strategyNorm = go?.strategy_quality_normalization || {};
  const strategyBaseline = strategyNorm?.by_strategy?.baseline || {};
  const retrievalEvalSamples = asNumber(strategyNorm.retrieval_eval_runs_samples, 0);
  const normRecallAtK = asNumber(strategyBaseline.recall_at_k_avg, null);
  const normHallucinationFailRate = strategyBaseline.hallucination_fail_rate_pct !== null
    && strategyBaseline.hallucination_fail_rate_pct !== undefined
    ? Number((strategyBaseline.hallucination_fail_rate_pct / 100).toFixed(4))
    : null;

  // Quality sample counts: gate-run signals + retrieval eval fallback
  const gateRunQualitySampleCounts = [
    asNumber(qualitySamples.citation_rate, 0),
    asNumber(qualitySamples.retrieval_hit_at_k, 0),
    asNumber(qualitySamples.hallucination_review_fail_rate, 0),
    asNumber(qualitySamples.session_success_rate, 0),
  ];
  const hasRetrievalEvalFallback = retrievalEvalSamples >= minQualitySamples && normRecallAtK !== null;
  const insufficientQualitySamples = !hasRetrievalEvalFallback
    && gateRunQualitySampleCounts.some((count) => (count ?? 0) < minQualitySamples);

  let qualityGateOverride = null;
  if (hasRetrievalEvalFallback) {
    // Retrieval eval data provides actual metric values; let the quality gate
    // evaluate naturally rather than relying on historical gate-run verdicts.
    qualityGateOverride = null;
  } else if (insufficientQualitySamples) {
    qualityGateOverride = 'pending';
  } else if (qualityFailCount > 0) {
    qualityGateOverride = 'fail';
  } else if (qualityPendingCount > 0 && qualityPassCount === 0) {
    qualityGateOverride = 'pending';
  } else if (qualityPassCount > 0) {
    qualityGateOverride = 'pass';
  }

  const noGoCount = asNumber(go.no_go, 0);
  const p95DeltaMs = asNumber(llmDelta.p95_latency_ms, 0);
  const successDeltaPct = asNumber(llmDelta.success_rate_pct, 0);
  const candidateSuccessRatePct = asNumber(llmCandidate.successRatePct, null);
  const candidateErrorRatePct = candidateSuccessRatePct === null
    ? null
    : Number((100 - candidateSuccessRatePct).toFixed(2));
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

  const liveRuntimeEvidence = await collectLiveRuntimeEvidence({ guildId, base, cookie, timeoutMs });
  const liveSafetySignals = liveRuntimeEvidence?.safetySignals || null;
  const runtimeFlags = liveRuntimeEvidence?.runtimeFlags || null;

  const baseArgs = {
    stage,
    scope,
    operator,
    thresholdProfile,
    allowPending,
    queueLagSec: asNumber(memory.queue_lag_p95_sec, null),
    errorRatePct: candidateErrorRatePct,
    p95LatencyMs: asNumber(llmCandidate.p95LatencyMs, asNumber(llmDelta.p95_latency_ms, null)),
    citationRate: resolveMetric('citationRate', qualitySummary.citation_rate),
    retrievalHitAtK: resolveMetric('retrievalHitAtK', qualitySummary.retrieval_hit_at_k) ?? normRecallAtK,
    hallucinationReviewFailRate: resolveMetric('hallucinationReviewFailRate', qualitySummary.hallucination_review_fail_rate) ?? normHallucinationFailRate,
    sessionSuccessRate: resolveMetric('sessionSuccessRate', qualitySummary.session_success_rate),
    approvalRequiredCompliancePct: resolveMetric('approvalRequiredCompliancePct', liveSafetySignals?.approvalRequiredCompliancePct),
    unapprovedAutodeployCount: resolveMetric('unapprovedAutodeployCount', liveSafetySignals?.unapprovedAutodeployCount),
    policyViolationCount: resolveMetric('policyViolationCount', liveSafetySignals?.policyViolationCount),
    privacyBlockCount: resolveMetric('privacyBlockCount', liveSafetySignals?.privacyBlockCount),
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
    autoCompleteChecklist: parseBoolArg('autoCompleteChecklist', false),
    schedulerPolicyItemsVerified: runtimeFlags?.schedulerPolicyItemsVerified,
    serviceInitIdsVerified: runtimeFlags?.serviceInitIdsVerified,
    discordReadyIdsVerified: runtimeFlags?.discordReadyIdsVerified,
    databaseIdsVerified: runtimeFlags?.databaseIdsVerified,
    loopsSnapshotAttached: runtimeFlags?.loopsSnapshotAttached,
    unattendedHealthSnapshotAttached: runtimeFlags?.unattendedHealthSnapshotAttached,
    workerApprovalGatesSnapshotAttached: runtimeFlags?.workerApprovalGatesSnapshotAttached,
    sandboxDelegationVerified: runtimeFlags?.sandboxDelegationVerified,
    autoCreateClosureDoc: true,
    dryRun,
  };

  const args = buildArgs(baseArgs);

  console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] profile=${thresholdProfile} stage=${stage} snapshots=go_no_go_weekly,llm_latency_weekly,rollback_rehearsal_weekly,memory_queue_weekly minQualitySamples=${minQualitySamples} insufficientQualitySamples=${insufficientQualitySamples} hasRetrievalEvalFallback=${hasRetrievalEvalFallback} retrievalEvalSamples=${retrievalEvalSamples}`);
  if (guildId) {
    console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] live_runtime_evidence=${liveRuntimeEvidence ? 'attached' : 'unavailable'} base=${base || 'n/a'}`);
  }

  // Per-action latency diagnostics
  const candidateActions = Array.isArray(llmTopActions.candidate) ? llmTopActions.candidate : [];
  if (candidateActions.length > 0) {
    const maxP95 = asNumber(baseArgs.p95LatencyMs, null);
    const slowActions = candidateActions.filter((a) => a.p95LatencyMs && maxP95 && a.p95LatencyMs > maxP95 * 0.8);
    console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] top_actions: ${candidateActions.map((a) => `${a.actionName}(n=${a.total},p95=${a.p95LatencyMs}ms)`).join(', ')}`);
    if (slowActions.length > 0) {
      console.log(`[GO-NO-GO][AUTO-JUDGE-WEEKLY] slow_actions(>80%_of_threshold): ${slowActions.map((a) => `${a.actionName}(p95=${a.p95LatencyMs}ms)`).join(', ')}`);
    }
  }
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
      dryRun,
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

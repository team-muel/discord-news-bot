import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv } from '../../utils/env';
import { runWithConcurrency } from '../../utils/async';
import { buildAgentRuntimeReadinessReport } from './agentRuntimeReadinessService';
import { buildGoNoGoReport } from '../goNoGoService';
import { summarizeOpencodeQueueReadiness } from '../opencodeGitHubQueueService';
import { getMemoryQueueHealthSnapshot } from '../memory/memoryJobRunner';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

type SloLayer = 'intelligence' | 'engine' | 'agents' | 'tools_memory' | 'learning';
type SloCheckStatus = 'pass' | 'warn' | 'fail';

type SloThresholds = {
  intelligenceMaxLlmErrorRate: number;
  intelligenceMaxP95LatencyMs: number;
  engineMaxTelemetryDropRate: number;
  agentsMaxActionFailureRate: number;
  agentsMaxHighRiskMissingEvidence: number;
  toolsMemoryMinCitationRate: number;
  toolsMemoryMinRecallAt5: number;
  toolsMemoryMaxJobFailureRate: number;
  toolsMemoryMaxQueueLagP95Sec: number;
  toolsMemoryMaxRetryRatePct: number;
  toolsMemoryMaxDeadletterPending: number;
  toolsMemoryMaxDeadletterIgnored: number;
  learningMinCandidates24h: number;
  learningMinActiveRules: number;
};

type SloPolicy = {
  guildId: string;
  enabled: boolean;
  windowMinutes: number;
  alertCooldownMinutes: number;
  thresholds: SloThresholds;
};

type SloCheck = {
  layer: SloLayer;
  key: string;
  status: SloCheckStatus;
  metric: number | null;
  threshold: number | null;
  message: string;
  metadata?: Record<string, unknown>;
};

type SloAlertEvent = {
  id: number;
  guildId: string;
  layer: SloLayer;
  checkKey: string;
  status: 'warn' | 'critical';
  metricValue: number | null;
  thresholdValue: number | null;
  message: string;
  fingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const SLO_POLICY_TABLE = String(process.env.AGENT_SLO_POLICY_TABLE || 'agent_slo_policies').trim();
const SLO_ALERT_TABLE = String(process.env.AGENT_SLO_ALERT_TABLE || 'agent_slo_alert_events').trim();

const SLO_LOOP_ENABLED = parseBooleanEnv(process.env.AGENT_SLO_ALERT_LOOP_ENABLED, true);
const SLO_LOOP_INTERVAL_MIN = Math.max(1, parseIntegerEnv(process.env.AGENT_SLO_ALERT_LOOP_INTERVAL_MIN, 15));
export type SloLoopOwner = 'app' | 'db';
const SLO_LOOP_OWNER: SloLoopOwner =
  String(process.env.AGENT_SLO_ALERT_LOOP_OWNER || 'app').trim().toLowerCase() === 'db' ? 'db' : 'app';
const SLO_LOOP_MAX_GUILDS = Math.max(1, Math.min(500, parseIntegerEnv(process.env.AGENT_SLO_ALERT_LOOP_MAX_GUILDS, 100)));
const SLO_LOOP_CONCURRENCY = Math.max(1, Math.min(20, parseIntegerEnv(process.env.AGENT_SLO_ALERT_LOOP_CONCURRENCY, 4)));

const DEFAULT_THRESHOLDS: SloThresholds = {
  intelligenceMaxLlmErrorRate: parseBoundedNumberEnv(process.env.AGENT_SLO_INTELLIGENCE_MAX_LLM_ERROR_RATE, 0.08, 0, 1),
  intelligenceMaxP95LatencyMs: Math.max(100, parseIntegerEnv(process.env.AGENT_SLO_INTELLIGENCE_MAX_P95_LATENCY_MS, 6000)),
  engineMaxTelemetryDropRate: parseBoundedNumberEnv(process.env.AGENT_SLO_ENGINE_MAX_TELEMETRY_DROP_RATE, 0.02, 0, 1),
  agentsMaxActionFailureRate: parseBoundedNumberEnv(process.env.AGENT_SLO_AGENTS_MAX_ACTION_FAILURE_RATE, 0.35, 0, 1),
  agentsMaxHighRiskMissingEvidence: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_AGENTS_MAX_HIGH_RISK_MISSING_EVIDENCE, 0)),
  toolsMemoryMinCitationRate: parseBoundedNumberEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MIN_CITATION_RATE, 0.95, 0, 1),
  toolsMemoryMinRecallAt5: parseBoundedNumberEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MIN_RECALL_AT_5, 0.60, 0, 1),
  toolsMemoryMaxJobFailureRate: parseBoundedNumberEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MAX_JOB_FAILURE_RATE, 0.10, 0, 1),
  toolsMemoryMaxQueueLagP95Sec: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MAX_QUEUE_LAG_P95_SEC, 120)),
  toolsMemoryMaxRetryRatePct: parseBoundedNumberEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MAX_RETRY_RATE_PCT, 40, 0, 100),
  toolsMemoryMaxDeadletterPending: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MAX_DEADLETTER_PENDING, 0)),
  toolsMemoryMaxDeadletterIgnored: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_TOOLS_MEMORY_MAX_DEADLETTER_IGNORED, 0)),
  learningMinCandidates24h: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_LEARNING_MIN_CANDIDATES_24H, 1)),
  learningMinActiveRules: Math.max(0, parseIntegerEnv(process.env.AGENT_SLO_LEARNING_MIN_ACTIVE_RULES, 1)),
};

let sloLoopTimer: NodeJS.Timeout | null = null;
let sloLoopRunning = false;

export const getAgentSloAlertLoopStats = () => ({
  enabled: SLO_LOOP_ENABLED,
  owner: SLO_LOOP_OWNER,
  running: Boolean(sloLoopTimer),
  inFlight: sloLoopRunning,
  intervalMin: SLO_LOOP_INTERVAL_MIN,
  maxGuilds: SLO_LOOP_MAX_GUILDS,
  concurrency: SLO_LOOP_CONCURRENCY,
});

const nowIso = () => new Date().toISOString();

const toNumeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toThresholds = (value: unknown): SloThresholds => {
  const row = (value && typeof value === 'object' && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};

  return {
    intelligenceMaxLlmErrorRate: Math.max(0, Math.min(1, Number(row.intelligenceMaxLlmErrorRate ?? DEFAULT_THRESHOLDS.intelligenceMaxLlmErrorRate))),
    intelligenceMaxP95LatencyMs: Math.max(100, Number(row.intelligenceMaxP95LatencyMs ?? DEFAULT_THRESHOLDS.intelligenceMaxP95LatencyMs)),
    engineMaxTelemetryDropRate: Math.max(0, Math.min(1, Number(row.engineMaxTelemetryDropRate ?? DEFAULT_THRESHOLDS.engineMaxTelemetryDropRate))),
    agentsMaxActionFailureRate: Math.max(0, Math.min(1, Number(row.agentsMaxActionFailureRate ?? DEFAULT_THRESHOLDS.agentsMaxActionFailureRate))),
    agentsMaxHighRiskMissingEvidence: Math.max(0, Math.trunc(Number(row.agentsMaxHighRiskMissingEvidence ?? DEFAULT_THRESHOLDS.agentsMaxHighRiskMissingEvidence))),
    toolsMemoryMinCitationRate: Math.max(0, Math.min(1, Number(row.toolsMemoryMinCitationRate ?? DEFAULT_THRESHOLDS.toolsMemoryMinCitationRate))),
    toolsMemoryMinRecallAt5: Math.max(0, Math.min(1, Number(row.toolsMemoryMinRecallAt5 ?? DEFAULT_THRESHOLDS.toolsMemoryMinRecallAt5))),
    toolsMemoryMaxJobFailureRate: Math.max(0, Math.min(1, Number(row.toolsMemoryMaxJobFailureRate ?? DEFAULT_THRESHOLDS.toolsMemoryMaxJobFailureRate))),
    toolsMemoryMaxQueueLagP95Sec: Math.max(0, Number(row.toolsMemoryMaxQueueLagP95Sec ?? DEFAULT_THRESHOLDS.toolsMemoryMaxQueueLagP95Sec)),
    toolsMemoryMaxRetryRatePct: Math.max(0, Math.min(100, Number(row.toolsMemoryMaxRetryRatePct ?? DEFAULT_THRESHOLDS.toolsMemoryMaxRetryRatePct))),
    toolsMemoryMaxDeadletterPending: Math.max(0, Math.trunc(Number(row.toolsMemoryMaxDeadletterPending ?? DEFAULT_THRESHOLDS.toolsMemoryMaxDeadletterPending))),
    toolsMemoryMaxDeadletterIgnored: Math.max(0, Math.trunc(Number(row.toolsMemoryMaxDeadletterIgnored ?? DEFAULT_THRESHOLDS.toolsMemoryMaxDeadletterIgnored))),
    learningMinCandidates24h: Math.max(0, Math.trunc(Number(row.learningMinCandidates24h ?? DEFAULT_THRESHOLDS.learningMinCandidates24h))),
    learningMinActiveRules: Math.max(0, Math.trunc(Number(row.learningMinActiveRules ?? DEFAULT_THRESHOLDS.learningMinActiveRules))),
  };
};

const percentile = (values: number[], p: number): number | null => {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) {
    return null;
  }
  if (clean.length === 1) {
    return clean[0];
  }
  const rank = Math.ceil((p / 100) * clean.length) - 1;
  const idx = Math.max(0, Math.min(clean.length - 1, rank));
  return clean[idx];
};

const ensureSupabase = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

const getGuildPolicy = async (guildId: string): Promise<SloPolicy> => {
  const client = ensureSupabase();
  const { data, error } = await client
    .from(SLO_POLICY_TABLE)
    .select('*')
    .in('guild_id', [guildId, '*'])
    .order('guild_id', { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(error.message || 'AGENT_SLO_POLICY_READ_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const exact = rows.find((row) => String(row.guild_id || '').trim() === guildId);
  const fallback = rows.find((row) => String(row.guild_id || '').trim() === '*');
  const row = exact || fallback;

  if (!row) {
    return {
      guildId,
      enabled: true,
      windowMinutes: 60,
      alertCooldownMinutes: 30,
      thresholds: DEFAULT_THRESHOLDS,
    };
  }

  return {
    guildId,
    enabled: row.enabled !== false,
    windowMinutes: Math.max(5, Math.min(24 * 60, Math.trunc(Number(row.window_minutes || 60) || 60))),
    alertCooldownMinutes: Math.max(1, Math.min(24 * 60, Math.trunc(Number(row.alert_cooldown_minutes || 30) || 30))),
    thresholds: toThresholds(row.thresholds),
  };
};

const getLlmWindowStats = async (guildId: string, windowMinutes: number) => {
  const client = ensureSupabase();
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('agent_llm_call_logs')
    .select('success, latency_ms, created_at')
    .eq('guild_id', guildId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(error.message || 'AGENT_SLO_LLM_STATS_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const total = rows.length;
  const failures = rows.filter((row) => row.success === false).length;
  const latencies = rows
    .map((row) => Number(row.latency_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    total,
    failures,
    errorRate: total > 0 ? Number((failures / total).toFixed(4)) : 0,
    p95LatencyMs: percentile(latencies, 95),
  };
};

const getLearningWindowStats = async (guildId: string) => {
  const client = ensureSupabase();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [candidatesRes, rulesRes] = await Promise.all([
    client
      .from('agent_tool_learning_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso),
    client
      .from('agent_tool_learning_rules')
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('status', 'active'),
  ]);

  if (candidatesRes.error) {
    throw new Error(candidatesRes.error.message || 'AGENT_SLO_LEARNING_CANDIDATE_STATS_FAILED');
  }
  if (rulesRes.error) {
    throw new Error(rulesRes.error.message || 'AGENT_SLO_LEARNING_RULE_STATS_FAILED');
  }

  return {
    candidates24h: Math.max(0, Number(candidatesRes.count || 0)),
    activeRules: Math.max(0, Number(rulesRes.count || 0)),
  };
};

const check = (params: {
  layer: SloLayer;
  key: string;
  status: SloCheckStatus;
  metric: number | null;
  threshold: number | null;
  message: string;
  metadata?: Record<string, unknown>;
}): SloCheck => params;

const buildChecks = async (guildId: string, policy: SloPolicy): Promise<SloCheck[]> => {
  const windowDays = Math.max(1, Math.ceil(policy.windowMinutes / (24 * 60)));
  const [readiness, goNoGo, opencode, llmStats, learningStats, queueHealth] = await Promise.all([
    buildAgentRuntimeReadinessReport({ guildId, windowDays }),
    buildGoNoGoReport({ guildId, days: windowDays }),
    summarizeOpencodeQueueReadiness({ guildId }).catch(() => null),
    getLlmWindowStats(guildId, policy.windowMinutes),
    getLearningWindowStats(guildId),
    getMemoryQueueHealthSnapshot(guildId).catch(() => null),
  ]);

  const telemetryDropRate = Number(readiness.metrics.telemetryQueue.dropped || 0) /
    Math.max(1, Number(readiness.metrics.telemetryQueue.processed || 0) + Number(readiness.metrics.telemetryQueue.dropped || 0));
  const actionFailureRate = Number(readiness.metrics.actionDiagnostics.failedRuns || 0) /
    Math.max(1, Number(readiness.metrics.actionDiagnostics.totalRuns || 0));

  const citationCheck = goNoGo.checks.find((item) => item.id === 'citation-rate');
  const recallCheck = goNoGo.checks.find((item) => item.id === 'recall-at-5');
  const jobFailureCheck = goNoGo.checks.find((item) => item.id === 'job-failure-rate');

  const highRiskMissing = Number(opencode?.changeRequests?.evidenceCoverage?.highRiskMissing || 0);

  const checks: SloCheck[] = [
    check({
      layer: 'intelligence',
      key: 'llm_error_rate',
      status: llmStats.total === 0
        ? 'warn'
        : llmStats.errorRate <= policy.thresholds.intelligenceMaxLlmErrorRate ? 'pass' : 'fail',
      metric: llmStats.errorRate,
      threshold: policy.thresholds.intelligenceMaxLlmErrorRate,
      message: `LLM error rate in window=${llmStats.errorRate} (total=${llmStats.total})`,
      metadata: { windowMinutes: policy.windowMinutes, samples: llmStats.total },
    }),
    check({
      layer: 'intelligence',
      key: 'llm_p95_latency_ms',
      status: llmStats.p95LatencyMs === null
        ? 'warn'
        : llmStats.p95LatencyMs <= policy.thresholds.intelligenceMaxP95LatencyMs ? 'pass' : 'fail',
      metric: llmStats.p95LatencyMs,
      threshold: policy.thresholds.intelligenceMaxP95LatencyMs,
      message: `LLM p95 latency=${String(llmStats.p95LatencyMs ?? 'n/a')}ms`,
      metadata: { windowMinutes: policy.windowMinutes, samples: llmStats.total },
    }),
    check({
      layer: 'engine',
      key: 'telemetry_drop_rate',
      status: telemetryDropRate <= policy.thresholds.engineMaxTelemetryDropRate ? 'pass' : 'fail',
      metric: Number(telemetryDropRate.toFixed(4)),
      threshold: policy.thresholds.engineMaxTelemetryDropRate,
      message: `Telemetry queue drop rate=${Number(telemetryDropRate.toFixed(4))}`,
      metadata: readiness.metrics.telemetryQueue,
    }),
    check({
      layer: 'agents',
      key: 'action_failure_rate',
      status: actionFailureRate <= policy.thresholds.agentsMaxActionFailureRate ? 'pass' : 'fail',
      metric: Number(actionFailureRate.toFixed(4)),
      threshold: policy.thresholds.agentsMaxActionFailureRate,
      message: `Action failure rate=${Number(actionFailureRate.toFixed(4))}`,
      metadata: readiness.metrics.actionDiagnostics,
    }),
    check({
      layer: 'agents',
      key: 'opencode_high_risk_missing_evidence',
      status: opencode === null
        ? 'warn'
        : highRiskMissing <= policy.thresholds.agentsMaxHighRiskMissingEvidence ? 'pass' : 'fail',
      metric: opencode === null ? null : highRiskMissing,
      threshold: policy.thresholds.agentsMaxHighRiskMissingEvidence,
      message: `OpenCode high-risk missing evidence=${opencode === null ? 'n/a' : highRiskMissing}`,
      metadata: opencode ? { evidenceCoverage: opencode.changeRequests.evidenceCoverage } : { unavailable: true },
    }),
    check({
      layer: 'tools_memory',
      key: 'citation_rate',
      status: citationCheck?.actual === undefined
        ? 'warn'
        : Number(citationCheck.actual) >= policy.thresholds.toolsMemoryMinCitationRate ? 'pass' : 'fail',
      metric: toNumeric(citationCheck?.actual),
      threshold: policy.thresholds.toolsMemoryMinCitationRate,
      message: `Citation rate=${String(citationCheck?.actual ?? 'n/a')}`,
    }),
    check({
      layer: 'tools_memory',
      key: 'recall_at_5',
      status: recallCheck?.actual === undefined
        ? 'warn'
        : Number(recallCheck.actual) >= policy.thresholds.toolsMemoryMinRecallAt5 ? 'pass' : 'fail',
      metric: toNumeric(recallCheck?.actual),
      threshold: policy.thresholds.toolsMemoryMinRecallAt5,
      message: `Recall@5=${String(recallCheck?.actual ?? 'n/a')}`,
    }),
    check({
      layer: 'tools_memory',
      key: 'memory_job_failure_rate',
      status: jobFailureCheck?.actual === undefined
        ? 'warn'
        : Number(jobFailureCheck.actual) <= policy.thresholds.toolsMemoryMaxJobFailureRate ? 'pass' : 'fail',
      metric: toNumeric(jobFailureCheck?.actual),
      threshold: policy.thresholds.toolsMemoryMaxJobFailureRate,
      message: `Memory job failure rate=${String(jobFailureCheck?.actual ?? 'n/a')}`,
    }),
    check({
      layer: 'tools_memory',
      key: 'queue_lag_p95_sec',
      status: queueHealth === null
        ? 'warn'
        : queueHealth.queueLagP95Sec <= policy.thresholds.toolsMemoryMaxQueueLagP95Sec ? 'pass' : 'fail',
      metric: queueHealth?.queueLagP95Sec ?? null,
      threshold: policy.thresholds.toolsMemoryMaxQueueLagP95Sec,
      message: `Queue lag p95=${queueHealth?.queueLagP95Sec ?? 'n/a'}s`,
    }),
    check({
      layer: 'tools_memory',
      key: 'retry_rate_pct',
      status: queueHealth === null
        ? 'warn'
        : queueHealth.retryRatePct <= policy.thresholds.toolsMemoryMaxRetryRatePct ? 'pass' : 'fail',
      metric: queueHealth?.retryRatePct ?? null,
      threshold: policy.thresholds.toolsMemoryMaxRetryRatePct,
      message: `Retry rate=${queueHealth?.retryRatePct ?? 'n/a'}%`,
    }),
    check({
      layer: 'tools_memory',
      key: 'deadletter_pending',
      status: queueHealth === null
        ? 'warn'
        : queueHealth.deadletterPendingCount <= policy.thresholds.toolsMemoryMaxDeadletterPending ? 'pass' : 'fail',
      metric: queueHealth?.deadletterPendingCount ?? null,
      threshold: policy.thresholds.toolsMemoryMaxDeadletterPending,
      message: `Deadletter pending=${queueHealth?.deadletterPendingCount ?? 'n/a'}`,
    }),
    check({
      layer: 'tools_memory',
      key: 'deadletter_ignored',
      status: queueHealth === null
        ? 'warn'
        : queueHealth.deadletterIgnoredCount <= policy.thresholds.toolsMemoryMaxDeadletterIgnored ? 'pass' : 'fail',
      metric: queueHealth?.deadletterIgnoredCount ?? null,
      threshold: policy.thresholds.toolsMemoryMaxDeadletterIgnored,
      message: `Deadletter ignored=${queueHealth?.deadletterIgnoredCount ?? 'n/a'}`,
    }),
    check({
      layer: 'learning',
      key: 'learning_candidates_24h',
      status: learningStats.candidates24h >= policy.thresholds.learningMinCandidates24h ? 'pass' : 'fail',
      metric: learningStats.candidates24h,
      threshold: policy.thresholds.learningMinCandidates24h,
      message: `Learning candidates 24h=${learningStats.candidates24h}`,
    }),
    check({
      layer: 'learning',
      key: 'learning_active_rules',
      status: learningStats.activeRules >= policy.thresholds.learningMinActiveRules ? 'pass' : 'fail',
      metric: learningStats.activeRules,
      threshold: policy.thresholds.learningMinActiveRules,
      message: `Learning active rules=${learningStats.activeRules}`,
    }),
  ];

  return checks;
};

const buildFingerprint = (guildId: string, check: SloCheck): string => `${guildId}:${check.layer}:${check.key}`;

const shouldEmitAlert = async (params: {
  guildId: string;
  fingerprint: string;
  cooldownMinutes: number;
}): Promise<boolean> => {
  const client = ensureSupabase();
  const sinceIso = new Date(Date.now() - params.cooldownMinutes * 60 * 1000).toISOString();
  const { data, error } = await client
    .from(SLO_ALERT_TABLE)
    .select('id')
    .eq('guild_id', params.guildId)
    .eq('fingerprint', params.fingerprint)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message || 'AGENT_SLO_ALERT_DEDUPE_READ_FAILED');
  }

  return !data || data.length === 0;
};

const emitAlerts = async (params: {
  guildId: string;
  checks: SloCheck[];
  cooldownMinutes: number;
  actorId?: string;
  force?: boolean;
}) => {
  const client = ensureSupabase();
  let emitted = 0;

  for (const item of params.checks) {
    if (item.status === 'pass') {
      continue;
    }

    const severity = item.status === 'fail' ? 'critical' : 'warn';
    const fingerprint = buildFingerprint(params.guildId, item);
    if (!params.force) {
      const allowed = await shouldEmitAlert({ guildId: params.guildId, fingerprint, cooldownMinutes: params.cooldownMinutes });
      if (!allowed) {
        continue;
      }
    }

    const payload = {
      guild_id: params.guildId,
      layer: item.layer,
      check_key: item.key,
      status: severity,
      metric_value: item.metric,
      threshold_value: item.threshold,
      message: item.message.slice(0, 400),
      fingerprint,
      metadata: {
        actorId: String(params.actorId || 'system').slice(0, 120),
        check: item,
      },
      created_at: nowIso(),
    };

    const { error } = await client.from(SLO_ALERT_TABLE).insert(payload);
    if (!error) {
      emitted += 1;
    }
  }

  return emitted;
};

export const evaluateGuildSloReport = async (params: { guildId: string }) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const policy = await getGuildPolicy(guildId);
  const checks = await buildChecks(guildId, policy);

  const failed = checks.filter((item) => item.status === 'fail');
  const warned = checks.filter((item) => item.status === 'warn');
  const decision = failed.length > 0 ? 'critical' : warned.length > 0 ? 'warn' : 'ok';

  return {
    guildId,
    generatedAt: nowIso(),
    policy,
    summary: {
      total: checks.length,
      pass: checks.filter((item) => item.status === 'pass').length,
      warn: warned.length,
      fail: failed.length,
      decision,
    },
    checks,
  };
};

export const evaluateGuildSloAndPersistAlerts = async (params: {
  guildId: string;
  actorId?: string;
  force?: boolean;
}) => {
  const report = await evaluateGuildSloReport({ guildId: params.guildId });
  const emittedAlerts = report.policy.enabled
    ? await emitAlerts({
      guildId: report.guildId,
      checks: report.checks,
      cooldownMinutes: report.policy.alertCooldownMinutes,
      actorId: params.actorId,
      force: params.force,
    })
    : 0;

  return {
    ...report,
    emittedAlerts,
  };
};

export const listGuildSloAlertEvents = async (params: {
  guildId: string;
  limit?: number;
}): Promise<SloAlertEvent[]> => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit || 100))));
  const client = ensureSupabase();
  const { data, error } = await client
    .from(SLO_ALERT_TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'AGENT_SLO_ALERT_LIST_FAILED');
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id || 0),
    guildId: String(row.guild_id || ''),
    layer: String(row.layer || 'engine') as SloLayer,
    checkKey: String(row.check_key || ''),
    status: String(row.status || 'warn') === 'critical' ? 'critical' : 'warn',
    metricValue: toNumeric(row.metric_value),
    thresholdValue: toNumeric(row.threshold_value),
    message: String(row.message || ''),
    fingerprint: String(row.fingerprint || ''),
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {},
    createdAt: String(row.created_at || ''),
  }));
};

const listTargetGuildIds = async (): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('sources')
    .select('guild_id')
    .eq('is_active', true)
    .not('guild_id', 'is', null)
    .limit(5000);

  if (error) {
    throw new Error(error.message || 'AGENT_SLO_GUILD_LIST_FAILED');
  }

  const set = new Set<string>();
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const guildId = String(row.guild_id || '').trim();
    if (guildId) {
      set.add(guildId);
    }
  }

  return [...set].slice(0, SLO_LOOP_MAX_GUILDS);
};

const runSloLoopTick = async () => {
  if (sloLoopRunning) {
    return;
  }
  sloLoopRunning = true;

  try {
    const guildIds = await listTargetGuildIds();
    let emittedTotal = 0;

    await runWithConcurrency(guildIds, async (guildId) => {
      try {
        const result = await evaluateGuildSloAndPersistAlerts({ guildId, actorId: 'system:slo-loop' });
        emittedTotal += result.emittedAlerts;
      } catch (error) {
        logger.warn('[AGENT-SLO] evaluation failed guild=%s error=%s', guildId, error instanceof Error ? error.message : String(error));
      }
    }, SLO_LOOP_CONCURRENCY);

    logger.info('[AGENT-SLO] loop tick completed guilds=%d emittedAlerts=%d', guildIds.length, emittedTotal);
  } catch (error) {
    logger.warn('[AGENT-SLO] loop tick failed error=%s', error instanceof Error ? error.message : String(error));
  } finally {
    sloLoopRunning = false;
  }
};

const scheduleNextSloLoop = () => {
  if (!SLO_LOOP_ENABLED) {
    return;
  }
  const delayMs = SLO_LOOP_INTERVAL_MIN * 60 * 1000;
  sloLoopTimer = setTimeout(() => {
    void runSloLoopTick().finally(() => {
      scheduleNextSloLoop();
    });
  }, delayMs);
};

export const startAgentSloAlertLoop = () => {
  if (!SLO_LOOP_ENABLED || sloLoopTimer) {
    return;
  }
  if (SLO_LOOP_OWNER !== 'app') {
    logger.info('[AGENT-SLO] app loop skipped (owner=%s, delegated to pg_cron)', SLO_LOOP_OWNER);
    return;
  }
  scheduleNextSloLoop();
  logger.info('[AGENT-SLO] alert loop started (intervalMin=%d maxGuilds=%d)', SLO_LOOP_INTERVAL_MIN, SLO_LOOP_MAX_GUILDS);
};

export const stopAgentSloAlertLoop = () => {
  if (sloLoopTimer) {
    clearTimeout(sloLoopTimer);
    sloLoopTimer = null;
  }
};

import { getActionRunnerDiagnosticsSnapshot } from '../skills/actionRunner';
import { getWorkerProposalMetricsSnapshot } from '../workerGeneration/workerProposalMetrics';
import { buildGoNoGoReport } from '../goNoGoService';
import { getOpenJarvisMemorySyncStatus } from '../openjarvis/openjarvisMemorySyncStatusService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';
import { getAgentTelemetryQueueSnapshot } from './agentTelemetryQueue';

type ReadinessStatus = 'pass' | 'fail' | 'warn';

type ReadinessCheck = {
  id: string;
  category: 'evaluation' | 'safety' | 'observability';
  status: ReadinessStatus;
  label: string;
  actual: unknown;
  threshold: unknown;
  detail?: string;
};

const AGENT_READINESS_WINDOW_DAYS = parseMinIntEnv(process.env.AGENT_READINESS_WINDOW_DAYS, 30, 1);
const AGENT_READINESS_FAIL_OPEN = parseBooleanEnv(process.env.AGENT_READINESS_FAIL_OPEN, false);
const AGENT_READINESS_ALLOW_WARN = parseBooleanEnv(process.env.AGENT_READINESS_ALLOW_WARN, false);
const AGENT_READINESS_IS_PRODUCTION = parseStringEnv(process.env.NODE_ENV, '').toLowerCase() === 'production';
const AGENT_READINESS_EFFECTIVE_FAIL_OPEN = !AGENT_READINESS_IS_PRODUCTION && AGENT_READINESS_FAIL_OPEN;
const AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL = parseBooleanEnv(process.env.AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL, true);
const AGENT_READINESS_RETRIEVAL_MAX_AGE_HOURS = parseMinIntEnv(process.env.AGENT_READINESS_RETRIEVAL_MAX_AGE_HOURS, 24 * 7, 1);
const AGENT_READINESS_MIN_RETRIEVAL_NDCG = parseBoundedNumberEnv(process.env.AGENT_READINESS_MIN_RETRIEVAL_NDCG, 0.45, 0, 1);
const AGENT_READINESS_MAX_ACTION_FAILURE_RATE = parseBoundedNumberEnv(process.env.AGENT_READINESS_MAX_ACTION_FAILURE_RATE, 0.35, 0, 1);
const AGENT_READINESS_MAX_ACTION_MISSING_TOTAL = parseMinIntEnv(process.env.AGENT_READINESS_MAX_ACTION_MISSING_TOTAL, 5, 0);
const AGENT_READINESS_MAX_ACTION_POLICY_BLOCK_RATE = parseBoundedNumberEnv(process.env.AGENT_READINESS_MAX_ACTION_POLICY_BLOCK_RATE, 0.5, 0, 1);
const AGENT_READINESS_MIN_OBSERVED_RUNS = parseMinIntEnv(process.env.AGENT_READINESS_MIN_OBSERVED_RUNS, 5, 1);
const AGENT_READINESS_MIN_WORKER_GENERATION_SUCCESS_RATE = parseBoundedNumberEnv(process.env.AGENT_READINESS_MIN_WORKER_GENERATION_SUCCESS_RATE, 0.4, 0, 1);
const AGENT_READINESS_MIN_WORKER_APPROVAL_PASS_RATE = parseBoundedNumberEnv(process.env.AGENT_READINESS_MIN_WORKER_APPROVAL_PASS_RATE, 0.3, 0, 1);
const AGENT_READINESS_MIN_WORKER_APPROVAL_SAMPLES = parseMinIntEnv(process.env.AGENT_READINESS_MIN_WORKER_APPROVAL_SAMPLES, 3, 1);
const AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL = parseMinIntEnv(process.env.AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL, 0, 0);
const AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROP_RATE = parseBoundedNumberEnv(process.env.AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROP_RATE, 0.02, 0, 1);

if (AGENT_READINESS_IS_PRODUCTION && AGENT_READINESS_FAIL_OPEN) {
  throw new Error('AGENT_READINESS_FAIL_OPEN must be false in production');
}

const toStatus = (ok: boolean): ReadinessStatus => (ok ? 'pass' : 'fail');

const safeRate = (n: number, d: number): number => {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(4));
};

const getLatestRetrievalEvalSnapshot = async (guildId: string) => {
  if (!isSupabaseConfigured()) {
    return {
      exists: false,
      endedAt: null as string | null,
      ageHours: null as number | null,
      baselineNdcg: null as number | null,
    };
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('retrieval_eval_runs')
    .select('id, ended_at, status, summary')
    .eq('guild_id', guildId)
    .eq('status', 'completed')
    .order('ended_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return {
      exists: false,
      endedAt: null as string | null,
      ageHours: null as number | null,
      baselineNdcg: null as number | null,
    };
  }

  const row = data[0] as Record<string, unknown>;
  const endedAt = String(row.ended_at || '').trim() || null;
  const endedAtMs = endedAt ? Date.parse(endedAt) : NaN;
  const ageHours = Number.isFinite(endedAtMs)
    ? Number(((Date.now() - endedAtMs) / (60 * 60 * 1000)).toFixed(2))
    : null;

  const summary = row.summary && typeof row.summary === 'object'
    ? (row.summary as Record<string, unknown>)
    : {};
  const variants = summary.variants && typeof summary.variants === 'object'
    ? (summary.variants as Record<string, unknown>)
    : {};
  const baseline = variants.baseline && typeof variants.baseline === 'object'
    ? (variants.baseline as Record<string, unknown>)
    : {};
  const baselineNdcgRaw = Number(baseline.ndcg || 0);
  const baselineNdcg = Number.isFinite(baselineNdcgRaw) ? baselineNdcgRaw : null;

  return {
    exists: true,
    endedAt,
    ageHours,
    baselineNdcg,
  };
};

export const buildAgentRuntimeReadinessReport = async (params: {
  guildId: string;
  windowDays?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const windowDays = Math.max(1, Number(params.windowDays || AGENT_READINESS_WINDOW_DAYS));
  const [goNoGo, retrieval] = await Promise.all([
    buildGoNoGoReport({ guildId, days: windowDays }),
    getLatestRetrievalEvalSnapshot(guildId),
  ]);

  const action = getActionRunnerDiagnosticsSnapshot();
  const worker = getWorkerProposalMetricsSnapshot();
  const openjarvisMemorySync = getOpenJarvisMemorySyncStatus();
  const telemetryQueue = getAgentTelemetryQueueSnapshot();
  const telemetryAttempted = Math.max(1, telemetryQueue.processed + telemetryQueue.dropped);
  const telemetryDropRate = safeRate(telemetryQueue.dropped, telemetryAttempted);

  const checks: ReadinessCheck[] = [];

  checks.push({
    id: 'evaluation-go-no-go',
    category: 'evaluation',
    status: toStatus(goNoGo.decision === 'go'),
    label: 'go/no-go decision is go',
    actual: goNoGo.decision,
    threshold: 'go',
  });

  const retrievalExistsOk = AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL ? retrieval.exists : true;
  checks.push({
    id: 'evaluation-retrieval-exists',
    category: 'evaluation',
    status: toStatus(retrievalExistsOk),
    label: 'retrieval evaluation run exists',
    actual: retrieval.exists,
    threshold: AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL,
  });

  const retrievalFreshOk = !retrieval.exists || retrieval.ageHours === null
    ? !AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL
    : retrieval.ageHours <= AGENT_READINESS_RETRIEVAL_MAX_AGE_HOURS;
  checks.push({
    id: 'evaluation-retrieval-freshness',
    category: 'evaluation',
    status: retrieval.exists ? toStatus(retrievalFreshOk) : 'warn',
    label: 'retrieval eval freshness (hours)',
    actual: retrieval.ageHours,
    threshold: AGENT_READINESS_RETRIEVAL_MAX_AGE_HOURS,
    detail: retrieval.endedAt ? `latest completed: ${retrieval.endedAt}` : 'no completed retrieval run',
  });

  const retrievalNdcgOk = retrieval.baselineNdcg === null
    ? !AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL
    : retrieval.baselineNdcg >= AGENT_READINESS_MIN_RETRIEVAL_NDCG;
  checks.push({
    id: 'evaluation-retrieval-ndcg',
    category: 'evaluation',
    status: retrieval.baselineNdcg === null ? 'warn' : toStatus(retrievalNdcgOk),
    label: 'retrieval baseline ndcg',
    actual: retrieval.baselineNdcg,
    threshold: AGENT_READINESS_MIN_RETRIEVAL_NDCG,
  });

  const actionFailureRate = safeRate(action.failedRuns, Math.max(1, action.totalRuns));
  const actionObservedEnough = action.totalRuns >= AGENT_READINESS_MIN_OBSERVED_RUNS;
  checks.push({
    id: 'safety-action-failure-rate',
    category: 'safety',
    status: actionObservedEnough ? toStatus(actionFailureRate <= AGENT_READINESS_MAX_ACTION_FAILURE_RATE) : 'warn',
    label: 'action failure rate',
    actual: actionFailureRate,
    threshold: AGENT_READINESS_MAX_ACTION_FAILURE_RATE,
    detail: `runs=${action.totalRuns}`,
  });

  checks.push({
    id: 'observability-telemetry-queue-dropped-total',
    category: 'observability',
    status: toStatus(telemetryQueue.dropped <= AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL),
    label: 'telemetry queue dropped total',
    actual: telemetryQueue.dropped,
    threshold: AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL,
  });

  checks.push({
    id: 'observability-telemetry-queue-drop-rate',
    category: 'observability',
    status: toStatus(telemetryDropRate <= AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROP_RATE),
    label: 'telemetry queue drop rate',
    actual: telemetryDropRate,
    threshold: AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROP_RATE,
    detail: `processed=${telemetryQueue.processed}, dropped=${telemetryQueue.dropped}`,
  });

  const openjarvisMemorySyncRequired = openjarvisMemorySync.configured;
  const openjarvisMemorySyncHealthy = openjarvisMemorySync.status === 'fresh';
  checks.push({
    id: 'observability-openjarvis-memory-sync',
    category: 'observability',
    status: openjarvisMemorySyncHealthy ? 'pass' : openjarvisMemorySyncRequired ? 'fail' : 'warn',
    label: 'OpenJarvis memory sync freshness',
    actual: openjarvisMemorySync.status,
    threshold: openjarvisMemorySyncRequired ? 'fresh' : 'fresh (recommended)',
    detail: openjarvisMemorySync.issues[0] || openjarvisMemorySync.generatedAt || 'no OpenJarvis memory sync summary available',
  });

  checks.push({
    id: 'safety-action-missing-implementation',
    category: 'safety',
    status: toStatus((action.failureTotals.missingAction || 0) <= AGENT_READINESS_MAX_ACTION_MISSING_TOTAL),
    label: 'missing action failures total',
    actual: action.failureTotals.missingAction,
    threshold: AGENT_READINESS_MAX_ACTION_MISSING_TOTAL,
  });

  const policyBlockedRate = safeRate(action.failureTotals.policyBlocked || 0, Math.max(1, action.failureTotals.totalFailures || 1));
  checks.push({
    id: 'safety-policy-block-rate',
    category: 'safety',
    status: action.failureTotals.totalFailures > 0
      ? toStatus(policyBlockedRate <= AGENT_READINESS_MAX_ACTION_POLICY_BLOCK_RATE)
      : 'warn',
    label: 'policy blocked rate among failures',
    actual: policyBlockedRate,
    threshold: AGENT_READINESS_MAX_ACTION_POLICY_BLOCK_RATE,
  });

  checks.push({
    id: 'observability-run-samples',
    category: 'observability',
    status: toStatus(action.totalRuns >= AGENT_READINESS_MIN_OBSERVED_RUNS),
    label: 'action runner observed run count',
    actual: action.totalRuns,
    threshold: AGENT_READINESS_MIN_OBSERVED_RUNS,
  });

  checks.push({
    id: 'observability-worker-generation-success-rate',
    category: 'observability',
    status: worker.generationRequested > 0
      ? toStatus(worker.generationSuccessRate >= AGENT_READINESS_MIN_WORKER_GENERATION_SUCCESS_RATE)
      : 'warn',
    label: 'worker generation success rate',
    actual: worker.generationSuccessRate,
    threshold: AGENT_READINESS_MIN_WORKER_GENERATION_SUCCESS_RATE,
  });

  const workerApprovalSamples = worker.approvalsApproved + worker.approvalsRejected;
  checks.push({
    id: 'safety-worker-approval-pass-rate',
    category: 'safety',
    status: workerApprovalSamples >= AGENT_READINESS_MIN_WORKER_APPROVAL_SAMPLES
      ? toStatus(worker.approvalPassRate >= AGENT_READINESS_MIN_WORKER_APPROVAL_PASS_RATE)
      : 'warn',
    label: 'worker approval pass rate',
    actual: worker.approvalPassRate,
    threshold: AGENT_READINESS_MIN_WORKER_APPROVAL_PASS_RATE,
    detail: `samples=${workerApprovalSamples}`,
  });

  const failedChecks = checks.filter((check) => check.status === 'fail');
  const decision = failedChecks.length === 0 ? 'pass' : AGENT_READINESS_EFFECTIVE_FAIL_OPEN ? 'warn' : 'block';

  return {
    guildId,
    decision,
    failOpen: AGENT_READINESS_EFFECTIVE_FAIL_OPEN,
    generatedAt: new Date().toISOString(),
    windowDays,
    checks,
    failedCheckIds: failedChecks.map((check) => check.id),
    metrics: {
      goNoGoDecision: goNoGo.decision,
      actionDiagnostics: action,
      workerProposal: worker,
      retrievalLatest: retrieval,
      telemetryQueue,
      openjarvisMemorySync,
    },
  };
};

export const evaluateWorkerActivationGate = async (params: {
  guildId: string;
  actorId: string;
}) => {
  const report = await buildAgentRuntimeReadinessReport({ guildId: params.guildId });
  const allowed = report.decision === 'pass' || (report.decision === 'warn' && AGENT_READINESS_ALLOW_WARN);
  const reasons = report.checks
    .filter((check) => check.status === 'fail' || (check.status === 'warn' && !AGENT_READINESS_ALLOW_WARN))
    .map((check) => `${check.id}: ${check.label}`)
    .slice(0, 5);

  return {
    allowed,
    reasons,
    report,
  };
};
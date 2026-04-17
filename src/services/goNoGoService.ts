import {
  GO_NO_GO_MIN_CITATION_RATE,
  GO_NO_GO_MAX_UNRESOLVED_CONFLICT_RATE,
  GO_NO_GO_MAX_JOB_FAILURE_RATE,
  GO_NO_GO_MIN_RECALL_AT_5,
  GO_NO_GO_MIN_PILOT_GUILDS,
  GO_NO_GO_MAX_CORRECTION_SLA_P95_MIN,
  GO_NO_GO_MAX_LLM_P95_LATENCY_MS,
  GO_NO_GO_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL,
  GO_NO_GO_MAX_TELEMETRY_QUEUE_DROP_RATE,
  LLM_CALL_LOG_TABLE,
} from '../config';
import { getMemoryJobQueueStats } from './memory/memoryJobRunner';
import { getMemoryQualityMetrics } from './memory/memoryQualityMetricsService';
import { getOpenJarvisMemorySyncStatus } from './openjarvis/openjarvisMemorySyncStatusService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { getAgentTelemetryQueueSnapshot } from './agent/agentTelemetryQueue';

type GoNoGoParams = {
  guildId?: string;
  days: number;
};

const DEFAULT_THRESHOLDS = {
  minCitationRate: GO_NO_GO_MIN_CITATION_RATE,
  maxUnresolvedConflictRate: GO_NO_GO_MAX_UNRESOLVED_CONFLICT_RATE,
  maxJobFailureRate: GO_NO_GO_MAX_JOB_FAILURE_RATE,
  minRecallAt5: GO_NO_GO_MIN_RECALL_AT_5,
  minPilotGuilds: GO_NO_GO_MIN_PILOT_GUILDS,
  maxCorrectionSlaP95Minutes: GO_NO_GO_MAX_CORRECTION_SLA_P95_MIN,
  maxLlmP95LatencyMs: GO_NO_GO_MAX_LLM_P95_LATENCY_MS,
  maxTelemetryQueueDroppedTotal: GO_NO_GO_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL,
  maxTelemetryQueueDropRate: GO_NO_GO_MAX_TELEMETRY_QUEUE_DROP_RATE,
};

const toStatus = (ok: boolean): 'pass' | 'fail' => (ok ? 'pass' : 'fail');

const percentile = (values: number[], p: number): number | null => {
  const clean = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);

  if (clean.length === 0) {
    return null;
  }
  if (clean.length === 1) {
    return clean[0];
  }

  const rank = Math.ceil((p / 100) * clean.length) - 1;
  const index = Math.max(0, Math.min(clean.length - 1, rank));
  return clean[index];
};

const getLlmLatencyP95Ms = async (guildId: string | undefined, days: number): Promise<number | null> => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const sinceIso = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseClient();
  let query = client
    .from(LLM_CALL_LOG_TABLE)
    .select('latency_ms')
    .gte('created_at', sinceIso)
    .not('latency_ms', 'is', null);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query.limit(5000);
  if (error || !data || data.length === 0) {
    return null;
  }

  const latencies = (data as Array<Record<string, unknown>>)
    .map((row) => Number(row.latency_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return percentile(latencies, 95);
};

export const buildGoNoGoReport = async (params: GoNoGoParams) => {
  const [metrics, queue, llmLatencyP95Ms] = await Promise.all([
    getMemoryQualityMetrics({ guildId: params.guildId, days: params.days }),
    getMemoryJobQueueStats(params.guildId),
    getLlmLatencyP95Ms(params.guildId, params.days),
  ]);
  const telemetryQueue = getAgentTelemetryQueueSnapshot();
  const openjarvisMemorySync = getOpenJarvisMemorySyncStatus();
  const telemetryAttempted = Math.max(1, telemetryQueue.processed + telemetryQueue.dropped);
  const telemetryDropRate = Number((telemetryQueue.dropped / telemetryAttempted).toFixed(4));
  const requireOpenJarvisMemorySync = openjarvisMemorySync.configured;

  let pilotGuilds = 0;
  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    const { data } = await client
      .from('sources')
      .select('guild_id, is_active')
      .eq('is_active', true)
      .not('guild_id', 'is', null)
      .limit(5000);

    const set = new Set<string>();
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const guildId = String(row.guild_id || '').trim();
      if (guildId) {
        set.add(guildId);
      }
    }
    pilotGuilds = set.size;
  }

  const checks = [
    {
      id: 'citation-rate',
      label: 'citation_rate >= 0.95',
      actual: metrics.memory.citationRate,
      threshold: DEFAULT_THRESHOLDS.minCitationRate,
      status: toStatus(metrics.memory.citationRate >= DEFAULT_THRESHOLDS.minCitationRate),
    },
    {
      id: 'recall-at-5',
      label: 'recall@5(proxy) >= 0.60',
      actual: metrics.retrieval.recallAt5,
      threshold: DEFAULT_THRESHOLDS.minRecallAt5,
      status: toStatus(metrics.retrieval.recallAt5 >= DEFAULT_THRESHOLDS.minRecallAt5),
    },
    {
      id: 'conflict-rate',
      label: 'unresolved_conflict_rate <= 0.05',
      actual: metrics.conflicts.unresolvedConflictRate,
      threshold: DEFAULT_THRESHOLDS.maxUnresolvedConflictRate,
      status: toStatus(metrics.conflicts.unresolvedConflictRate <= DEFAULT_THRESHOLDS.maxUnresolvedConflictRate),
    },
    {
      id: 'job-failure-rate',
      label: 'job_failure_rate <= 0.10',
      actual: metrics.jobs.failureRate,
      threshold: DEFAULT_THRESHOLDS.maxJobFailureRate,
      status: toStatus(metrics.jobs.failureRate <= DEFAULT_THRESHOLDS.maxJobFailureRate),
    },
    {
      id: 'correction-sla-p95',
      label: 'correction_sla_p95_minutes <= 5',
      actual: metrics.feedback.correctionSlaP95Minutes,
      threshold: DEFAULT_THRESHOLDS.maxCorrectionSlaP95Minutes,
      status: toStatus(metrics.feedback.correctionSlaP95Minutes <= DEFAULT_THRESHOLDS.maxCorrectionSlaP95Minutes),
    },
    {
      id: 'llm-p95-latency',
      label: 'llm p95 latency should stay within SLO threshold',
      actual: llmLatencyP95Ms,
      threshold: DEFAULT_THRESHOLDS.maxLlmP95LatencyMs,
      status: toStatus(llmLatencyP95Ms === null || llmLatencyP95Ms <= DEFAULT_THRESHOLDS.maxLlmP95LatencyMs),
      detail: llmLatencyP95Ms === null ? 'No LLM latency samples found in the current go/no-go window.' : undefined,
    },
    {
      id: 'pilot-guilds',
      label: 'pilot guilds >= 3',
      actual: pilotGuilds,
      threshold: DEFAULT_THRESHOLDS.minPilotGuilds,
      status: toStatus(pilotGuilds >= DEFAULT_THRESHOLDS.minPilotGuilds),
    },
    {
      id: 'deadletter-queue',
      label: 'deadletter queue should be empty',
      actual: queue.deadlettered,
      threshold: 0,
      status: toStatus(queue.deadlettered <= 0),
    },
    {
      id: 'telemetry-queue-dropped-total',
      label: 'telemetry queue dropped total should stay low',
      actual: telemetryQueue.dropped,
      threshold: DEFAULT_THRESHOLDS.maxTelemetryQueueDroppedTotal,
      status: toStatus(telemetryQueue.dropped <= DEFAULT_THRESHOLDS.maxTelemetryQueueDroppedTotal),
    },
    {
      id: 'telemetry-queue-drop-rate',
      label: 'telemetry queue drop rate should stay low',
      actual: telemetryDropRate,
      threshold: DEFAULT_THRESHOLDS.maxTelemetryQueueDropRate,
      status: toStatus(telemetryDropRate <= DEFAULT_THRESHOLDS.maxTelemetryQueueDropRate),
    },
    {
      id: 'openjarvis-memory-sync',
      label: 'openjarvis memory sync should be fresh when configured',
      actual: openjarvisMemorySync.status,
      threshold: requireOpenJarvisMemorySync ? 'fresh' : 'optional',
      status: toStatus(!requireOpenJarvisMemorySync || openjarvisMemorySync.status === 'fresh'),
      detail: openjarvisMemorySync.issues[0] || undefined,
    },
  ];

  const failed = checks.filter((check) => check.status === 'fail');
  const decision = failed.length === 0 ? 'go' : 'no-go';

  // Signal bus: emit go/no-go verdict
  try {
    const { emitSignal } = await import('./runtime/signalBus');
    emitSignal(
      decision === 'go' ? 'gonogo.go' : 'gonogo.no-go',
      'goNoGoService',
      params.guildId || 'system',
      { decision, failedChecks: failed.map((c) => c.id), failedCount: failed.length },
    );
  } catch {
    // Best-effort signal emission
  }

  return {
    decision,
    scope: metrics.scope,
    windowDays: metrics.windowDays,
    generatedAt: new Date().toISOString(),
    checks,
    failedChecks: failed.map((check) => check.id),
    metrics,
    queue,
    telemetryQueue,
    openjarvisMemorySync,
    assumptions: [
      'recall@k is computed as proxy from retrieval logs (no human-labeled relevance set).',
      'pilot guild count is estimated from active sources by distinct guild_id.',
      'llm p95 latency is computed from logged LLM calls when Supabase telemetry is available.',
    ],
  };
};

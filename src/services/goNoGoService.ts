import { getMemoryJobQueueStats } from './memoryJobRunner';
import { getMemoryQualityMetrics } from './memoryQualityMetricsService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type GoNoGoParams = {
  guildId?: string;
  days: number;
};

const DEFAULT_THRESHOLDS = {
  minCitationRate: 0.95,
  maxUnresolvedConflictRate: 0.05,
  maxJobFailureRate: 0.10,
  minRecallAt5: 0.60,
  minPilotGuilds: 3,
  maxCorrectionSlaP95Minutes: 5,
};

const toStatus = (ok: boolean): 'pass' | 'fail' => (ok ? 'pass' : 'fail');

export const buildGoNoGoReport = async (params: GoNoGoParams) => {
  const metrics = await getMemoryQualityMetrics({ guildId: params.guildId, days: params.days });
  const queue = await getMemoryJobQueueStats(params.guildId);

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
  ];

  const failed = checks.filter((check) => check.status === 'fail');
  return {
    decision: failed.length === 0 ? 'go' : 'no-go',
    scope: metrics.scope,
    windowDays: metrics.windowDays,
    generatedAt: new Date().toISOString(),
    checks,
    failedChecks: failed.map((check) => check.id),
    metrics,
    queue,
    assumptions: [
      'recall@k is computed as proxy from retrieval logs (no human-labeled relevance set).',
      'pilot guild count is estimated from active sources by distinct guild_id.',
    ],
  };
};

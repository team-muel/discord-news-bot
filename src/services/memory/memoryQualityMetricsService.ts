import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getClient } from '../infra/baseRepository';
import { T_MEMORY_ITEMS, T_MEMORY_CONFLICTS, T_MEMORY_FEEDBACK, T_MEMORY_JOBS, T_MEMORY_RETRIEVAL_LOGS } from '../infra/tableRegistry';

type MetricsParams = {
  guildId?: string;
  days: number;
};

const toIsoFromDays = (days: number): string => {
  const ms = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
};

export async function getMemoryQualityMetrics(params: MetricsParams) {
  const client = getClient();
  if (!client) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const sinceIso = toIsoFromDays(params.days);

  let itemsQuery = client
    .from(T_MEMORY_ITEMS)
    .select('status, source_count, pinned, approved_at, updated_at')
    .gte('updated_at', sinceIso)
    .limit(5000);

  let conflictQuery = client
    .from(T_MEMORY_CONFLICTS)
    .select('status, created_at')
    .gte('created_at', sinceIso)
    .limit(5000);

  let feedbackQuery = client
    .from(T_MEMORY_FEEDBACK)
    .select('memory_item_id, action, created_at')
    .gte('created_at', sinceIso)
    .limit(5000);

  let jobsQuery = client
    .from(T_MEMORY_JOBS)
    .select('status, attempts, created_at, completed_at, deadlettered_at')
    .gte('created_at', sinceIso)
    .limit(5000);

  let retrievalQuery = client
    .from(T_MEMORY_RETRIEVAL_LOGS)
    .select('query_latency_ms, requested_top_k, returned_count, avg_citations, avg_score, created_at')
    .gte('created_at', sinceIso)
    .limit(5000);

  if (params.guildId) {
    itemsQuery = itemsQuery.eq('guild_id', params.guildId);
    conflictQuery = conflictQuery.eq('guild_id', params.guildId);
    feedbackQuery = feedbackQuery.eq('guild_id', params.guildId);
    jobsQuery = jobsQuery.eq('guild_id', params.guildId);
    retrievalQuery = retrievalQuery.eq('guild_id', params.guildId);
  }

  const [itemsRes, conflictRes, feedbackRes, jobsRes, retrievalRes] = await Promise.all([
    itemsQuery,
    conflictQuery,
    feedbackQuery,
    jobsQuery,
    retrievalQuery,
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message || 'MEMORY_ITEMS_METRICS_FAILED');
  if (conflictRes.error) throw new Error(conflictRes.error.message || 'MEMORY_CONFLICT_METRICS_FAILED');
  if (feedbackRes.error) throw new Error(feedbackRes.error.message || 'MEMORY_FEEDBACK_METRICS_FAILED');
  if (jobsRes.error) throw new Error(jobsRes.error.message || 'MEMORY_JOBS_METRICS_FAILED');
  const retrievalTableMissing = Boolean(retrievalRes.error && /memory_retrieval_logs/i.test(retrievalRes.error.message || ''));
  if (retrievalRes.error && !retrievalTableMissing) {
    throw new Error(retrievalRes.error.message || 'MEMORY_RETRIEVAL_METRICS_FAILED');
  }

  const items = (itemsRes.data || []) as Array<Record<string, unknown>>;
  const conflicts = (conflictRes.data || []) as Array<Record<string, unknown>>;
  const feedback = (feedbackRes.data || []) as Array<Record<string, unknown>>;
  const jobs = (jobsRes.data || []) as Array<Record<string, unknown>>;
  const retrieval = retrievalTableMissing ? [] : (retrievalRes.data || []) as Array<Record<string, unknown>>;

  const activeItems = items.filter((row) => String(row.status || '') === 'active').length;
  const withSource = items.filter((row) => Number(row.source_count || 0) > 0).length;
  const pinnedItems = items.filter((row) => Boolean(row.pinned)).length;
  const approvedItems = items.filter((row) => Boolean(row.approved_at)).length;

  const openConflicts = conflicts.filter((row) => String(row.status || '') === 'open').length;
  const resolvedConflicts = conflicts.filter((row) => String(row.status || '') === 'resolved').length;

  const correctionActions = feedback.filter((row) => {
    const action = String(row.action || '');
    return action === 'edit' || action === 'deprecate' || action === 'restore' || action === 'approve' || action === 'reject';
  }).length;

  const correctionRows = feedback.filter((row) => {
    const action = String(row.action || '');
    return action === 'edit' || action === 'deprecate' || action === 'restore' || action === 'approve' || action === 'reject';
  });

  const correctionItemIds = Array.from(new Set(correctionRows
    .map((row) => String(row.memory_item_id || '').trim())
    .filter(Boolean)));

  const updatedAtByMemoryId = new Map<string, string>();
  if (correctionItemIds.length > 0) {
    const { data: correctedItems, error: correctedItemsError } = await client
      .from(T_MEMORY_ITEMS)
      .select('id, updated_at')
      .in('id', correctionItemIds)
      .limit(5000);

    if (correctedItemsError) {
      throw new Error(correctedItemsError.message || 'MEMORY_CORRECTION_SLA_FAILED');
    }

    for (const row of (correctedItems || []) as Array<Record<string, unknown>>) {
      const id = String(row.id || '').trim();
      const updatedAt = String(row.updated_at || '').trim();
      if (id && updatedAt) {
        updatedAtByMemoryId.set(id, updatedAt);
      }
    }
  }

  const correctionSlaMinutes: number[] = [];
  for (const row of correctionRows) {
    const memoryId = String(row.memory_item_id || '').trim();
    const feedbackAt = Date.parse(String(row.created_at || ''));
    const updatedAt = Date.parse(updatedAtByMemoryId.get(memoryId) || '');
    if (!Number.isFinite(feedbackAt) || !Number.isFinite(updatedAt)) {
      continue;
    }
    const minutes = Math.max(0, (updatedAt - feedbackAt) / (1000 * 60));
    correctionSlaMinutes.push(minutes);
  }

  correctionSlaMinutes.sort((a, b) => a - b);
  const correctionSlaP95Minutes = correctionSlaMinutes.length > 0
    ? Number(correctionSlaMinutes[Math.min(correctionSlaMinutes.length - 1, Math.floor(correctionSlaMinutes.length * 0.95))].toFixed(2))
    : 0;
  const correctionSlaWithin5mRate = correctionSlaMinutes.length > 0
    ? Number((correctionSlaMinutes.filter((v) => v <= 5).length / correctionSlaMinutes.length).toFixed(4))
    : 0;

  const jobCompleted = jobs.filter((row) => String(row.status || '') === 'completed').length;
  const jobFailed = jobs.filter((row) => String(row.status || '') === 'failed').length;
  const jobDeadlettered = jobs.filter((row) => Boolean(row.deadlettered_at)).length;

  const attemptTotal = jobs.reduce((acc, row) => acc + Math.max(0, Number(row.attempts || 0)), 0);
  const avgAttempts = jobs.length > 0 ? Number((attemptTotal / jobs.length).toFixed(2)) : 0;

  const citationRate = activeItems > 0 ? Number((withSource / activeItems).toFixed(4)) : 0;
  const unresolvedConflictRate = activeItems > 0 ? Number((openConflicts / activeItems).toFixed(4)) : 0;
  const correctionFollowupRate = activeItems > 0 ? Number((correctionActions / activeItems).toFixed(4)) : 0;
  const jobFailureRate = jobs.length > 0 ? Number((jobFailed / jobs.length).toFixed(4)) : 0;

  const retrievalTotal = retrieval.length;
  const retrievalLatencyAvgMs = retrievalTotal > 0
    ? Number((retrieval.reduce((acc, row) => acc + Math.max(0, Number(row.query_latency_ms || 0)), 0) / retrievalTotal).toFixed(2))
    : 0;
  const retrievalReturnedAvg = retrievalTotal > 0
    ? Number((retrieval.reduce((acc, row) => acc + Math.max(0, Number(row.returned_count || 0)), 0) / retrievalTotal).toFixed(2))
    : 0;
  const retrievalCitationsAvg = retrievalTotal > 0
    ? Number((retrieval.reduce((acc, row) => acc + Math.max(0, Number(row.avg_citations || 0)), 0) / retrievalTotal).toFixed(2))
    : 0;
  const retrievalScoreAvg = retrievalTotal > 0
    ? Number((retrieval.reduce((acc, row) => acc + Math.max(0, Number(row.avg_score || 0)), 0) / retrievalTotal).toFixed(4))
    : 0;

  const proxyRelevantThreshold = 0.45;
  const retrievalHitAt1 = retrieval.filter((row) => {
    const returned = Number(row.returned_count || 0);
    const avgScore = Number(row.avg_score || 0);
    return returned >= 1 && avgScore >= proxyRelevantThreshold;
  }).length;
  const retrievalHitAt3 = retrieval.filter((row) => {
    const returned = Number(row.returned_count || 0);
    const avgScore = Number(row.avg_score || 0);
    return returned >= 3 && avgScore >= proxyRelevantThreshold;
  }).length;
  const retrievalHitAt5 = retrieval.filter((row) => {
    const returned = Number(row.returned_count || 0);
    const avgScore = Number(row.avg_score || 0);
    return returned >= 5 && avgScore >= proxyRelevantThreshold;
  }).length;

  const recallAt1 = retrievalTotal > 0 ? Number((retrievalHitAt1 / retrievalTotal).toFixed(4)) : 0;
  const recallAt3 = retrievalTotal > 0 ? Number((retrievalHitAt3 / retrievalTotal).toFixed(4)) : 0;
  const recallAt5 = retrievalTotal > 0 ? Number((retrievalHitAt5 / retrievalTotal).toFixed(4)) : 0;

  return {
    scope: params.guildId || 'all',
    windowDays: params.days,
    since: sinceIso,
    memory: {
      activeItems,
      withSource,
      pinnedItems,
      approvedItems,
      citationRate,
    },
    conflicts: {
      open: openConflicts,
      resolved: resolvedConflicts,
      unresolvedConflictRate,
    },
    feedback: {
      totalActions: feedback.length,
      correctionActions,
      correctionFollowupRate,
      correctionSlaSamples: correctionSlaMinutes.length,
      correctionSlaP95Minutes,
      correctionSlaWithin5mRate,
    },
    jobs: {
      total: jobs.length,
      completed: jobCompleted,
      failed: jobFailed,
      deadlettered: jobDeadlettered,
      avgAttempts,
      failureRate: jobFailureRate,
    },
    retrieval: {
      totalQueries: retrievalTotal,
      avgLatencyMs: retrievalLatencyAvgMs,
      avgReturned: retrievalReturnedAvg,
      avgCitations: retrievalCitationsAvg,
      avgScore: retrievalScoreAvg,
      recallAt1,
      recallAt3,
      recallAt5,
      recallMethod: 'proxy: returned_count>=k and avg_score>=0.45',
    },
    generatedAt: new Date().toISOString(),
  };
}

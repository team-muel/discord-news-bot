import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type LlmExperimentSummary = {
  experimentName: string;
  windowDays: number;
  guildId?: string;
  totals: {
    calls: number;
    success: number;
    failure: number;
    avgLatencyMs: number;
    estimatedCostUsd: number;
  };
  byArm: Array<{
    arm: string;
    calls: number;
    successRate: number;
    avgLatencyMs: number;
    estimatedCostUsd: number;
    avgLogprob: number | null;
    byProvider: Array<{
      provider: string;
      calls: number;
      successRate: number;
      avgLatencyMs: number;
      estimatedCostUsd: number;
    }>;
  }>;
};

type LlmLogRow = {
  provider?: unknown;
  experiment_arm?: unknown;
  success?: unknown;
  latency_ms?: unknown;
  estimated_cost_usd?: unknown;
  avg_logprob?: unknown;
};

const toNum = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (value: number): number => Number(value.toFixed(2));
const round6 = (value: number): number => Number(value.toFixed(6));

export const getLlmExperimentSummary = async (params: {
  experimentName: string;
  days?: number;
  guildId?: string;
}): Promise<LlmExperimentSummary> => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const experimentName = String(params.experimentName || '').trim();
  if (!experimentName) {
    throw new Error('VALIDATION');
  }

  const days = Math.max(1, Math.min(180, Math.trunc(Number(params.days || 14))));
  const guildId = String(params.guildId || '').trim() || undefined;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const client = getSupabaseClient();
  let query = client
    .from('agent_llm_call_logs')
    .select('provider, experiment_arm, success, latency_ms, estimated_cost_usd, avg_logprob')
    .eq('experiment_name', experimentName)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'LLM_EXPERIMENT_SUMMARY_QUERY_FAILED');
  }

  const rows = (data || []) as LlmLogRow[];
  const totalCalls = rows.length;
  const totalSuccess = rows.filter((row) => Boolean(row.success)).length;
  const totalFailure = totalCalls - totalSuccess;
  const totalLatency = rows.reduce((acc, row) => acc + Math.max(0, toNum(row.latency_ms)), 0);
  const totalCost = rows.reduce((acc, row) => acc + Math.max(0, toNum(row.estimated_cost_usd)), 0);

  const armMap = new Map<string, LlmLogRow[]>();
  for (const row of rows) {
    const arm = String(row.experiment_arm || 'unknown').trim() || 'unknown';
    const bucket = armMap.get(arm) || [];
    bucket.push(row);
    armMap.set(arm, bucket);
  }

  const byArm = [...armMap.entries()].map(([arm, armRows]) => {
    const calls = armRows.length;
    const success = armRows.filter((row) => Boolean(row.success)).length;
    const latencyTotal = armRows.reduce((acc, row) => acc + Math.max(0, toNum(row.latency_ms)), 0);
    const costTotal = armRows.reduce((acc, row) => acc + Math.max(0, toNum(row.estimated_cost_usd)), 0);
    const logprobRows = armRows.map((row) => Number(row.avg_logprob)).filter((n) => Number.isFinite(n));
    const avgLogprob = logprobRows.length > 0
      ? logprobRows.reduce((acc, value) => acc + value, 0) / logprobRows.length
      : null;

    const providerMap = new Map<string, LlmLogRow[]>();
    for (const row of armRows) {
      const provider = String(row.provider || 'unknown').trim() || 'unknown';
      const providerRows = providerMap.get(provider) || [];
      providerRows.push(row);
      providerMap.set(provider, providerRows);
    }

    const byProvider = [...providerMap.entries()].map(([provider, providerRows]) => {
      const providerCalls = providerRows.length;
      const providerSuccess = providerRows.filter((row) => Boolean(row.success)).length;
      const providerLatency = providerRows.reduce((acc, row) => acc + Math.max(0, toNum(row.latency_ms)), 0);
      const providerCost = providerRows.reduce((acc, row) => acc + Math.max(0, toNum(row.estimated_cost_usd)), 0);
      return {
        provider,
        calls: providerCalls,
        successRate: providerCalls > 0 ? round2((providerSuccess / providerCalls) * 100) : 0,
        avgLatencyMs: providerCalls > 0 ? round2(providerLatency / providerCalls) : 0,
        estimatedCostUsd: round6(providerCost),
      };
    }).sort((a, b) => b.calls - a.calls);

    return {
      arm,
      calls,
      successRate: calls > 0 ? round2((success / calls) * 100) : 0,
      avgLatencyMs: calls > 0 ? round2(latencyTotal / calls) : 0,
      estimatedCostUsd: round6(costTotal),
      avgLogprob: avgLogprob === null ? null : round6(avgLogprob),
      byProvider,
    };
  }).sort((a, b) => b.calls - a.calls);

  return {
    experimentName,
    windowDays: days,
    guildId,
    totals: {
      calls: totalCalls,
      success: totalSuccess,
      failure: totalFailure,
      avgLatencyMs: totalCalls > 0 ? round2(totalLatency / totalCalls) : 0,
      estimatedCostUsd: round6(totalCost),
    },
    byArm,
  };
};

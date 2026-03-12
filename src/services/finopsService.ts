import { parseBooleanEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type FinopsSummaryParams = {
  guildId?: string;
  days: number;
};

type FinopsMode = 'normal' | 'degraded' | 'blocked';

type FinopsBudgetStatus = {
  enabled: boolean;
  guildId: string;
  mode: FinopsMode;
  daily: {
    spendUsd: number;
    budgetUsd: number;
    utilization: number;
  };
  monthly: {
    spendUsd: number;
    budgetUsd: number;
    utilization: number;
  };
  thresholds: {
    degrade: number;
    block: number;
  };
  generatedAt: string;
};

type FinopsActionDecision = {
  allow: boolean;
  reason: string;
  mode: FinopsMode;
};

const FINOPS_ENABLED = parseBooleanEnv(process.env.FINOPS_ENABLED, true);
const FINOPS_ACTION_BASE_COST_USD = Math.max(0, Number(process.env.FINOPS_ACTION_BASE_COST_USD || 0.002));
const FINOPS_ACTION_RETRY_COST_USD = Math.max(0, Number(process.env.FINOPS_ACTION_RETRY_COST_USD || 0.0008));
const FINOPS_ACTION_DURATION_MS_COST_USD = Math.max(0, Number(process.env.FINOPS_ACTION_DURATION_MS_COST_USD || 0.0000015));
const FINOPS_ACTION_FAILURE_PENALTY_USD = Math.max(0, Number(process.env.FINOPS_ACTION_FAILURE_PENALTY_USD || 0.0007));
const FINOPS_RETRIEVAL_QUERY_COST_USD = Math.max(0, Number(process.env.FINOPS_RETRIEVAL_QUERY_COST_USD || 0.0006));
const FINOPS_MEMORY_JOB_COST_USD = Math.max(0, Number(process.env.FINOPS_MEMORY_JOB_COST_USD || 0.0012));

const FINOPS_DAILY_BUDGET_USD = Math.max(0.01, Number(process.env.FINOPS_DAILY_BUDGET_USD || 5));
const FINOPS_MONTHLY_BUDGET_USD = Math.max(0.1, Number(process.env.FINOPS_MONTHLY_BUDGET_USD || 100));
const FINOPS_DEGRADE_THRESHOLD_PCT = Math.max(0.1, Math.min(2, Number(process.env.FINOPS_DEGRADE_THRESHOLD_PCT || 0.9)));
const FINOPS_HARD_BLOCK_THRESHOLD_PCT = Math.max(FINOPS_DEGRADE_THRESHOLD_PCT, Math.min(3, Number(process.env.FINOPS_HARD_BLOCK_THRESHOLD_PCT || 1.0)));

const csvSet = (raw: string | undefined, fallback: string[]): Set<string> => {
  const list = String(raw || '').split(',').map((v) => v.trim()).filter(Boolean);
  return new Set((list.length > 0 ? list : fallback).map((v) => v.trim()));
};

const FINOPS_DEGRADE_ALLOWED_ACTIONS = csvSet(
  process.env.FINOPS_DEGRADE_ALLOWED_ACTIONS,
  ['rag.retrieve', 'stock.quote', 'stock.chart', 'privacy.forget.user', 'privacy.forget.guild'],
);
const FINOPS_HARD_BLOCK_EXEMPT_ACTIONS = csvSet(
  process.env.FINOPS_HARD_BLOCK_EXEMPT_ACTIONS,
  ['privacy.forget.user', 'privacy.forget.guild'],
);

const CACHE_TTL_MS = Math.max(10_000, Number(process.env.FINOPS_CACHE_TTL_MS || 60_000));
const budgetCache = new Map<string, { value: FinopsBudgetStatus; expiresAt: number }>();

const toIsoFromDays = (days: number): string => {
  const d = Math.max(1, Math.trunc(days));
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
};

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));

const estimateActionCostFromRow = (row: Record<string, unknown>): number => {
  const retry = Math.max(0, Number(row.retry_count || 0));
  const durationMs = Math.max(0, Number(row.duration_ms || 0));
  const status = String(row.status || '').toLowerCase();

  const base = FINOPS_ACTION_BASE_COST_USD;
  const retryCost = retry * FINOPS_ACTION_RETRY_COST_USD;
  const durationCost = durationMs * FINOPS_ACTION_DURATION_MS_COST_USD;
  const failurePenalty = status === 'failed' ? FINOPS_ACTION_FAILURE_PENALTY_USD : 0;
  return round(base + retryCost + durationCost + failurePenalty);
};

export const estimateActionExecutionCostUsd = (params: {
  ok: boolean;
  retryCount: number;
  durationMs: number;
}): number => {
  const base = FINOPS_ACTION_BASE_COST_USD;
  const retryCost = Math.max(0, params.retryCount) * FINOPS_ACTION_RETRY_COST_USD;
  const durationCost = Math.max(0, params.durationMs) * FINOPS_ACTION_DURATION_MS_COST_USD;
  const failurePenalty = params.ok ? 0 : FINOPS_ACTION_FAILURE_PENALTY_USD;
  return round(base + retryCost + durationCost + failurePenalty);
};

export const getFinopsSummary = async (params: FinopsSummaryParams) => {
  const days = Math.max(1, Math.trunc(params.days));
  const since = toIsoFromDays(days);

  if (!isSupabaseConfigured()) {
    return {
      scope: params.guildId || 'all',
      windowDays: days,
      since,
      enabled: FINOPS_ENABLED,
      totals: {
        actionCostUsd: 0,
        retrievalCostUsd: 0,
        memoryJobCostUsd: 0,
        estimatedTotalUsd: 0,
      },
      topActions: [],
      byGuild: [],
      generatedAt: new Date().toISOString(),
      assumptions: ['SUPABASE not configured; summary is empty.'],
    };
  }

  const client = getSupabaseClient();

  let actionQuery = client
    .from('agent_action_logs')
    .select('guild_id, action_name, status, retry_count, duration_ms, created_at')
    .gte('created_at', since)
    .limit(10000);
  let retrievalQuery = client
    .from('memory_retrieval_logs')
    .select('guild_id, created_at')
    .gte('created_at', since)
    .limit(10000);
  let jobsQuery = client
    .from('memory_jobs')
    .select('guild_id, status, created_at')
    .gte('created_at', since)
    .limit(10000);

  if (params.guildId) {
    actionQuery = actionQuery.eq('guild_id', params.guildId);
    retrievalQuery = retrievalQuery.eq('guild_id', params.guildId);
    jobsQuery = jobsQuery.eq('guild_id', params.guildId);
  }

  const [actionRes, retrievalRes, jobsRes] = await Promise.all([
    actionQuery,
    retrievalQuery,
    jobsQuery,
  ]);

  if (actionRes.error) throw new Error(actionRes.error.message || 'FINOPS_ACTION_QUERY_FAILED');
  if (retrievalRes.error) throw new Error(retrievalRes.error.message || 'FINOPS_RETRIEVAL_QUERY_FAILED');
  if (jobsRes.error) throw new Error(jobsRes.error.message || 'FINOPS_JOBS_QUERY_FAILED');

  const actionRows = (actionRes.data || []) as Array<Record<string, unknown>>;
  const retrievalRows = (retrievalRes.data || []) as Array<Record<string, unknown>>;
  const jobRows = (jobsRes.data || []) as Array<Record<string, unknown>>;

  const actionByName = new Map<string, { runs: number; costUsd: number }>();
  const byGuild = new Map<string, { actionCostUsd: number; retrievalCostUsd: number; memoryJobCostUsd: number }>();

  let actionCostUsd = 0;
  for (const row of actionRows) {
    const actionName = String(row.action_name || 'unknown');
    const guildId = String(row.guild_id || 'unknown');
    const cost = estimateActionCostFromRow(row);
    actionCostUsd += cost;

    const actionAgg = actionByName.get(actionName) || { runs: 0, costUsd: 0 };
    actionAgg.runs += 1;
    actionAgg.costUsd = round(actionAgg.costUsd + cost);
    actionByName.set(actionName, actionAgg);

    const guildAgg = byGuild.get(guildId) || { actionCostUsd: 0, retrievalCostUsd: 0, memoryJobCostUsd: 0 };
    guildAgg.actionCostUsd = round(guildAgg.actionCostUsd + cost);
    byGuild.set(guildId, guildAgg);
  }

  const retrievalCostUsd = round(retrievalRows.length * FINOPS_RETRIEVAL_QUERY_COST_USD);
  for (const row of retrievalRows) {
    const guildId = String(row.guild_id || 'unknown');
    const guildAgg = byGuild.get(guildId) || { actionCostUsd: 0, retrievalCostUsd: 0, memoryJobCostUsd: 0 };
    guildAgg.retrievalCostUsd = round(guildAgg.retrievalCostUsd + FINOPS_RETRIEVAL_QUERY_COST_USD);
    byGuild.set(guildId, guildAgg);
  }

  const memoryJobCostUsd = round(jobRows.length * FINOPS_MEMORY_JOB_COST_USD);
  for (const row of jobRows) {
    const guildId = String(row.guild_id || 'unknown');
    const guildAgg = byGuild.get(guildId) || { actionCostUsd: 0, retrievalCostUsd: 0, memoryJobCostUsd: 0 };
    guildAgg.memoryJobCostUsd = round(guildAgg.memoryJobCostUsd + FINOPS_MEMORY_JOB_COST_USD);
    byGuild.set(guildId, guildAgg);
  }

  const estimatedTotalUsd = round(actionCostUsd + retrievalCostUsd + memoryJobCostUsd);

  const topActions = [...actionByName.entries()]
    .map(([actionName, value]) => ({ actionName, runs: value.runs, costUsd: round(value.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10);

  const byGuildRows = [...byGuild.entries()]
    .map(([guildId, value]) => ({
      guildId,
      actionCostUsd: round(value.actionCostUsd),
      retrievalCostUsd: round(value.retrievalCostUsd),
      memoryJobCostUsd: round(value.memoryJobCostUsd),
      estimatedTotalUsd: round(value.actionCostUsd + value.retrievalCostUsd + value.memoryJobCostUsd),
    }))
    .sort((a, b) => b.estimatedTotalUsd - a.estimatedTotalUsd);

  return {
    scope: params.guildId || 'all',
    windowDays: days,
    since,
    enabled: FINOPS_ENABLED,
    totals: {
      actionCostUsd: round(actionCostUsd),
      retrievalCostUsd,
      memoryJobCostUsd,
      estimatedTotalUsd,
    },
    topActions,
    byGuild: byGuildRows,
    generatedAt: new Date().toISOString(),
    assumptions: [
      'Costs are estimated from runtime logs and configurable unit prices.',
      'LLM token usage is approximated via action duration and retries.',
    ],
  };
};

const resolveMode = (dailyUtil: number, monthlyUtil: number): FinopsMode => {
  const util = Math.max(dailyUtil, monthlyUtil);
  if (util >= FINOPS_HARD_BLOCK_THRESHOLD_PCT) {
    return 'blocked';
  }
  if (util >= FINOPS_DEGRADE_THRESHOLD_PCT) {
    return 'degraded';
  }
  return 'normal';
};

export const getFinopsBudgetStatus = async (guildId: string): Promise<FinopsBudgetStatus> => {
  if (!FINOPS_ENABLED) {
    return {
      enabled: false,
      guildId,
      mode: 'normal',
      daily: { spendUsd: 0, budgetUsd: FINOPS_DAILY_BUDGET_USD, utilization: 0 },
      monthly: { spendUsd: 0, budgetUsd: FINOPS_MONTHLY_BUDGET_USD, utilization: 0 },
      thresholds: { degrade: FINOPS_DEGRADE_THRESHOLD_PCT, block: FINOPS_HARD_BLOCK_THRESHOLD_PCT },
      generatedAt: new Date().toISOString(),
    };
  }

  const cacheKey = guildId;
  const cached = budgetCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [daily, monthly] = await Promise.all([
    getFinopsSummary({ guildId, days: 1 }),
    getFinopsSummary({ guildId, days: 30 }),
  ]);

  const dailyUtil = daily.totals.estimatedTotalUsd / FINOPS_DAILY_BUDGET_USD;
  const monthlyUtil = monthly.totals.estimatedTotalUsd / FINOPS_MONTHLY_BUDGET_USD;
  const mode = resolveMode(dailyUtil, monthlyUtil);

  const value: FinopsBudgetStatus = {
    enabled: true,
    guildId,
    mode,
    daily: {
      spendUsd: daily.totals.estimatedTotalUsd,
      budgetUsd: FINOPS_DAILY_BUDGET_USD,
      utilization: round(dailyUtil, 4),
    },
    monthly: {
      spendUsd: monthly.totals.estimatedTotalUsd,
      budgetUsd: FINOPS_MONTHLY_BUDGET_USD,
      utilization: round(monthlyUtil, 4),
    },
    thresholds: {
      degrade: FINOPS_DEGRADE_THRESHOLD_PCT,
      block: FINOPS_HARD_BLOCK_THRESHOLD_PCT,
    },
    generatedAt: new Date().toISOString(),
  };

  budgetCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
};

export const decideFinopsAction = (params: {
  budget: FinopsBudgetStatus;
  actionName: string;
}): FinopsActionDecision => {
  if (!FINOPS_ENABLED || !params.budget.enabled) {
    return { allow: true, reason: 'FINOPS_DISABLED', mode: 'normal' };
  }

  if (params.budget.mode === 'blocked') {
    if (FINOPS_HARD_BLOCK_EXEMPT_ACTIONS.has(params.actionName)) {
      return { allow: true, reason: 'FINOPS_BLOCK_BYPASS_EXEMPT', mode: 'blocked' };
    }
    return { allow: false, reason: 'FINOPS_BUDGET_HARD_BLOCK', mode: 'blocked' };
  }

  if (params.budget.mode === 'degraded') {
    if (FINOPS_DEGRADE_ALLOWED_ACTIONS.has(params.actionName)) {
      return { allow: true, reason: 'FINOPS_DEGRADE_ALLOWED', mode: 'degraded' };
    }
    return { allow: false, reason: 'FINOPS_DEGRADED_ACTION_SKIPPED', mode: 'degraded' };
  }

  return { allow: true, reason: 'FINOPS_NORMAL', mode: 'normal' };
};

import { buildWorkerApprovalGateSnapshot } from '../agent';
import { getFinopsBudgetStatus } from '../finopsService';
import logger from '../../logger';
import { CircuitBreaker } from '../../utils/circuitBreaker';
import { getErrorMessage } from '../../utils/errorMessage';
import { TtlCache } from '../../utils/ttlCache';
import {
  ACTION_CACHE_MAX_ENTRIES,
  ACTION_CIRCUIT_FAILURE_THRESHOLD,
  ACTION_CIRCUIT_OPEN_MS,
  FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS,
  GATE_VERDICT_CACHE_TTL_MS,
} from './actionRunnerConfig';

type GateVerdictCacheEntry = {
  overall: string;
  providerProfileTarget: string | null;
  fetchedAt: number;
};

export type ActionResultCacheEntry = {
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  agentRole?: 'operate' | 'implement' | 'review' | 'architect';
  handoff?: {
    fromAgent: 'operate' | 'implement' | 'review' | 'architect';
    toAgent: 'operate' | 'implement' | 'review' | 'architect';
    reason?: string;
    evidenceId?: string;
  };
};

const ACTION_UTILITY_MAX_ACTIONS = 100;

const createActionResultCache = () => new TtlCache<ActionResultCacheEntry>(ACTION_CACHE_MAX_ENTRIES);

const createActionCircuitBreaker = () => new CircuitBreaker({
  failureThreshold: ACTION_CIRCUIT_FAILURE_THRESHOLD,
  cooldownMs: ACTION_CIRCUIT_OPEN_MS,
  maxEntries: 500,
});

export let actionResultCache = createActionResultCache();
export let actionCircuitBreaker = createActionCircuitBreaker();

const actionUtilityScores = new Map<string, { runs: number; successes: number; lastFailedAt: number }>();
let cachedGateVerdict = new Map<string, GateVerdictCacheEntry>();
let lastFinopsBudgetFetchErrorLogAt = 0;

export const updateActionUtility = (actionName: string, succeeded: boolean): void => {
  const current = actionUtilityScores.get(actionName) || { runs: 0, successes: 0, lastFailedAt: 0 };
  current.runs += 1;
  if (succeeded) {
    current.successes += 1;
  } else {
    current.lastFailedAt = Date.now();
  }
  actionUtilityScores.set(actionName, current);
  if (actionUtilityScores.size > ACTION_UTILITY_MAX_ACTIONS) {
    const first = actionUtilityScores.keys().next().value;
    if (first !== undefined) actionUtilityScores.delete(first);
  }
};

export const getActionUtilityScore = (actionName: string): { successRate: number; runs: number; recentlyFailed: boolean } => {
  const entry = actionUtilityScores.get(actionName);
  if (!entry || entry.runs === 0) return { successRate: 1, runs: 0, recentlyFailed: false };
  return {
    successRate: entry.successes / entry.runs,
    runs: entry.runs,
    recentlyFailed: (Date.now() - entry.lastFailedAt) < 60_000,
  };
};

export const getFinopsBudgetStatusSafely = async (guildId: string) => {
  try {
    return await getFinopsBudgetStatus(guildId);
  } catch (error) {
    const now = Date.now();
    if (now - lastFinopsBudgetFetchErrorLogAt >= FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS) {
      lastFinopsBudgetFetchErrorLogAt = now;
      logger.warn(
        '[ACTION-RUNNER] FinOps budget lookup failed; fallback to normal mode (throttled): %s',
        getErrorMessage(error),
      );
    }
    return null;
  }
};

export const getLatestGateVerdict = async (guildId: string): Promise<{ overall: string | null; providerProfileTarget: string | null }> => {
  const now = Date.now();
  const cached = cachedGateVerdict.get(guildId);
  if (cached && (now - cached.fetchedAt) < GATE_VERDICT_CACHE_TTL_MS) {
    return { overall: cached.overall, providerProfileTarget: cached.providerProfileTarget };
  }
  try {
    const snapshot = await buildWorkerApprovalGateSnapshot({ guildId });
    const gate = snapshot?.globalArtifacts?.latestGateDecision;
    const overall = gate?.overall || null;
    const providerProfileTarget = (gate as Record<string, unknown> | null)?.providerProfileTarget as string | null ?? null;
    cachedGateVerdict.set(guildId, { overall: overall || 'unknown', providerProfileTarget, fetchedAt: now });
    if (cachedGateVerdict.size > 100) {
      const first = cachedGateVerdict.keys().next().value;
      if (first !== undefined) cachedGateVerdict.delete(first);
    }
    return { overall, providerProfileTarget };
  } catch (err) {
    logger.debug('[ACTION-RUNNER] guild-policy lookup failed guildId=%s: %s', guildId, getErrorMessage(err));
    const fallback = cachedGateVerdict.get(guildId);
    return { overall: fallback?.overall || null, providerProfileTarget: fallback?.providerProfileTarget || null };
  }
};

export const __resetActionRunnerStateForTests = (): void => {
  actionResultCache = createActionResultCache();
  actionCircuitBreaker = createActionCircuitBreaker();
  actionUtilityScores.clear();
  cachedGateVerdict = new Map<string, GateVerdictCacheEntry>();
  lastFinopsBudgetFetchErrorLogAt = 0;
};
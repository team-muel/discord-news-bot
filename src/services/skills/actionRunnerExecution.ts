import { logStructuredError } from '../structuredErrorLogService';
import { normalizeActionInput, normalizeActionResult, toWorkerExecutionError } from '../workerExecution';
import { withTimeout } from '../langgraph/runtimeSupport/runtimeBudget';
import {
  ACTION_CIRCUIT_BREAKER_ENABLED,
} from './actionRunnerConfig';
import {
  actionCircuitBreaker,
  actionResultCache,
  updateActionUtility,
  type ActionResultCacheEntry,
} from './actionRunnerState';
import type { ActionDefinition, ActionExecutionResult } from './actions/types';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, nested]) => `${key}:${stableStringify(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const buildActionCacheKey = (params: {
  guildId: string;
  actionName: string;
  goal: string;
  args: Record<string, unknown>;
}): string => {
  const goal = compact(params.goal).toLowerCase().slice(0, 500);
  const args = stableStringify(params.args || {});
  return [params.guildId, params.actionName, goal, args].join('|');
};

export const isActionCircuitOpen = (actionName: string): boolean => {
  if (!ACTION_CIRCUIT_BREAKER_ENABLED) {
    return false;
  }
  return actionCircuitBreaker.isOpen(actionName);
};

const recordActionSuccess = (actionName: string): void => {
  updateActionUtility(actionName, true);
  if (ACTION_CIRCUIT_BREAKER_ENABLED) {
    actionCircuitBreaker.recordSuccess(actionName);
  }
};

const recordActionFailure = (actionName: string): void => {
  updateActionUtility(actionName, false);
  if (ACTION_CIRCUIT_BREAKER_ENABLED) {
    actionCircuitBreaker.recordFailure(actionName);
  }
};

export const getCachedActionResult = (cacheKey: string): ActionResultCacheEntry | null => {
  return actionResultCache.get(cacheKey) || null;
};

export const storeCachedActionResult = (params: {
  cacheKey: string;
  ttlMs: number;
  result: ActionExecutionResult;
}): void => {
  actionResultCache.set(params.cacheKey, {
    name: params.result.name,
    summary: params.result.summary,
    artifacts: [...(params.result.artifacts || [])],
    verification: [...(params.result.verification || [])],
    agentRole: params.result.agentRole,
    handoff: params.result.handoff,
  }, params.ttlMs);
};

export type ResolvedActionExecution = {
  final: ActionExecutionResult;
  attemptCount: number;
  durationMs: number;
};

export const executeResolvedAction = async (params: {
  action: Pick<ActionDefinition, 'name' | 'execute'>;
  goal: string;
  args: Record<string, unknown>;
  guildId: string;
  requestedBy: string;
  retryMax: number;
  timeoutMs: number;
  failureSummary?: string;
  errorSource?: string;
  recordMetrics?: boolean;
}): Promise<ResolvedActionExecution> => {
  let attemptCount = 0;
  let final: ActionExecutionResult | null = null;
  const startedAt = Date.now();

  while (attemptCount <= params.retryMax) {
    attemptCount += 1;
    final = await withTimeout(Promise.resolve().then(() => {
      const executionInput = normalizeActionInput({
        actionName: params.action.name,
        input: {
          goal: params.goal,
          args: params.args,
          guildId: params.guildId,
          requestedBy: params.requestedBy,
        },
      });
      return params.action.execute(executionInput);
    }), params.timeoutMs, 'ACTION_TIMEOUT')
      .then((result) => normalizeActionResult({ actionName: params.action.name, result }))
      .catch(async (error) => {
        const normalized = toWorkerExecutionError(error, 'UNKNOWN_ERROR');
        await logStructuredError({
          code: normalized.code,
          source: params.errorSource || 'skills.actionRunner.execute',
          message: normalized.message,
          guildId: params.guildId,
          actionName: params.action.name,
          meta: {
            retryable: normalized.retryable,
            attempt: attemptCount,
            retryMax: params.retryMax,
            ...(normalized.meta || {}),
          },
          severity: normalized.retryable ? 'warn' : 'error',
        }, error);

        const verification = [`error_code=${normalized.code}`];
        if (!normalized.retryable) {
          verification.push('retryable=false');
        }

        return {
          ok: false,
          name: params.action.name,
          summary: params.failureSummary || '액션 실행 실패',
          artifacts: [],
          verification,
          error: normalized.code || normalized.message,
        } satisfies ActionExecutionResult;
      });

    if (final.ok) {
      break;
    }

    if (final.error === 'ACTION_INPUT_INVALID' || final.error === 'ACTION_RESULT_INVALID') {
      break;
    }
  }

  if (!final) {
    final = {
      ok: false,
      name: params.action.name,
      summary: params.failureSummary || '액션 실행 실패',
      artifacts: [],
      verification: ['error_code=UNKNOWN_ERROR'],
      error: 'UNKNOWN_ERROR',
    };
  }

  const durationMs = Date.now() - startedAt;
  if (params.recordMetrics !== false) {
    if (final.ok) {
      recordActionSuccess(params.action.name);
    } else {
      recordActionFailure(params.action.name);
    }
  }

  return {
    final: {
      ...final,
      artifacts: [...(final.artifacts || [])],
      verification: [...(final.verification || [])],
      durationMs,
      handoff: final.handoff ? { ...final.handoff } : undefined,
    },
    attemptCount,
    durationMs,
  };
};
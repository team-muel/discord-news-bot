import { getAction } from './actions/registry';
import { getDynamicAction } from '../workerGeneration/dynamicWorkerRegistry';
import { planActions } from './actions/planner';
import { getActionRunnerMode, isActionAllowed } from './actions/policy';
import { createActionApprovalRequest, getGuildActionPolicy } from './actionGovernanceStore';
import { logActionExecutionEvent } from './actionExecutionLogService';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { TtlCache } from '../../utils/ttlCache';
import { decideFinopsAction, estimateActionExecutionCostUsd, getFinopsBudgetStatus } from '../finopsService';
import { logStructuredError } from '../structuredErrorLogService';
import { normalizeActionInput, normalizeActionResult, toWorkerExecutionError } from '../workerExecution';

type SkillActionResult = {
  handled: boolean;
  output: string;
  hasSuccess: boolean;
  externalUnavailable: boolean;
};

type GoalActionInput = {
  goal: string;
  guildId: string;
  requestedBy: string;
};

const ACTION_RUNNER_ENABLED = parseBooleanEnv(process.env.ACTION_RUNNER_ENABLED, true);
const ACTION_RETRY_MAX = Math.max(0, parseIntegerEnv(process.env.ACTION_RETRY_MAX, 2));
const ACTION_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_TIMEOUT_MS, 15_000));
const ACTION_CIRCUIT_BREAKER_ENABLED = parseBooleanEnv(process.env.ACTION_CIRCUIT_BREAKER_ENABLED, true);
const ACTION_CIRCUIT_FAILURE_THRESHOLD = Math.max(1, parseIntegerEnv(process.env.ACTION_CIRCUIT_FAILURE_THRESHOLD, 3));
const ACTION_CIRCUIT_OPEN_MS = Math.max(5_000, parseIntegerEnv(process.env.ACTION_CIRCUIT_OPEN_MS, 60_000));
const ACTION_FINOPS_DEGRADED_RETRY_MAX = Math.max(0, parseIntegerEnv(process.env.ACTION_FINOPS_DEGRADED_RETRY_MAX, 1));
const ACTION_FINOPS_DEGRADED_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_FINOPS_DEGRADED_TIMEOUT_MS, 8_000));
const ACTION_RUNNER_MODE = getActionRunnerMode();
const ACTION_CACHE_ENABLED = parseBooleanEnv(process.env.ACTION_CACHE_ENABLED, true);
const ACTION_CACHE_TTL_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_CACHE_TTL_MS, 10 * 60_000));
const ACTION_CACHE_MAX_ENTRIES = Math.max(50, parseIntegerEnv(process.env.ACTION_CACHE_MAX_ENTRIES, 1000));
const DEFAULT_CACHEABLE_ACTIONS = [
  'code.generate',
  'rag.retrieve',
  'news.google.search',
  'community.search',
  'web.fetch',
  'youtube.search.first',
  'stock.quote',
  'stock.chart',
  'db.supabase.read',
];
const ACTION_CACHEABLE_ACTION_SET = new Set(
  String(process.env.ACTION_CACHEABLE_ACTIONS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);
if (ACTION_CACHEABLE_ACTION_SET.size === 0) {
  for (const actionName of DEFAULT_CACHEABLE_ACTIONS) {
    ACTION_CACHEABLE_ACTION_SET.add(actionName);
  }
}

const actionResultCache = new TtlCache<{
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
}>(ACTION_CACHE_MAX_ENTRIES);

const breakerState = new Map<string, { failures: number; openedUntilMs: number }>();

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const isActionCacheable = (actionName: string): boolean => ACTION_CACHEABLE_ACTION_SET.has(actionName);

const buildActionCacheKey = (params: {
  guildId: string;
  actionName: string;
  goal: string;
  args: Record<string, unknown>;
}): string => {
  const goal = compact(params.goal).toLowerCase().slice(0, 500);
  const args = stableStringify(params.args || {});
  return [params.guildId, params.actionName, goal, args].join('|');
};

const isCircuitOpen = (actionName: string): boolean => {
  if (!ACTION_CIRCUIT_BREAKER_ENABLED) {
    return false;
  }

  const state = breakerState.get(actionName);
  if (!state) {
    return false;
  }

  if (Date.now() >= state.openedUntilMs) {
    breakerState.set(actionName, { failures: 0, openedUntilMs: 0 });
    return false;
  }

  return state.openedUntilMs > 0;
};

const recordSuccess = (actionName: string) => {
  if (!ACTION_CIRCUIT_BREAKER_ENABLED) {
    return;
  }
  breakerState.set(actionName, { failures: 0, openedUntilMs: 0 });
};

const recordFailure = (actionName: string) => {
  if (!ACTION_CIRCUIT_BREAKER_ENABLED) {
    return;
  }
  const current = breakerState.get(actionName) || { failures: 0, openedUntilMs: 0 };
  const failures = current.failures + 1;
  if (failures >= ACTION_CIRCUIT_FAILURE_THRESHOLD) {
    breakerState.set(actionName, {
      failures,
      openedUntilMs: Date.now() + ACTION_CIRCUIT_OPEN_MS,
    });
    return;
  }
  breakerState.set(actionName, { failures, openedUntilMs: 0 });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('ACTION_TIMEOUT')), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const isExternalUnavailableError = (errorCode?: string): boolean => {
  const code = String(errorCode || '').toUpperCase();
  if (!code) {
    return false;
  }

  return code.includes('WORKER')
    || code.includes('MCP_')
    || code === 'ACTION_TIMEOUT'
    || code === 'WEB_FETCH_FAILED';
};

export const runGoalActions = async (input: GoalActionInput): Promise<SkillActionResult> => {
  if (!ACTION_RUNNER_ENABLED) {
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
    };
  }

  const chain = await planActions(input.goal);
  if (!chain.actions || chain.actions.length === 0) {
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
    };
  }

  const lines: string[] = ['요청 결과'];
  let handledAny = false;
  let hasSuccess = false;
  let externalUnavailable = false;
  const budget = await getFinopsBudgetStatus(input.guildId).catch(() => null);
  const finopsMode = budget?.mode || 'normal';
  if (budget?.enabled) {
    lines.push(`FinOps 모드: ${budget.mode} (daily=${budget.daily.spendUsd.toFixed(4)}/${budget.daily.budgetUsd.toFixed(2)}, monthly=${budget.monthly.spendUsd.toFixed(4)}/${budget.monthly.budgetUsd.toFixed(2)})`);
  }

  for (const planned of chain.actions) {
    if (budget?.enabled) {
      const finopsDecision = decideFinopsAction({
        budget,
        actionName: planned.actionName,
      });

      if (!finopsDecision.allow) {
        lines.push(`액션: ${planned.actionName}`);
        lines.push(`상태: 실패 (${finopsDecision.reason})`);
        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: planned.actionName,
          ok: false,
          summary: 'FinOps 예산 가드레일에 의해 실행이 차단되었습니다.',
          artifacts: [],
          verification: ['finops guardrail block'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          error: finopsDecision.reason,
          estimatedCostUsd: 0,
          finopsMode,
        });
        continue;
      }
    }

    if (!isActionAllowed(planned.actionName)) {
      lines.push(`액션: ${planned.actionName}`);
      lines.push('상태: 실패 (ACTION_NOT_ALLOWED)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: planned.actionName,
        ok: false,
        summary: '정책 allowlist에 없는 액션입니다.',
        artifacts: [],
        verification: ['action allowlist policy block'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_NOT_ALLOWED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    const action = getAction(planned.actionName) ?? getDynamicAction(planned.actionName);
    if (!action) {
      continue;
    }

    const governance = await getGuildActionPolicy(input.guildId, action.name);
    if (!governance.enabled || governance.runMode === 'disabled') {
      lines.push(`액션: ${action.name}`);
      lines.push('상태: 실패 (ACTION_DISABLED_BY_POLICY)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '길드 액션 정책에서 비활성화된 액션입니다.',
        artifacts: [],
        verification: ['tenant action policy disabled'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_DISABLED_BY_POLICY',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    const autoApprovalRequired = action.name === 'privacy.forget.guild'
      && !String(input.requestedBy || '').startsWith('system:');
    const effectiveRunMode = autoApprovalRequired ? 'approval_required' : governance.runMode;

    if (effectiveRunMode === 'approval_required') {
      const request = await createActionApprovalRequest({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        actionArgs: planned.args || {},
        reason: autoApprovalRequired
          ? 'high-risk action guard: privacy.forget.guild'
          : 'action policy run_mode=approval_required',
      });

      lines.push(`액션: ${action.name}`);
      lines.push(`상태: 승인 대기 (requestId=${request.id})`);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '승인 게이트에 의해 실행이 보류되었습니다.',
        artifacts: [request.id],
        verification: ['tenant action policy approval_required'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_APPROVAL_REQUIRED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    handledAny = true;

    if (ACTION_RUNNER_MODE === 'dry-run') {
      lines.push(`액션: ${action.name}`);
      lines.push('상태: DRY_RUN (실행 생략)');
      lines.push(`계획 인자: ${JSON.stringify(planned.args || {})}`);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: true,
        summary: 'dry-run 모드로 실제 실행은 생략되었습니다.',
        artifacts: [JSON.stringify(planned.args || {})],
        verification: ['runner dry-run mode'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        estimatedCostUsd: 0,
        finopsMode,
      });
      hasSuccess = true;
      continue;
    }

    if (isCircuitOpen(action.name)) {
      const message = `상태: 실패 (CIRCUIT_OPEN)`;
      lines.push(`액션: ${action.name}`);
      lines.push(message);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '회로차단기로 실행이 차단되었습니다.',
        artifacts: [],
        verification: ['circuit breaker open'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: true,
        error: 'CIRCUIT_OPEN',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    let attempt = 0;
    let final: {
      ok: boolean;
      name: string;
      summary: string;
      artifacts: string[];
      verification: string[];
      error?: string;
      durationMs?: number;
    } | null = null;
    const startedAt = Date.now();

    const effectiveRetryMax = finopsMode === 'degraded'
      ? Math.min(ACTION_RETRY_MAX, ACTION_FINOPS_DEGRADED_RETRY_MAX)
      : ACTION_RETRY_MAX;
    const effectiveTimeoutMs = finopsMode === 'degraded'
      ? Math.min(ACTION_TIMEOUT_MS, ACTION_FINOPS_DEGRADED_TIMEOUT_MS)
      : ACTION_TIMEOUT_MS;

    const cacheEligible = ACTION_CACHE_ENABLED && isActionCacheable(action.name);
    const cacheKey = cacheEligible
      ? buildActionCacheKey({
        guildId: input.guildId,
        actionName: action.name,
        goal: input.goal,
        args: planned.args || {},
      })
      : '';

    if (cacheEligible && cacheKey) {
      const cached = actionResultCache.get(cacheKey);
      if (cached) {
        lines.push(`액션: ${cached.name}`);
        lines.push(`${cached.summary} (cache hit)`);
        lines.push(cached.artifacts.length > 0 ? `산출물:\n${cached.artifacts.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
        lines.push(cached.verification.length > 0
          ? `검증:\n${[...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'].map((line) => `- ${line}`).join('\n')}`
          : `검증:\n- cache_ttl_ms=${ACTION_CACHE_TTL_MS}\n- cache_hit=true`);
        lines.push('재시도 횟수: 0');
        lines.push('소요시간(ms): 0');
        lines.push('상태: 성공');

        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: cached.name,
          ok: true,
          summary: `${cached.summary} (cache hit)`,
          artifacts: cached.artifacts,
          verification: [...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          estimatedCostUsd: 0,
          finopsMode,
        });

        hasSuccess = true;

        continue;
      }
    }

    while (attempt <= effectiveRetryMax) {
      attempt += 1;
      final = await withTimeout(Promise.resolve().then(() => {
        const executionInput = normalizeActionInput({
          actionName: action.name,
          input: {
            goal: input.goal,
            args: planned.args,
            guildId: input.guildId,
            requestedBy: input.requestedBy,
          },
        });
        return action.execute(executionInput);
      }), effectiveTimeoutMs)
        .then((result) => normalizeActionResult({ actionName: action.name, result }))
        .catch(async (error) => {
          const normalized = toWorkerExecutionError(error, 'UNKNOWN_ERROR');
          await logStructuredError({
            code: normalized.code,
            source: 'skills.actionRunner.execute',
            message: normalized.message,
            guildId: input.guildId,
            actionName: action.name,
            meta: {
              retryable: normalized.retryable,
              attempt,
              retryMax: effectiveRetryMax,
              ...(normalized.meta || {}),
            },
            severity: normalized.retryable ? 'warn' : 'error',
          }, error);

          const message = normalized.code || normalized.message;
          const verification = [`error_code=${normalized.code}`];
          if (!normalized.retryable) {
            verification.push('retryable=false');
          }

        return {
          ok: false,
          name: action.name,
          summary: '액션 실행 실패',
          artifacts: [],
            verification,
          error: message,
        };
        });

      if (final.ok) {
        break;
      }

      const shouldStopRetry = final.error === 'ACTION_INPUT_INVALID'
        || final.error === 'ACTION_RESULT_INVALID';
      if (shouldStopRetry) {
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    if (!final) {
      continue;
    }
    final.durationMs = durationMs;

    if (final.ok) {
      recordSuccess(action.name);
      hasSuccess = true;
      if (cacheEligible && cacheKey) {
        actionResultCache.set(cacheKey, {
          name: final.name,
          summary: final.summary,
          artifacts: [...(final.artifacts || [])],
          verification: [...(final.verification || [])],
        }, ACTION_CACHE_TTL_MS);
      }
    } else {
      recordFailure(action.name);
      if (isExternalUnavailableError(final.error)) {
        externalUnavailable = true;
      }
    }

    lines.push(`액션: ${final.name}`);
    lines.push(final.summary);
    lines.push(final.artifacts.length > 0 ? `산출물:\n${final.artifacts.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
    lines.push(final.verification.length > 0 ? `검증:\n${final.verification.map((line) => `- ${line}`).join('\n')}` : '검증: 없음');
    lines.push(`재시도 횟수: ${Math.max(0, attempt - 1)}`);
    lines.push(`소요시간(ms): ${durationMs}`);
    lines.push(final.ok ? '상태: 성공' : `상태: 실패 (${final.error || 'UNKNOWN'})`);

    const estimatedCostUsd = estimateActionExecutionCostUsd({
      ok: final.ok,
      retryCount: Math.max(0, attempt - 1),
      durationMs,
    });

    await logActionExecutionEvent({
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      goal: input.goal,
      actionName: final.name,
      ok: final.ok,
      summary: final.summary,
      artifacts: final.artifacts,
      verification: final.verification,
      durationMs,
      retryCount: Math.max(0, attempt - 1),
      circuitOpen: false,
      error: final.error,
      estimatedCostUsd,
      finopsMode,
    });
  }

  if (!handledAny) {
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
    };
  }

  return {
    handled: true,
    output: lines.filter(Boolean).join('\n\n'),
    hasSuccess,
    externalUnavailable,
  };
};

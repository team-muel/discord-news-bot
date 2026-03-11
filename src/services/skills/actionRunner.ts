import { getAction } from './actions/registry';
import { planActions } from './actions/planner';
import { logActionExecutionEvent } from './actionExecutionLogService';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';

type SkillActionResult = {
  handled: boolean;
  output: string;
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

const breakerState = new Map<string, { failures: number; openedUntilMs: number }>();

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

export const runGoalActions = async (input: GoalActionInput): Promise<SkillActionResult> => {
  if (!ACTION_RUNNER_ENABLED) {
    return {
      handled: false,
      output: '',
    };
  }

  const chain = await planActions(input.goal);
  if (!chain.actions || chain.actions.length === 0) {
    return {
      handled: false,
      output: '',
    };
  }

  const lines: string[] = ['요청 결과'];
  let handledAny = false;

  for (const planned of chain.actions) {
    const action = getAction(planned.actionName);
    if (!action) {
      continue;
    }

    handledAny = true;

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

    while (attempt <= ACTION_RETRY_MAX) {
      attempt += 1;
      final = await withTimeout(action.execute({ goal: input.goal, args: planned.args }), ACTION_TIMEOUT_MS).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: action.name,
          summary: '액션 실행 실패',
          artifacts: [],
          verification: [],
          error: message,
        };
      });

      if (final.ok) {
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
    } else {
      recordFailure(action.name);
    }

    lines.push(`액션: ${final.name}`);
    lines.push(final.summary);
    lines.push(final.artifacts.length > 0 ? `산출물:\n${final.artifacts.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
    lines.push(final.verification.length > 0 ? `검증:\n${final.verification.map((line) => `- ${line}`).join('\n')}` : '검증: 없음');
    lines.push(`재시도 횟수: ${Math.max(0, attempt - 1)}`);
    lines.push(`소요시간(ms): ${durationMs}`);
    lines.push(final.ok ? '상태: 성공' : `상태: 실패 (${final.error || 'UNKNOWN'})`);

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
    });
  }

  if (!handledAny) {
    return {
      handled: false,
      output: '',
    };
  }

  return {
    handled: true,
    output: lines.filter(Boolean).join('\n\n'),
  };
};

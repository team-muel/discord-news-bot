import logger from '../../logger';
import type { ActionDefinition, ActionExecutionInput, ActionExecutionResult } from '../skills/actions/types';

const CIRCUIT_FAILURE_THRESHOLD = Math.max(2, Number(process.env.DYNAMIC_CIRCUIT_FAILURE_THRESHOLD || 3));
const CIRCUIT_OPEN_MS = Math.max(10_000, Number(process.env.DYNAMIC_CIRCUIT_OPEN_MS || 120_000));

type DynamicEntry = {
  definition: ActionDefinition;
  approvalId: string;
  addedAt: string;
  failures: number;
  openUntilMs: number;
};

// In-process registry of dynamically loaded action workers
const registry = new Map<string, DynamicEntry>();

// Optional admin-notify callback wired up by bot.ts
let adminNotifyFn: ((message: string) => Promise<void>) | null = null;

export const setDynamicWorkerAdminNotifier = (fn: (message: string) => Promise<void>): void => {
  adminNotifyFn = fn;
};

// ─── Circuit breaker wrapper ──────────────────────────────────────────────────

const openCircuit = (name: string, entry: DynamicEntry): void => {
  entry.openUntilMs = Date.now() + CIRCUIT_OPEN_MS;
  logger.warn('[DYNAMIC-WORKER] circuit opened for %s failures=%d open_sec=%d', name, entry.failures, CIRCUIT_OPEN_MS / 1000);
  void adminNotifyFn?.(
    [
      `⚠️ **동적 워커 서킷 브레이커 작동**`,
      `워커 \`${name}\` 이 연속 **${entry.failures}회** 실패했습니다.`,
      `${Math.round(CIRCUIT_OPEN_MS / 1000)}초 동안 자동 차단됩니다.`,
      `승인 ID: \`${entry.approvalId}\``,
    ].join('\n'),
  );
};

const wrapExecute = (name: string, execute: ActionDefinition['execute']): ActionDefinition['execute'] => {
  return async (input: ActionExecutionInput): Promise<ActionExecutionResult> => {
    const entry = registry.get(name);
    if (!entry) {
      return { ok: false, name, summary: '워커를 찾을 수 없습니다.', artifacts: [], verification: [], error: 'DYNAMIC_WORKER_NOT_FOUND' };
    }

    if (entry.openUntilMs > Date.now()) {
      const remainSec = Math.ceil((entry.openUntilMs - Date.now()) / 1000);
      return {
        ok: false,
        name,
        summary: `서킷 브레이커 작동 중 (${remainSec}초 남음)`,
        artifacts: [],
        verification: ['circuit_open=true'],
        error: 'DYNAMIC_CIRCUIT_OPEN',
      };
    }

    try {
      const result = await execute(input);
      if (result.ok) {
        entry.failures = 0;
      } else {
        entry.failures += 1;
        if (entry.failures >= CIRCUIT_FAILURE_THRESHOLD) openCircuit(name, entry);
      }
      return result;
    } catch (error) {
      entry.failures += 1;
      if (entry.failures >= CIRCUIT_FAILURE_THRESHOLD) openCircuit(name, entry);
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DYNAMIC-WORKER] execute threw for %s: %s', name, message);
      return { ok: false, name, summary: '동적 워커 예외 발생', artifacts: [], verification: [], error: message };
    }
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const getDynamicAction = (name: string): ActionDefinition | null =>
  registry.get(name)?.definition ?? null;

export const listDynamicWorkers = () =>
  [...registry.values()].map((e) => ({
    name: e.definition.name,
    description: e.definition.description,
    approvalId: e.approvalId,
    addedAt: e.addedAt,
    failures: e.failures,
    circuitOpen: e.openUntilMs > Date.now(),
    openUntilMs: e.openUntilMs,
  }));

/** Dynamically import a generated .mjs worker file and register it. */
export const loadDynamicWorkerFromFile = async (
  filePath: string,
  approvalId: string,
): Promise<{ ok: boolean; actionName?: string; error?: string }> => {
  try {
    // Native ESM dynamic import – works with .mjs files at runtime
    const mod = await import(filePath) as Record<string, unknown>;

    const def = Object.values(mod).find(
      (v): v is ActionDefinition =>
        typeof v === 'object'
        && v !== null
        && typeof (v as ActionDefinition).name === 'string'
        && typeof (v as ActionDefinition).execute === 'function',
    );

    if (!def) {
      return { ok: false, error: 'no valid ActionDefinition export found in the module' };
    }

    const wrapped: ActionDefinition = {
      name: def.name,
      description: String(def.description || def.name),
      execute: wrapExecute(def.name, def.execute),
    };

    registry.set(def.name, {
      definition: wrapped,
      approvalId,
      addedAt: new Date().toISOString(),
      failures: 0,
      openUntilMs: 0,
    });

    logger.info('[DYNAMIC-WORKER] activated name=%s approvalId=%s', def.name, approvalId);
    return { ok: true, actionName: def.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[DYNAMIC-WORKER] import failed path=%s: %s', filePath, message);
    return { ok: false, error: message };
  }
};

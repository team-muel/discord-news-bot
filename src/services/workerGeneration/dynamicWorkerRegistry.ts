import logger from '../../logger';
import type { ActionDefinition, ActionExecutionInput, ActionExecutionResult } from '../skills/actions/types';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CIRCUIT_FAILURE_THRESHOLD = Math.max(2, Number(process.env.DYNAMIC_CIRCUIT_FAILURE_THRESHOLD || 3));
const CIRCUIT_OPEN_MS = Math.max(10_000, Number(process.env.DYNAMIC_CIRCUIT_OPEN_MS || 120_000));
const DYNAMIC_WORKER_RUNTIME_DIR = String(process.env.DYNAMIC_WORKER_RUNTIME_DIR || path.join(process.cwd(), '.runtime', 'dynamic-workers')).trim();

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

const activateDynamicDefinition = (def: ActionDefinition, approvalId: string) => {
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
  return { ok: true, actionName: def.name } as const;
};

const resolveImportSpec = (filePath: string): string => {
  const asUrl = pathToFileURL(filePath).href;
  const version = Date.now();
  return `${asUrl}?v=${version}`;
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
    const importSpec = resolveImportSpec(filePath);
    const mod = await import(importSpec) as Record<string, unknown>;

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
    return activateDynamicDefinition(def, approvalId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[DYNAMIC-WORKER] import failed path=%s: %s', filePath, message);
    return { ok: false, error: message };
  }
};

/** Persist generated code to runtime folder and load it as dynamic action. */
export const loadDynamicWorkerFromCode = async (
  params: {
    approvalId: string;
    generatedCode: string;
    actionNameHint?: string;
  },
): Promise<{ ok: boolean; actionName?: string; error?: string; filePath?: string }> => {
  const code = String(params.generatedCode || '').trim();
  if (!code) {
    return { ok: false, error: 'generatedCode is empty' };
  }

  const baseName = String(params.actionNameHint || 'dynamic.worker')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 60)
    || 'dynamic.worker';

  const artifactDir = DYNAMIC_WORKER_RUNTIME_DIR || path.join(os.tmpdir(), 'muel-dynamic-workers');
  const filePath = path.join(artifactDir, `${baseName}-${params.approvalId}.mjs`);

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(filePath, `${code}\n`, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[DYNAMIC-WORKER] code artifact write failed approval=%s: %s', params.approvalId, message);
    return { ok: false, error: `artifact write failed: ${message}` };
  }

  const loaded = await loadDynamicWorkerFromFile(filePath, params.approvalId);
  if (!loaded.ok) {
    return { ...loaded, filePath };
  }

  return { ...loaded, filePath };
};

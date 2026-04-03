import { spawn } from 'node:child_process';
import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';

const OBSIDIAN_SYNC_LOOP_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_SYNC_LOOP_ENABLED, false);
const OBSIDIAN_SYNC_LOOP_INTERVAL_MIN = Math.max(5, parseIntegerEnv(process.env.OBSIDIAN_SYNC_LOOP_INTERVAL_MIN, 60));
const OBSIDIAN_SYNC_LOOP_RUN_ON_START = parseBooleanEnv(process.env.OBSIDIAN_SYNC_LOOP_RUN_ON_START, true);
const OBSIDIAN_SYNC_LOOP_TIMEOUT_MS = Math.max(30_000, parseIntegerEnv(process.env.OBSIDIAN_SYNC_LOOP_TIMEOUT_MS, 10 * 60_000));
export type LoopOwner = 'app' | 'db';
const OBSIDIAN_SYNC_LOOP_OWNER: LoopOwner =
  String(process.env.OBSIDIAN_SYNC_LOOP_OWNER || 'app').trim().toLowerCase() === 'db' ? 'db' : 'app';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastFinishedAt: string | null = null;
let lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'timeout' = 'idle';
let lastSummary: string | null = null;
let lastExitCode: number | null = null;

const runSyncOnce = async () => {
  if (running) {
    return;
  }

  running = true;
  lastStatus = 'running';
  lastRunAt = new Date().toISOString();
  lastSummary = null;
  lastExitCode = null;

  const started = Date.now();
  const commandArgs = ['--import', 'tsx', 'scripts/sync-obsidian-lore.ts'];
  const child = spawn(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const append = (base: string, chunk: string) => {
    const max = 4000;
    const next = `${base}${chunk}`;
    if (next.length <= max) return next;
    return next.slice(next.length - max);
  };

  child.stdout?.on('data', (chunk) => {
    stdout = append(stdout, String(chunk || ''));
  });
  child.stderr?.on('data', (chunk) => {
    stderr = append(stderr, String(chunk || ''));
  });

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    lastStatus = 'timeout';
  }, OBSIDIAN_SYNC_LOOP_TIMEOUT_MS);

  const finalize = (status: 'success' | 'failed' | 'timeout', code: number | null) => {
    clearTimeout(timeout);
    running = false;
    lastFinishedAt = new Date().toISOString();
    lastStatus = status;
    lastExitCode = code;

    const durationMs = Date.now() - started;
    const trimmedOut = stdout.trim();
    const trimmedErr = stderr.trim();
    const tail = trimmedErr || trimmedOut;
    lastSummary = `durationMs=${durationMs} exitCode=${String(code)} tail=${tail.slice(-300)}`;

    if (status === 'success') {
      logger.info('[OBSIDIAN-SYNC-LOOP] completed: %s', lastSummary);
    } else if (status === 'timeout') {
      logger.warn('[OBSIDIAN-SYNC-LOOP] timeout: %s', lastSummary);
    } else {
      logger.warn('[OBSIDIAN-SYNC-LOOP] failed: %s', lastSummary);
    }
  };

  child.once('error', (error) => {
    finalize('failed', null);
    logger.warn('[OBSIDIAN-SYNC-LOOP] process error: %s', error instanceof Error ? error.message : String(error));
  });

  child.once('close', (code) => {
    if (lastStatus === 'timeout') {
      finalize('timeout', code);
      return;
    }
    finalize(code === 0 ? 'success' : 'failed', code);
  });
};

export const startObsidianLoreSyncLoop = () => {
  if (!OBSIDIAN_SYNC_LOOP_ENABLED || timer) {
    return;
  }
  if (OBSIDIAN_SYNC_LOOP_OWNER !== 'app') {
    logger.info('[OBSIDIAN-SYNC-LOOP] app loop skipped (owner=%s, delegated to pg_cron)', OBSIDIAN_SYNC_LOOP_OWNER);
    return;
  }

  const intervalMs = OBSIDIAN_SYNC_LOOP_INTERVAL_MIN * 60_000;
  timer = setInterval(() => {
    void runSyncOnce();
  }, intervalMs);
  timer.unref();

  if (OBSIDIAN_SYNC_LOOP_RUN_ON_START) {
    void runSyncOnce();
  }

  logger.info('[OBSIDIAN-SYNC-LOOP] started (intervalMin=%d runOnStart=%s)', OBSIDIAN_SYNC_LOOP_INTERVAL_MIN, String(OBSIDIAN_SYNC_LOOP_RUN_ON_START));
};

export const stopObsidianLoreSyncLoop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const getObsidianLoreSyncLoopStats = () => ({
  enabled: OBSIDIAN_SYNC_LOOP_ENABLED,
  owner: OBSIDIAN_SYNC_LOOP_OWNER,
  running,
  intervalMin: OBSIDIAN_SYNC_LOOP_INTERVAL_MIN,
  runOnStart: OBSIDIAN_SYNC_LOOP_RUN_ON_START,
  timeoutMs: OBSIDIAN_SYNC_LOOP_TIMEOUT_MS,
  lastRunAt,
  lastFinishedAt,
  lastStatus,
  lastExitCode,
  lastSummary,
});

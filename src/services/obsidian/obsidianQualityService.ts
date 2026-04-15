import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import logger from '../../logger';
import { parseBooleanEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';
import { getErrorMessage } from '../../utils/errorMessage';

export type ObsidianGraphAuditSnapshot = {
  generatedAt: string;
  vaultPath: string;
  totals: {
    files: number;
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  topTags: Array<{ tag: string; count: number }>;
  thresholds: {
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  pass: boolean;
};

export type ObsidianGraphAuditLoopOwner = 'app' | 'db';

export type ObsidianGraphAuditLoopStats = {
  enabled: boolean;
  owner: ObsidianGraphAuditLoopOwner;
  running: boolean;
  intervalMin: number;
  runOnStart: boolean;
  timeoutMs: number;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'timeout';
  lastExitCode: number | null;
  lastSummary: string | null;
  snapshotPath: string;
};

const SNAPSHOT_PATH = path.resolve(process.cwd(), '.runtime', 'obsidian-graph-audit.json');

const OBSIDIAN_GRAPH_AUDIT_LOOP_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_GRAPH_AUDIT_LOOP_ENABLED, false);
const OBSIDIAN_GRAPH_AUDIT_LOOP_INTERVAL_MIN = parseMinIntEnv(process.env.OBSIDIAN_GRAPH_AUDIT_LOOP_INTERVAL_MIN, 360, 5);
const OBSIDIAN_GRAPH_AUDIT_LOOP_RUN_ON_START = parseBooleanEnv(process.env.OBSIDIAN_GRAPH_AUDIT_LOOP_RUN_ON_START, true);
const OBSIDIAN_GRAPH_AUDIT_LOOP_TIMEOUT_MS = parseMinIntEnv(process.env.OBSIDIAN_GRAPH_AUDIT_LOOP_TIMEOUT_MS, 10 * 60_000, 30_000);
const OBSIDIAN_GRAPH_AUDIT_LOOP_OWNER: ObsidianGraphAuditLoopOwner =
  parseStringEnv(process.env.OBSIDIAN_GRAPH_AUDIT_LOOP_OWNER, 'app').toLowerCase() === 'db' ? 'db' : 'app';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastFinishedAt: string | null = null;
let lastStatus: ObsidianGraphAuditLoopStats['lastStatus'] = 'idle';
let lastSummary: string | null = null;
let lastExitCode: number | null = null;

const appendOutput = (base: string, chunk: string) => {
  const max = 4000;
  const next = `${base}${chunk}`;
  if (next.length <= max) {
    return next;
  }
  return next.slice(next.length - max);
};

const runGraphAuditInternal = async () => {
  if (running) {
    return;
  }

  running = true;
  lastStatus = 'running';
  lastRunAt = new Date().toISOString();
  lastSummary = null;
  lastExitCode = null;

  const started = Date.now();
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/audit-obsidian-graph.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (chunk) => {
    stdout = appendOutput(stdout, String(chunk || ''));
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendOutput(stderr, String(chunk || ''));
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      lastStatus = 'timeout';
    }, OBSIDIAN_GRAPH_AUDIT_LOOP_TIMEOUT_MS);

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
        logger.info('[OBSIDIAN-GRAPH-AUDIT] completed: %s', lastSummary);
      } else if (status === 'timeout') {
        logger.warn('[OBSIDIAN-GRAPH-AUDIT] timeout: %s', lastSummary);
      } else {
        logger.warn('[OBSIDIAN-GRAPH-AUDIT] failed: %s', lastSummary);
      }

      resolve();
    };

    child.once('error', (error) => {
      finalize('failed', null);
      logger.warn('[OBSIDIAN-GRAPH-AUDIT] process error: %s', getErrorMessage(error));
    });

    child.once('close', (code) => {
      if (lastStatus === 'timeout') {
        finalize('timeout', code);
        return;
      }
      finalize(code === 0 ? 'success' : 'failed', code);
    });
  });
};

export const startObsidianGraphAuditLoop = () => {
  if (!OBSIDIAN_GRAPH_AUDIT_LOOP_ENABLED || timer) {
    return;
  }

  if (OBSIDIAN_GRAPH_AUDIT_LOOP_OWNER !== 'app') {
    logger.info('[OBSIDIAN-GRAPH-AUDIT] app loop skipped (owner=%s, delegated to pg_cron)', OBSIDIAN_GRAPH_AUDIT_LOOP_OWNER);
    return;
  }

  const intervalMs = OBSIDIAN_GRAPH_AUDIT_LOOP_INTERVAL_MIN * 60_000;
  timer = setInterval(() => {
    void runGraphAuditInternal();
  }, intervalMs);
  timer.unref();

  if (OBSIDIAN_GRAPH_AUDIT_LOOP_RUN_ON_START) {
    void runGraphAuditInternal();
  }

  logger.info(
    '[OBSIDIAN-GRAPH-AUDIT] started (intervalMin=%d runOnStart=%s)',
    OBSIDIAN_GRAPH_AUDIT_LOOP_INTERVAL_MIN,
    String(OBSIDIAN_GRAPH_AUDIT_LOOP_RUN_ON_START),
  );
};

export const stopObsidianGraphAuditLoop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const runObsidianGraphAuditOnce = async (): Promise<ObsidianGraphAuditLoopStats> => {
  await runGraphAuditInternal();
  return getObsidianGraphAuditLoopStats();
};

export const getObsidianGraphAuditLoopStats = (): ObsidianGraphAuditLoopStats => ({
  enabled: OBSIDIAN_GRAPH_AUDIT_LOOP_ENABLED,
  owner: OBSIDIAN_GRAPH_AUDIT_LOOP_OWNER,
  running,
  intervalMin: OBSIDIAN_GRAPH_AUDIT_LOOP_INTERVAL_MIN,
  runOnStart: OBSIDIAN_GRAPH_AUDIT_LOOP_RUN_ON_START,
  timeoutMs: OBSIDIAN_GRAPH_AUDIT_LOOP_TIMEOUT_MS,
  lastRunAt,
  lastFinishedAt,
  lastStatus,
  lastExitCode,
  lastSummary,
  snapshotPath: SNAPSHOT_PATH,
});

export const getLatestObsidianGraphAuditSnapshot = async (): Promise<ObsidianGraphAuditSnapshot | null> => {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ObsidianGraphAuditSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

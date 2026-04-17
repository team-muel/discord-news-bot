import 'dotenv/config';

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  getLocalAutonomySupervisorLoopStats,
  runLocalAutonomySupervisorCycle,
} from '../src/services/runtime/localAutonomySupervisorService.ts';

const ROOT = process.cwd();
const STATUS_PATH = path.join(ROOT, 'tmp', 'autonomy', 'local-autonomy-supervisor.json');
const MANIFEST_PATH = path.join(ROOT, 'tmp', 'autonomy', 'local-autonomy-supervisor.manifest.json');
const LOG_PATH = path.join(ROOT, 'tmp', 'autonomy', 'local-autonomy-supervisor.log');
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SELF_SCRIPT_PATH = fileURLToPath(import.meta.url);

type TrackedCodeFile = {
  path: string;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
};

const compact = (value: unknown): string => String(value || '').trim();
const toRelativePath = (filePath: string): string => path.relative(ROOT, filePath).replace(/\\/g, '/');

export const LOCAL_AUTONOMY_TRACKED_CODE_PATHS = [
  SELF_SCRIPT_PATH,
  path.join(ROOT, 'scripts', 'local-ai-stack-control.mjs'),
  path.join(ROOT, 'scripts', 'sync-openjarvis-continuity-packets.ts'),
  path.join(ROOT, 'src', 'services', 'runtime', 'localAutonomySupervisorService.ts'),
  path.join(ROOT, 'src', 'services', 'runtime', 'hermesVsCodeBridgeService.ts'),
  path.join(ROOT, 'src', 'services', 'openjarvis', 'openjarvisAutopilotStatusService.ts'),
  path.join(ROOT, 'src', 'services', 'openjarvis', 'openjarvisHermesRuntimeControlService.ts'),
] as const;

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const buildTrackedCodeFiles = (
  trackedPaths: readonly string[] = LOCAL_AUTONOMY_TRACKED_CODE_PATHS,
): TrackedCodeFile[] => trackedPaths.map((filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      path: toRelativePath(filePath),
      exists: true,
      size: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    };
  } catch {
    return {
      path: toRelativePath(filePath),
      exists: false,
      size: null,
      mtimeMs: null,
    };
  }
});

export const buildTrackedCodeFingerprint = (trackedFiles: readonly TrackedCodeFile[]): string => createHash('sha1')
  .update(JSON.stringify(trackedFiles))
  .digest('hex');

const buildTrackedCodeState = () => {
  const trackedFiles = buildTrackedCodeFiles();
  return {
    trackedFiles,
    fingerprint: buildTrackedCodeFingerprint(trackedFiles),
  };
};

export const buildCodeDriftStatus = (
  manifest: Record<string, unknown>,
  trackedCodeState = buildTrackedCodeState(),
  running = false,
) => {
  const manifestFingerprint = compact(manifest.codeFingerprint) || null;
  const reason = !running
    ? null
    : (!manifestFingerprint
      ? 'manifest-missing-code-fingerprint'
      : (manifestFingerprint !== trackedCodeState.fingerprint ? 'tracked-code-changed' : null));

  return {
    driftDetected: reason !== null,
    restartRecommended: running && reason !== null,
    reason,
    manifestFingerprint,
    currentFingerprint: trackedCodeState.fingerprint,
    trackedFiles: trackedCodeState.trackedFiles,
  };
};

const parseIntervalMs = (value: string, fallback: number): number => {
  const numeric = Number.parseInt(compact(value), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(30_000, numeric);
};

const writeStatus = (payload: Record<string, unknown>): void => {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const writeManifest = (payload: Record<string, unknown>): void => {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const isProcessAlive = (pid: unknown): boolean => {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }

  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
};

const buildStatusPayload = (): Record<string, unknown> => {
  const manifest = readJsonFile(MANIFEST_PATH) || {};
  const lastStatus = readJsonFile(STATUS_PATH);
  const pid = Number(manifest.pid);
  const running = isProcessAlive(pid);
  const code = buildCodeDriftStatus(manifest, buildTrackedCodeState(), running);
  return {
    ok: true,
    running,
    pid: running ? pid : null,
    manifest: {
      startedAt: compact(manifest.startedAt) || null,
      intervalMs: Number(manifest.intervalMs) || null,
      logPath: compact(manifest.logPath) || null,
      statusPath: compact(manifest.statusPath) || null,
      detached: manifest.detached === true,
      codeFingerprint: compact(manifest.codeFingerprint) || null,
    },
    code,
    lastStatus,
  };
};

const stopRunningProcess = (pid: number): boolean => {
  if (!isProcessAlive(pid)) {
    return false;
  }

  if (process.platform === 'win32') {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'taskkill', '/PID', String(pid), '/T', '/F'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    });
    return result.status === 0;
  }

  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
};

const buildDetachedArgs = (intervalMs: number): string[] => [
  '--import',
  'dotenv/config',
  '--import',
  'tsx',
  SELF_SCRIPT_PATH,
  '--watch=true',
  '--detachedMode=true',
  `--intervalMs=${intervalMs}`,
];

const startDetached = (
  intervalMs: number,
  options: { restartIfStale?: boolean; forceRestart?: boolean } = {},
): Record<string, unknown> => {
  const status = buildStatusPayload();
  const manifest = readJsonFile(MANIFEST_PATH) || {};
  const currentPid = Number(manifest.pid);
  const running = isProcessAlive(currentPid);
  const code = (status.code && typeof status.code === 'object')
    ? status.code as Record<string, unknown>
    : {};
  const restartRecommended = code.restartRecommended === true;
  const shouldRestart = running && (options.forceRestart === true || (options.restartIfStale === true && restartRecommended));

  if (running && !shouldRestart) {
    return {
      ok: true,
      started: false,
      alreadyRunning: true,
      restarted: false,
      pid: currentPid,
      status,
    };
  }

  if (shouldRestart) {
    const stopped = stopRunningProcess(currentPid);
    if (!stopped && isProcessAlive(currentPid)) {
      return {
        ok: false,
        started: false,
        alreadyRunning: true,
        restarted: false,
        pid: currentPid,
        error: 'failed to stop the existing local autonomy daemon before restart',
        restartReason: options.forceRestart === true ? 'forced' : compact(code.reason) || 'code-drift',
        status,
      };
    }
  }

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const fd = fs.openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, buildDetachedArgs(intervalMs), {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(fd);

  const relativeLogPath = path.relative(ROOT, LOG_PATH).replace(/\\/g, '/');
  const relativeStatusPath = path.relative(ROOT, STATUS_PATH).replace(/\\/g, '/');
  const trackedCodeState = buildTrackedCodeState();
  writeManifest({
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    intervalMs,
    logPath: relativeLogPath,
    statusPath: relativeStatusPath,
    detached: true,
    codeFingerprint: trackedCodeState.fingerprint,
    trackedFiles: trackedCodeState.trackedFiles,
  });

  return {
    ok: true,
    started: true,
    alreadyRunning: false,
    restarted: shouldRestart,
    pid: child.pid ?? null,
    logPath: relativeLogPath,
    statusPath: relativeStatusPath,
    restartReason: shouldRestart
      ? (options.forceRestart === true ? 'forced' : compact(code.reason) || 'code-drift')
      : null,
  };
};

const runCycle = async (reason: 'startup' | 'interval', detachedMode: boolean): Promise<void> => {
  const relativeManifestPath = path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/');
  const relativeStatusPath = path.relative(ROOT, STATUS_PATH).replace(/\\/g, '/');
  const relativeLogPath = path.relative(ROOT, LOG_PATH).replace(/\\/g, '/');
  const code = buildCodeDriftStatus(readJsonFile(MANIFEST_PATH) || {}, buildTrackedCodeState(), true);

  try {
    const summary = await runLocalAutonomySupervisorCycle();
    const payload = {
      ok: true,
      reason,
      checkedAt: new Date().toISOString(),
      summary,
      watchProcess: {
        pid: process.pid,
        mode: 'watch',
        detached: detachedMode,
        manifestPath: relativeManifestPath,
        statusPath: relativeStatusPath,
        logPath: relativeLogPath,
      },
      code,
      stats: getLocalAutonomySupervisorLoopStats(),
    };
    writeStatus(payload);
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      reason,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      watchProcess: {
        pid: process.pid,
        mode: 'watch',
        detached: detachedMode,
        manifestPath: relativeManifestPath,
        statusPath: relativeStatusPath,
        logPath: relativeLogPath,
      },
      code,
      stats: getLocalAutonomySupervisorLoopStats(),
    };
    writeStatus(payload);
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  }
};

async function main() {
  const once = parseBool(parseArg('once', 'false'), false);
  const watch = parseBool(parseArg('watch', 'false'), false);
  const status = parseBool(parseArg('status', 'false'), false);
  const stop = parseBool(parseArg('stop', 'false'), false);
  const detach = parseBool(parseArg('detach', 'false'), false);
  const restart = parseBool(parseArg('restart', 'false'), false);
  const detachedMode = parseBool(parseArg('detachedMode', 'false'), false);
  const intervalMs = parseIntervalMs(parseArg('intervalMs', String(DEFAULT_INTERVAL_MS)), DEFAULT_INTERVAL_MS);

  if (status) {
    console.log(JSON.stringify(buildStatusPayload(), null, 2));
    return;
  }

  if (stop) {
    const manifest = readJsonFile(MANIFEST_PATH) || {};
    const pid = Number(manifest.pid);
    const stopped = stopRunningProcess(pid);
    if (stopped || !isProcessAlive(pid)) {
      writeManifest({
        pid: null,
        startedAt: compact(manifest.startedAt) || null,
        stoppedAt: new Date().toISOString(),
        intervalMs: Number(manifest.intervalMs) || intervalMs,
        logPath: compact(manifest.logPath) || path.relative(ROOT, LOG_PATH).replace(/\\/g, '/'),
        statusPath: compact(manifest.statusPath) || path.relative(ROOT, STATUS_PATH).replace(/\\/g, '/'),
        detached: Boolean(manifest.detached),
        codeFingerprint: compact(manifest.codeFingerprint) || null,
        trackedFiles: Array.isArray(manifest.trackedFiles) ? manifest.trackedFiles : [],
      });
    }
    console.log(JSON.stringify({ ok: true, stopped, pid: Number.isInteger(pid) && pid > 0 ? pid : null }, null, 2));
    return;
  }

  if (restart) {
    console.log(JSON.stringify(startDetached(intervalMs, { forceRestart: true }), null, 2));
    return;
  }

  if (detach) {
    console.log(JSON.stringify(startDetached(intervalMs, { restartIfStale: true }), null, 2));
    return;
  }

  const relativeLogPath = path.relative(ROOT, LOG_PATH).replace(/\\/g, '/');
  const relativeStatusPath = path.relative(ROOT, STATUS_PATH).replace(/\\/g, '/');
  const trackedCodeState = buildTrackedCodeState();
  const ownsManifest = detachedMode || watch;
  if (ownsManifest) {
    writeManifest({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      intervalMs,
      logPath: relativeLogPath,
      statusPath: relativeStatusPath,
      detached: detachedMode,
      codeFingerprint: trackedCodeState.fingerprint,
      trackedFiles: trackedCodeState.trackedFiles,
    });
  }

  await runCycle('startup', detachedMode);

  if (once) {
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'watch',
    intervalMs,
    statusPath: path.relative(ROOT, STATUS_PATH).replace(/\\/g, '/'),
    logPath: relativeLogPath,
    detached: detachedMode,
  }, null, 2));

  setInterval(() => {
    void runCycle('interval', detachedMode);
  }, intervalMs);
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(SELF_SCRIPT_PATH)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
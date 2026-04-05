import { OBSIDIAN_FILE_LOCK_TIMEOUT_MS, OBSIDIAN_FILE_LOCK_STALE_MS, OBSIDIAN_FILE_LOCK_RETRY_MS } from '../config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toPositiveInt = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
};

const DEFAULT_LOCK_TIMEOUT_MS = OBSIDIAN_FILE_LOCK_TIMEOUT_MS;
const DEFAULT_LOCK_STALE_MS = OBSIDIAN_FILE_LOCK_STALE_MS;
const DEFAULT_LOCK_RETRY_MS = OBSIDIAN_FILE_LOCK_RETRY_MS;

const buildLockFilePath = (vaultRoot: string, key: string): string => {
  const safeRoot = path.resolve(vaultRoot);
  const digest = crypto.createHash('sha1').update(String(key || 'default')).digest('hex');
  return path.join(safeRoot, '.muel-locks', `${digest}.lock`);
};

const releaseLock = async (lockPath: string): Promise<void> => {
  try {
    await fs.rm(lockPath, { force: true });
  } catch {
    // Ignore lock cleanup failure.
  }
};

export const withObsidianFileLock = async <T>(params: {
  vaultRoot: string;
  key: string;
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  task: () => Promise<T>;
}): Promise<T> => {
  const vaultRoot = String(params.vaultRoot || '').trim();
  if (!vaultRoot) {
    return params.task();
  }

  const timeoutMs = toPositiveInt(params.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = toPositiveInt(params.staleMs, DEFAULT_LOCK_STALE_MS);
  const retryMs = toPositiveInt(params.retryMs, DEFAULT_LOCK_RETRY_MS);

  const lockPath = buildLockFilePath(vaultRoot, params.key);
  const lockDir = path.dirname(lockPath);
  await fs.mkdir(lockDir, { recursive: true });

  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(`${process.pid}:${new Date().toISOString()}`);
      } finally {
        await handle.close();
      }
      break;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = await fs.stat(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (Number.isFinite(ageMs) && ageMs > staleMs) {
          await releaseLock(lockPath);
          continue;
        }
      } catch {
        // If stat fails, retry quickly.
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`OBSIDIAN_FILE_LOCK_TIMEOUT key=${params.key}`);
      }

      await sleep(retryMs);
    }
  }

  try {
    return await params.task();
  } finally {
    await releaseLock(lockPath);
  }
};

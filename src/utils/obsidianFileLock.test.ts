import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withObsidianFileLock } from './obsidianFileLock';

const buildLockPath = (vaultRoot: string, key: string): string => {
  const digest = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(vaultRoot, '.muel-locks', `${digest}.lock`);
};

describe('withObsidianFileLock', () => {
  let vaultRoot = '';

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-lock-'));
  });

  afterEach(async () => {
    if (vaultRoot) {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it('reclaims stale locks before running the task', async () => {
    const lockPath = buildLockPath(vaultRoot, 'note-1');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, 'stale-lock', 'utf-8');
    const staleTime = new Date(Date.now() - 5_000);
    await fs.utimes(lockPath, staleTime, staleTime);

    const result = await withObsidianFileLock({
      vaultRoot,
      key: 'note-1',
      staleMs: 50,
      retryMs: 5,
      timeoutMs: 200,
      task: async () => 'ok',
    });

    expect(result).toBe('ok');
    await expect(fs.stat(lockPath)).rejects.toThrow();
  });

  it('times out when another fresh lock remains active', async () => {
    const lockPath = buildLockPath(vaultRoot, 'note-2');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, 'active-lock', 'utf-8');

    await expect(withObsidianFileLock({
      vaultRoot,
      key: 'note-2',
      staleMs: 5_000,
      retryMs: 5,
      timeoutMs: 30,
      task: async () => 'should-not-run',
    })).rejects.toThrow('OBSIDIAN_FILE_LOCK_TIMEOUT key=note-2');
  });
});
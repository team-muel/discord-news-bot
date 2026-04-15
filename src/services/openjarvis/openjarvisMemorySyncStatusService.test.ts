import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: spawnMock,
}));

import { getOpenJarvisMemorySyncStatus, runOpenJarvisMemorySync } from './openjarvisMemorySyncStatusService';

const writeSummary = (summaryPath: string, payload: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

describe('openJarvisMemorySyncStatusService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    spawnMock.mockReset();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns fresh healthy status when summary is recent and indexed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openjarvis-memory-sync-'));
    tempDirs.push(tempDir);
    const summaryPath = path.join(tempDir, 'summary.json');

    writeSummary(summaryPath, {
      generatedAt: new Date().toISOString(),
      dryRun: false,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'Remote MCP primary',
      supabaseAvailability: 'ok',
      counts: {
        total: 5,
        obsidian: 2,
        repo: 2,
        supabase: 1,
      },
      docs: [
        { section: 'obsidian', fileName: 'runtime-name-and-surface-matrix.md', sourceRef: 'vault:ops/control-tower/CANONICAL_MAP.md' },
      ],
      memoryIndex: {
        attempted: true,
        status: 'completed',
        completedAt: new Date().toISOString(),
        outputSummary: 'indexed 5 docs',
        reason: null,
      },
    });

    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_ENABLED', 'true');
    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_SUMMARY_PATH', summaryPath);

    expect(getOpenJarvisMemorySyncStatus()).toMatchObject({
      configured: true,
      exists: true,
      status: 'fresh',
      healthy: true,
      counts: {
        total: 5,
        obsidian: 2,
        repo: 2,
        supabase: 1,
      },
      memoryIndex: {
        attempted: true,
        status: 'completed',
        outputSummary: 'indexed 5 docs',
      },
      issues: [],
    });
  });

  it('returns missing when the sync is enabled but no summary exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openjarvis-memory-sync-'));
    tempDirs.push(tempDir);
    const summaryPath = path.join(tempDir, 'missing-summary.json');

    vi.stubEnv('OPENJARVIS_LEARNING_LOOP_ENABLED', 'true');
    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_SUMMARY_PATH', summaryPath);

    expect(getOpenJarvisMemorySyncStatus()).toMatchObject({
      configured: true,
      exists: false,
      status: 'missing',
      healthy: false,
    });
  });

  it('returns stale when the latest summary is dry-run only and index was skipped', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openjarvis-memory-sync-'));
    tempDirs.push(tempDir);
    const summaryPath = path.join(tempDir, 'summary.json');

    writeSummary(summaryPath, {
      generatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      dryRun: true,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'Direct vault primary',
      supabaseAvailability: 'missing_credentials',
      counts: {
        total: 1,
        obsidian: 0,
        repo: 1,
        supabase: 0,
      },
      docs: [
        { section: 'repo', fileName: 'architecture-index.md', sourceRef: 'repo:docs/ARCHITECTURE_INDEX.md' },
      ],
      memoryIndex: {
        attempted: false,
        status: 'skipped',
        completedAt: new Date().toISOString(),
        outputSummary: null,
        reason: 'dry_run',
      },
    });

    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_ENABLED', 'true');
    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_SUMMARY_PATH', summaryPath);
    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_STALE_AFTER_MINUTES', '60');

    const status = getOpenJarvisMemorySyncStatus();
    expect(status).toMatchObject({
      configured: true,
      exists: true,
      status: 'stale',
      healthy: false,
      dryRun: true,
      supabaseAvailability: 'missing_credentials',
      counts: {
        total: 1,
        obsidian: 0,
      },
      memoryIndex: {
        status: 'skipped',
        reason: 'dry_run',
      },
    });
    expect(status.issues).toEqual(expect.arrayContaining([
      'OpenJarvis memory projection is older than 60 minutes.',
      'The latest OpenJarvis memory projection was generated in dry-run mode only.',
      'OpenJarvis memory projection collected no Obsidian documents.',
      'OpenJarvis memory sync reported Supabase availability as missing_credentials.',
      'jarvis memory index was skipped: dry_run',
    ]));
  });

  it('queues the memory sync script directly through node with tsx', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; unref: ReturnType<typeof vi.fn> };
    child.pid = 4242;
    child.unref = vi.fn();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    const result = await runOpenJarvisMemorySync({
      dryRun: false,
      force: true,
      guildId: 'guild-1',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [
        '--import',
        'tsx',
        expect.stringContaining(path.join('scripts', 'sync-openjarvis-memory.ts')),
        '--force=true',
        '--guildId=guild-1',
      ],
      expect.objectContaining({
        cwd: expect.stringContaining('discord-news-bot'),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }),
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      force: true,
      guildId: 'guild-1',
      scriptName: 'openjarvis:memory:sync',
      command: 'node --import tsx scripts/sync-openjarvis-memory.ts --force=true --guildId=guild-1',
      completion: 'queued',
      pid: 4242,
      error: null,
    });
  });
});
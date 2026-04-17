import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, execFileAsyncMock, spawnMock, executeExternalActionMock } = vi.hoisted(() => {
  const execFileMock = vi.fn();
  const execFileAsyncMock = vi.fn();
  Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock,
  });

  return {
    execFileMock,
    execFileAsyncMock,
  spawnMock: vi.fn(),
    executeExternalActionMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

vi.mock('../tools/externalAdapterRegistry', () => ({
  executeExternalAction: executeExternalActionMock,
}));

import {
  ensureOpenJarvisMemorySyncSchedule,
  getOpenJarvisMemorySyncStatus,
  getOpenJarvisMemorySyncScheduleStatus,
  runOpenJarvisManagedMemoryMaintenance,
  runOpenJarvisMemorySync,
  startOpenJarvisSchedulerDaemon,
} from './openjarvisMemorySyncStatusService';

const writeSummary = (summaryPath: string, payload: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

describe('openJarvisMemorySyncStatusService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    execFileAsyncMock.mockReset();
    execFileMock.mockReset();
    spawnMock.mockReset();
    executeExternalActionMock.mockReset();
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

  it('returns a preview for dry-run managed memory maintenance without side effects', async () => {
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
        total: 4,
        obsidian: 2,
        repo: 1,
        supabase: 1,
      },
      docs: [],
      memoryIndex: {
        attempted: true,
        status: 'completed',
        completedAt: new Date().toISOString(),
        outputSummary: 'indexed 4 docs',
        reason: null,
      },
    });

    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_ENABLED', 'true');
    vi.stubEnv('OPENJARVIS_MEMORY_SYNC_SUMMARY_PATH', summaryPath);

    const result = await runOpenJarvisManagedMemoryMaintenance({
      dryRun: true,
      force: true,
      guildId: 'guild-1',
    });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      force: true,
      guildId: 'guild-1',
      agentName: 'repo-memory-maintainer',
      completion: 'skipped',
      managedAgentReady: false,
      managedMessageAccepted: false,
      managedRunTriggered: false,
      feedbackRecorded: null,
      feedbackScore: null,
      statusBefore: expect.objectContaining({ status: 'fresh' }),
      statusAfter: expect.objectContaining({ status: 'fresh' }),
    });
    expect(executeExternalActionMock).not.toHaveBeenCalled();
    expect(execFileAsyncMock).not.toHaveBeenCalled();
  });

  it('runs managed memory maintenance through the agent, blocking sync, trace, and feedback loop', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openjarvis-memory-sync-'));
    tempDirs.push(tempDir);
    const summaryPath = path.join(tempDir, 'summary.json');

    writeSummary(summaryPath, {
      generatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      dryRun: true,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'Remote MCP primary',
      supabaseAvailability: 'ok',
      counts: {
        total: 1,
        obsidian: 0,
        repo: 1,
        supabase: 0,
      },
      docs: [],
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

    executeExternalActionMock
      .mockResolvedValueOnce({
        ok: true,
        output: ['[1] agent-123 repo-memory-maintainer - ready'],
        summary: 'listed agents',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: ['queued'],
        summary: 'message queued',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: ['running'],
        summary: 'run started',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: ['[1] trace-999 [completed] maintenance cycle'],
        summary: 'trace listed',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: ['feedback recorded'],
        summary: 'feedback recorded',
        error: null,
      });

    execFileAsyncMock.mockImplementationOnce(async () => {
      writeSummary(summaryPath, {
        generatedAt: new Date().toISOString(),
        dryRun: false,
        forced: true,
        vaultPath: '/vault',
        obsidianAdapterSummary: 'Remote MCP primary',
        supabaseAvailability: 'ok',
        counts: {
          total: 6,
          obsidian: 3,
          repo: 2,
          supabase: 1,
        },
        docs: [],
        memoryIndex: {
          attempted: true,
          status: 'completed',
          completedAt: new Date().toISOString(),
          outputSummary: 'indexed 6 docs',
          reason: null,
        },
      });

      return {
        stdout: 'projection refreshed\nindexed 6 docs\n',
        stderr: '',
      };
    });

    const result = await runOpenJarvisManagedMemoryMaintenance({
      dryRun: false,
      force: true,
      guildId: 'guild-1',
      timeoutMs: 15000,
    });

    expect(executeExternalActionMock).toHaveBeenNthCalledWith(1, 'openjarvis', 'jarvis.agent.list');
    expect(executeExternalActionMock).toHaveBeenNthCalledWith(2, 'openjarvis', 'jarvis.agent.message', expect.objectContaining({
      agentId: 'agent-123',
      mode: 'queued',
    }));
    expect(executeExternalActionMock).toHaveBeenNthCalledWith(3, 'openjarvis', 'jarvis.agent.run', {
      agentId: 'agent-123',
    });
    expect(executeExternalActionMock).toHaveBeenNthCalledWith(4, 'openjarvis', 'jarvis.agent.traces.list', {
      agentId: 'agent-123',
      limit: 1,
    });
    expect(executeExternalActionMock).toHaveBeenNthCalledWith(5, 'openjarvis', 'jarvis.feedback', {
      traceId: 'trace-999',
      score: 1,
    });
    expect(execFileAsyncMock).toHaveBeenCalledWith(
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
        timeout: 15000,
        windowsHide: true,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      force: true,
      guildId: 'guild-1',
      agentName: 'repo-memory-maintainer',
      agentId: 'agent-123',
      agentCreated: false,
      managedAgentReady: true,
      managedMessageAccepted: true,
      managedRunTriggered: true,
      latestTraceId: 'trace-999',
      latestTraceOutcome: 'completed',
      feedbackRecorded: true,
      feedbackScore: 1,
      completion: 'completed',
      syncExecution: expect.objectContaining({
        ok: true,
        exitCode: 0,
        stdoutLines: ['projection refreshed', 'indexed 6 docs'],
        error: null,
      }),
      statusBefore: expect.objectContaining({ status: 'stale' }),
      statusAfter: expect.objectContaining({ status: 'fresh' }),
      warnings: [],
      error: null,
    });
  });

  it('reports the OpenJarvis memory-sync scheduler status from scheduler list output', async () => {
    executeExternalActionMock.mockResolvedValueOnce({
      ok: true,
      output: [
        'ID  Prompt  Type  Status  Next Run  Agent',
        'task-1  Check discord-news-bot memory sync  interval  active  2026-04-15T01:00:00.000Z  orchestrator',
      ],
      summary: 'scheduler list',
      error: null,
    });

    const status = await getOpenJarvisMemorySyncScheduleStatus();

    expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.scheduler.list', {});
    expect(status).toMatchObject({
      available: true,
      healthy: true,
      configuredPrompt: 'Check discord-news-bot memory sync',
      taskId: 'task-1',
      taskStatus: 'active',
      taskScheduleType: 'interval',
      activeTaskCount: 1,
      matchingTaskCount: 1,
      issues: [],
    });
  });

  it('creates the OpenJarvis memory-sync scheduler task when no matching task exists', async () => {
    executeExternalActionMock
      .mockResolvedValueOnce({
        ok: true,
        output: ['No scheduled tasks found.'],
        summary: 'scheduler list empty',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: [
          'Created task task-1',
          'Type: interval',
          'Value: 3600',
          'Next run: 2026-04-15T01:00:00.000Z',
          'Agent: orchestrator',
        ],
        summary: 'scheduler task created',
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        output: [
          'task-1  Check discord-news-bot memory sync  interval  active  2026-04-15T01:00:00.000Z  orchestrator',
        ],
        summary: 'scheduler list populated',
        error: null,
      });

    const result = await ensureOpenJarvisMemorySyncSchedule();

    expect(executeExternalActionMock).toHaveBeenNthCalledWith(1, 'openjarvis', 'jarvis.scheduler.list', {});
    expect(executeExternalActionMock).toHaveBeenNthCalledWith(2, 'openjarvis', 'jarvis.scheduler.create', {
      prompt: 'Check discord-news-bot memory sync',
      scheduleType: 'interval',
      scheduleValue: '3600',
      agent: 'orchestrator',
      tools: [],
    });
    expect(result).toMatchObject({
      ok: true,
      completion: 'created',
      taskId: 'task-1',
      taskCreated: true,
      taskResumed: false,
      statusAfter: {
        healthy: true,
        taskStatus: 'active',
      },
      error: null,
    });
  });

  it('starts the OpenJarvis scheduler daemon as a detached process', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; unref: ReturnType<typeof vi.fn> };
    child.pid = 5151;
    child.unref = vi.fn();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    const result = await startOpenJarvisSchedulerDaemon({ pollIntervalSeconds: 90 });

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath ? expect.any(String) : expect.any(String),
      expect.any(Array),
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
      completion: 'queued',
      pid: 5151,
      command: 'jarvis scheduler start --poll-interval 90',
      error: null,
    });
  });
});
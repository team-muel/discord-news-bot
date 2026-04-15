import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMemoryQualityMetrics: vi.fn(),
  getMemoryJobQueueStats: vi.fn(),
  getAgentTelemetryQueueSnapshot: vi.fn(),
  getOpenJarvisMemorySyncStatus: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  getSupabaseClient: vi.fn(),
  emitSignal: vi.fn(),
}));

vi.mock('./memory/memoryQualityMetricsService', () => ({
  getMemoryQualityMetrics: mocks.getMemoryQualityMetrics,
}));

vi.mock('./memory/memoryJobRunner', () => ({
  getMemoryJobQueueStats: mocks.getMemoryJobQueueStats,
}));

vi.mock('./agent/agentTelemetryQueue', () => ({
  getAgentTelemetryQueueSnapshot: mocks.getAgentTelemetryQueueSnapshot,
}));

vi.mock('./openjarvis/openjarvisMemorySyncStatusService', () => ({
  getOpenJarvisMemorySyncStatus: mocks.getOpenJarvisMemorySyncStatus,
}));

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock('./runtime/signalBus', () => ({
  emitSignal: mocks.emitSignal,
}));

import { buildGoNoGoReport } from './goNoGoService';

describe('goNoGoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getMemoryQualityMetrics.mockResolvedValue({
      scope: { guildId: 'guild-1' },
      windowDays: 14,
      memory: { citationRate: 0.99 },
      retrieval: { recallAt5: 0.92 },
      conflicts: { unresolvedConflictRate: 0.01 },
      jobs: { failureRate: 0.01 },
      feedback: { correctionSlaP95Minutes: 1.2 },
    });
    mocks.getMemoryJobQueueStats.mockResolvedValue({ deadlettered: 0 });
    mocks.getAgentTelemetryQueueSnapshot.mockReturnValue({ processed: 25, dropped: 0 });
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              limit: async () => ({
                data: [
                  { guild_id: 'guild-1', is_active: true },
                  { guild_id: 'guild-2', is_active: true },
                  { guild_id: 'guild-3', is_active: true },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mocks.getOpenJarvisMemorySyncStatus.mockReturnValue({
      configured: true,
      summaryPath: 'tmp/openjarvis-memory-feed/summary.json',
      exists: true,
      status: 'fresh',
      healthy: true,
      generatedAt: '2026-04-12T00:00:00.000Z',
      ageMinutes: 5,
      staleAfterMinutes: 1440,
      dryRun: false,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'remote-mcp primary',
      supabaseAvailability: 'ok',
      counts: { total: 8, obsidian: 3, repo: 2, supabase: 3 },
      docs: [],
      memoryIndex: { attempted: true, status: 'completed', completedAt: '2026-04-12T00:00:10.000Z', outputSummary: 'indexed 8 docs', reason: null },
      issues: [],
    });
  });

  it('fails go/no-go when configured OpenJarvis memory sync is not fresh', async () => {
    mocks.getOpenJarvisMemorySyncStatus.mockReturnValueOnce({
      configured: true,
      summaryPath: 'tmp/openjarvis-memory-feed/summary.json',
      exists: true,
      status: 'stale',
      healthy: false,
      generatedAt: '2026-04-10T00:00:00.000Z',
      ageMinutes: 1800,
      staleAfterMinutes: 1440,
      dryRun: true,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'remote-mcp primary',
      supabaseAvailability: 'ok',
      counts: { total: 8, obsidian: 3, repo: 2, supabase: 3 },
      docs: [],
      memoryIndex: { attempted: false, status: 'skipped', completedAt: null, outputSummary: null, reason: 'dry_run' },
      issues: ['The latest OpenJarvis memory projection was generated in dry-run mode only.'],
    });

    const report = await buildGoNoGoReport({ guildId: 'guild-1', days: 14 });

    expect(report.decision).toBe('no-go');
    expect(report.failedChecks).toContain('openjarvis-memory-sync');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openjarvis-memory-sync',
        actual: 'stale',
        status: 'fail',
      }),
    ]));
  });

  it('does not fail go/no-go when OpenJarvis memory sync is not configured', async () => {
    mocks.getOpenJarvisMemorySyncStatus.mockReturnValueOnce({
      configured: false,
      summaryPath: 'tmp/openjarvis-memory-feed/summary.json',
      exists: false,
      status: 'disabled',
      healthy: null,
      generatedAt: null,
      ageMinutes: null,
      staleAfterMinutes: 1440,
      dryRun: null,
      forced: null,
      vaultPath: null,
      obsidianAdapterSummary: null,
      supabaseAvailability: null,
      counts: null,
      docs: [],
      memoryIndex: { attempted: null, status: null, completedAt: null, outputSummary: null, reason: null },
      issues: ['OpenJarvis memory sync is currently disabled by runtime env flags.'],
    });

    const report = await buildGoNoGoReport({ guildId: 'guild-1', days: 14 });

    expect(report.decision).toBe('go');
    expect(report.failedChecks).not.toContain('openjarvis-memory-sync');
  });
});
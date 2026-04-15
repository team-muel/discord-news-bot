import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActionRunnerDiagnosticsSnapshot: vi.fn(),
  getWorkerProposalMetricsSnapshot: vi.fn(),
  buildGoNoGoReport: vi.fn(),
  getOpenJarvisMemorySyncStatus: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  getSupabaseClient: vi.fn(),
  getAgentTelemetryQueueSnapshot: vi.fn(),
}));

vi.mock('../skills/actionRunner', () => ({
  getActionRunnerDiagnosticsSnapshot: mocks.getActionRunnerDiagnosticsSnapshot,
}));

vi.mock('../workerGeneration/workerProposalMetrics', () => ({
  getWorkerProposalMetricsSnapshot: mocks.getWorkerProposalMetricsSnapshot,
}));

vi.mock('../goNoGoService', () => ({
  buildGoNoGoReport: mocks.buildGoNoGoReport,
}));

vi.mock('../openjarvis/openjarvisMemorySyncStatusService', () => ({
  getOpenJarvisMemorySyncStatus: mocks.getOpenJarvisMemorySyncStatus,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock('./agentTelemetryQueue', () => ({
  getAgentTelemetryQueueSnapshot: mocks.getAgentTelemetryQueueSnapshot,
}));

describe('agentRuntimeReadinessService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    mocks.buildGoNoGoReport.mockResolvedValue({
      decision: 'go',
      failedChecks: [],
    });
    mocks.getActionRunnerDiagnosticsSnapshot.mockReturnValue({
      totalRuns: 10,
      failedRuns: 0,
      failureTotals: {
        missingAction: 0,
        policyBlocked: 0,
        totalFailures: 0,
      },
    });
    mocks.getWorkerProposalMetricsSnapshot.mockReturnValue({
      generationRequested: 0,
      generationSuccessRate: 0,
      approvalsApproved: 0,
      approvalsRejected: 0,
      approvalPassRate: 0,
    });
    mocks.isSupabaseConfigured.mockReturnValue(false);
    mocks.getAgentTelemetryQueueSnapshot.mockReturnValue({ processed: 10, dropped: 0 });
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

  it('blocks readiness when configured OpenJarvis memory sync is stale', async () => {
    vi.stubEnv('AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL', 'false');
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

    const { buildAgentRuntimeReadinessReport } = await import('./agentRuntimeReadinessService');
    const report = await buildAgentRuntimeReadinessReport({ guildId: 'guild-1' });

    expect(report.decision).toBe('block');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'observability-openjarvis-memory-sync',
        status: 'fail',
        actual: 'stale',
      }),
    ]));
  });

  it('warns but does not block when OpenJarvis memory sync is not configured', async () => {
    vi.stubEnv('AGENT_READINESS_REQUIRE_RETRIEVAL_EVAL', 'false');
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

    const { buildAgentRuntimeReadinessReport } = await import('./agentRuntimeReadinessService');
    const report = await buildAgentRuntimeReadinessReport({ guildId: 'guild-1' });
    const check = report.checks.find((entry) => entry.id === 'observability-openjarvis-memory-sync');

    expect(report.decision).toBe('pass');
    expect(check).toMatchObject({
      status: 'warn',
      actual: 'disabled',
    });
  });
});
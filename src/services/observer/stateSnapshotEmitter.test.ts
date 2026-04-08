import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';

// Mock fs/promises to avoid touching disk
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}));

const mockObservations = [
  { channel: 'error-pattern', severity: 'critical', title: 'Error spike', detectedAt: '2026-01-01T00:00:00Z' },
  { channel: 'perf-drift', severity: 'warning', title: 'Latency up', detectedAt: '2026-01-01T00:01:00Z' },
];

const mockIntents = [
  { ruleId: 'recurring-error-cluster', objective: 'Fix errors', status: 'pending', priorityScore: 0.9 },
];

vi.mock('./observationStore', () => ({
  getRecentObservations: vi.fn(async () => mockObservations),
}));

vi.mock('../intent/intentStore', () => ({
  getIntents: vi.fn(async () => mockIntents),
}));

vi.mock('./observerOrchestrator', () => ({
  getObserverStats: vi.fn(() => ({
    enabled: true,
    totalScans: 5,
    totalObservations: 12,
    lastScanAt: '2026-01-01T00:00:00Z',
    channelStatus: {},
  })),
}));

describe('stateSnapshotEmitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes snapshot file with correct structure', async () => {
    const { emitStateSnapshot } = await import('./stateSnapshotEmitter');
    await emitStateSnapshot('guild-test');

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.state'), { recursive: true });
    expect(writeFile).toHaveBeenCalledOnce();

    const [writePath, content] = vi.mocked(writeFile).mock.calls[0];
    expect(String(writePath)).toContain('system-snapshot.json');

    const snapshot = JSON.parse(String(content));
    expect(snapshot).toHaveProperty('generatedAt');
    expect(snapshot.recentObservations).toHaveLength(2);
    expect(snapshot.recentObservations[0]).toMatchObject({
      channel: 'error-pattern',
      severity: 'critical',
      title: 'Error spike',
    });
    expect(snapshot.recentIntents).toHaveLength(1);
    expect(snapshot.recentIntents[0]).toMatchObject({
      ruleId: 'recurring-error-cluster',
      status: 'pending',
    });
    expect(snapshot.observerStats).toMatchObject({
      totalScans: 5,
      totalObservations: 12,
    });
  });

  it('does not throw when stores fail', async () => {
    const { getRecentObservations } = await import('./observationStore');
    vi.mocked(getRecentObservations).mockRejectedValueOnce(new Error('DB_ERROR'));

    const { emitStateSnapshot } = await import('./stateSnapshotEmitter');
    // Should not throw
    await expect(emitStateSnapshot('guild-fail')).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../agent/agentMemoryStore', () => ({
  createMemoryItem: vi.fn(async () => ({ id: 'mem_test' })),
}));

vi.mock('./observationStore', () => ({
  markObservationsConsumed: vi.fn(async () => {}),
}));

describe('observationMemoryBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 for empty observations', async () => {
    const { bridgeObservationsToMemory } = await import('./observationMemoryBridge');
    const count = await bridgeObservationsToMemory([]);
    expect(count).toBe(0);
  });

  it('creates one memory per channel group', async () => {
    const { bridgeObservationsToMemory } = await import('./observationMemoryBridge');
    const { createMemoryItem } = await import('../agent/agentMemoryStore');

    const observations = [
      {
        guildId: 'g1',
        channel: 'error-pattern' as const,
        severity: 'warning' as const,
        title: 'Error A',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
      {
        guildId: 'g1',
        channel: 'error-pattern' as const,
        severity: 'critical' as const,
        title: 'Error B',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
      {
        guildId: 'g1',
        channel: 'perf-drift' as const,
        severity: 'info' as const,
        title: 'Latency up',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
    ];

    const count = await bridgeObservationsToMemory(observations);

    // 2 channel groups: error-pattern, perf-drift
    expect(count).toBe(2);
    expect(createMemoryItem).toHaveBeenCalledTimes(2);

    // Verify first call (error-pattern group) uses highest severity
    const firstCall = vi.mocked(createMemoryItem).mock.calls[0][0];
    expect(firstCall.type).toBe('semantic');
    expect(firstCall.tags).toContain('obs/error-pattern');
    expect(firstCall.tags).toContain('severity/critical');
    expect(firstCall.confidence).toBe(0.9);

    // Verify second call (perf-drift) uses info severity
    const secondCall = vi.mocked(createMemoryItem).mock.calls[1][0];
    expect(secondCall.tags).toContain('obs/perf-drift');
    expect(secondCall.tags).toContain('severity/info');
    expect(secondCall.confidence).toBe(0.5);
  });

  it('handles createMemoryItem failures gracefully', async () => {
    const { createMemoryItem } = await import('../agent/agentMemoryStore');
    vi.mocked(createMemoryItem).mockRejectedValueOnce(new Error('SUPABASE_NOT_CONFIGURED'));

    const { bridgeObservationsToMemory } = await import('./observationMemoryBridge');

    const count = await bridgeObservationsToMemory([
      {
        guildId: 'g1',
        channel: 'memory-gap' as const,
        severity: 'warning' as const,
        title: 'Stale memories',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
    ]);

    // Should return 0 (failed) without throwing
    expect(count).toBe(0);
  });

  it('marks observations consumed after successful bridge', async () => {
    const { bridgeObservationsToMemory } = await import('./observationMemoryBridge');
    const { markObservationsConsumed } = await import('./observationStore');

    const count = await bridgeObservationsToMemory([
      {
        id: 'obs-1',
        guildId: 'g1',
        channel: 'error-pattern' as const,
        severity: 'warning' as const,
        title: 'Error X',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
      {
        id: 'obs-2',
        guildId: 'g1',
        channel: 'error-pattern' as const,
        severity: 'info' as const,
        title: 'Error Y',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
    ]);

    expect(count).toBe(1);
    expect(markObservationsConsumed).toHaveBeenCalledWith(['obs-1', 'obs-2']);
  });

  it('does not call markObservationsConsumed when observations have no id', async () => {
    const { bridgeObservationsToMemory } = await import('./observationMemoryBridge');
    const { markObservationsConsumed } = await import('./observationStore');

    await bridgeObservationsToMemory([
      {
        guildId: 'g1',
        channel: 'perf-drift' as const,
        severity: 'info' as const,
        title: 'Latency',
        payload: {},
        detectedAt: new Date().toISOString(),
      },
    ]);

    expect(markObservationsConsumed).not.toHaveBeenCalled();
  });
});

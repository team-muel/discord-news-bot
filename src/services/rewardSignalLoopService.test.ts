import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./rewardSignalService', () => ({
  computeRewardSnapshot: vi.fn(),
  persistRewardSnapshot: vi.fn(),
}));

const mockGuildsCache = new Map([
  ['guild-1', {}],
  ['guild-2', {}],
]);

const mockClient = {
  guilds: { cache: mockGuildsCache },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('rewardSignalLoopService', () => {
  it('startRewardSignalLoop starts and stopRewardSignalLoop clears timer', async () => {
    vi.stubEnv('REWARD_SIGNAL_LOOP_ENABLED', 'true');
    vi.stubEnv('REWARD_SIGNAL_LOOP_RUN_ON_START', 'false');

    const { startRewardSignalLoop, stopRewardSignalLoop, getRewardSignalLoopStatus } = await import('./rewardSignalLoopService');

    startRewardSignalLoop(mockClient);
    const status = getRewardSignalLoopStatus();
    expect(status.enabled).toBe(true);

    stopRewardSignalLoop();
    vi.unstubAllEnvs();
  });

  it('getRewardSignalLoopStatus returns expected shape', async () => {
    const { getRewardSignalLoopStatus } = await import('./rewardSignalLoopService');
    const status = getRewardSignalLoopStatus();

    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('lastRunAt');
    expect(status).toHaveProperty('lastSummary');
    expect(status).toHaveProperty('intervalHours');
    expect(typeof status.intervalHours).toBe('number');
  });
});

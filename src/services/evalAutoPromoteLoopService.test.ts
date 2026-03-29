import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./evalAutoPromoteService', () => ({
  runEvalPipeline: vi.fn(),
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

describe('evalAutoPromoteLoopService', () => {
  it('startEvalAutoPromoteLoop starts and stopEvalAutoPromoteLoop clears timer', async () => {
    vi.stubEnv('EVAL_AUTO_PROMOTE_LOOP_ENABLED', 'true');
    vi.stubEnv('EVAL_AUTO_PROMOTE_LOOP_RUN_ON_START', 'false');

    const { startEvalAutoPromoteLoop, stopEvalAutoPromoteLoop, getEvalAutoPromoteLoopStatus } = await import('./evalAutoPromoteLoopService');

    startEvalAutoPromoteLoop(mockClient);
    const status = getEvalAutoPromoteLoopStatus();
    expect(status.enabled).toBe(true);

    stopEvalAutoPromoteLoop();
    vi.unstubAllEnvs();
  });

  it('getEvalAutoPromoteLoopStatus returns expected shape', async () => {
    const { getEvalAutoPromoteLoopStatus } = await import('./evalAutoPromoteLoopService');
    const status = getEvalAutoPromoteLoopStatus();

    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('running');
    expect(status).toHaveProperty('lastRunAt');
    expect(status).toHaveProperty('lastSummary');
    expect(status).toHaveProperty('intervalHours');
    expect(typeof status.intervalHours).toBe('number');
  });
});

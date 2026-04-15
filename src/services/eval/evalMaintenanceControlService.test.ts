import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunEvalAutoPromoteLoopOnce,
  mockRunRetrievalEvalLoopOnce,
  mockRunRewardSignalLoopOnce,
} = vi.hoisted(() => ({
  mockRunEvalAutoPromoteLoopOnce: vi.fn(),
  mockRunRetrievalEvalLoopOnce: vi.fn(),
  mockRunRewardSignalLoopOnce: vi.fn(),
}));

vi.mock('./evalAutoPromoteLoopService', () => ({
  runEvalAutoPromoteLoopOnce: mockRunEvalAutoPromoteLoopOnce,
}));

vi.mock('./retrievalEvalLoopService', () => ({
  runRetrievalEvalLoopOnce: mockRunRetrievalEvalLoopOnce,
}));

vi.mock('./rewardSignalLoopService', () => ({
  runRewardSignalLoopOnce: mockRunRewardSignalLoopOnce,
}));

describe('evalMaintenanceControlService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunRetrievalEvalLoopOnce.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0, appliedTunings: 0 });
    mockRunRewardSignalLoopOnce.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0 });
    mockRunEvalAutoPromoteLoopOnce.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0, totalCollected: 0, totalJudged: 0, totalPromoted: 0, totalRejected: 0 });
  });

  it('exposes the canonical repo-runtime eval maintenance surface', async () => {
    const { getEvalMaintenanceControlSurface } = await import('./evalMaintenanceControlService');

    expect(getEvalMaintenanceControlSurface()).toEqual({
      executor: 'repo-runtime',
      tasks: ['retrieval-eval', 'reward-signal', 'auto-promote'],
    });
  });

  it('runs retrieval eval through the control facade', async () => {
    const { executeRetrievalEvalLoop } = await import('./evalMaintenanceControlService');

    await expect(executeRetrievalEvalLoop(['guild-1'])).resolves.toMatchObject({ attemptedGuilds: 1 });
    expect(mockRunRetrievalEvalLoopOnce).toHaveBeenCalledWith(['guild-1']);
  });

  it('runs reward signal through the control facade', async () => {
    const { executeRewardSignalLoop } = await import('./evalMaintenanceControlService');

    await expect(executeRewardSignalLoop(['guild-1'])).resolves.toMatchObject({ completedGuilds: 1 });
    expect(mockRunRewardSignalLoopOnce).toHaveBeenCalledWith(['guild-1']);
  });

  it('runs eval auto-promote through the control facade', async () => {
    const { executeEvalAutoPromoteLoop } = await import('./evalMaintenanceControlService');

    await expect(executeEvalAutoPromoteLoop(['guild-1'])).resolves.toMatchObject({ totalPromoted: 0 });
    expect(mockRunEvalAutoPromoteLoopOnce).toHaveBeenCalledWith(['guild-1']);
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

const { runStartupTaskSafely } = await import('./startupTasks');
const { default: logger } = await import('../../logger');

describe('runStartupTaskSafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs synchronous failures', () => {
    runStartupTaskSafely('syncTask', () => {
      throw new Error('boom');
    });

    expect(logger.error).toHaveBeenCalledWith('[BOT] %s failed: %s', 'syncTask', 'boom');
  });

  it('logs asynchronous failures', async () => {
    runStartupTaskSafely('asyncTask', async () => {
      throw new Error('async boom');
    });

    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith('[BOT] %s failed: %s', 'asyncTask', 'async boom');
  });

  it('does not log on success', async () => {
    runStartupTaskSafely('okTask', async () => {});

    await Promise.resolve();

    expect(logger.error).not.toHaveBeenCalled();
  });
});
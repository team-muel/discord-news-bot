import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildActionCacheKey, executeResolvedAction, getCachedActionResult, storeCachedActionResult } from './actionRunnerExecution';
import { __resetActionRunnerStateForTests } from './actionRunnerState';

beforeEach(() => {
  __resetActionRunnerStateForTests();
});

describe('buildActionCacheKey', () => {
  it('sorts nested args deterministically', () => {
    const a = buildActionCacheKey({
      guildId: 'guild-1',
      actionName: 'web.search',
      goal: 'Find release notes',
      args: { nested: { b: 2, a: 1 }, q: 'hello' },
    });
    const b = buildActionCacheKey({
      guildId: 'guild-1',
      actionName: 'web.search',
      goal: ' Find   release notes ',
      args: { q: 'hello', nested: { a: 1, b: 2 } },
    });

    expect(a).toBe(b);
  });
});

describe('executeResolvedAction', () => {
  it('retries retryable failures and returns the later success', async () => {
    let attempts = 0;
    const action = {
      name: 'web.search',
      execute: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('ACTION_TIMEOUT');
        }
        return {
          ok: true,
          name: 'web.search',
          summary: 'done',
          artifacts: ['artifact-1'],
          verification: ['verified'],
        };
      }),
    };

    const result = await executeResolvedAction({
      action,
      goal: 'search docs',
      args: { query: 'docs' },
      guildId: 'guild-1',
      requestedBy: 'user-1',
      retryMax: 1,
      timeoutMs: 1000,
    });

    expect(result.attemptCount).toBe(2);
    expect(result.final.ok).toBe(true);
    expect(result.final.summary).toBe('done');
    expect(action.execute).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on invalid input without calling execute', async () => {
    const action = {
      name: 'web.search',
      execute: vi.fn(async () => ({
        ok: true,
        name: 'web.search',
        summary: 'done',
        artifacts: [],
        verification: [],
      })),
    };

    const result = await executeResolvedAction({
      action,
      goal: '',
      args: {},
      guildId: 'guild-1',
      requestedBy: 'user-1',
      retryMax: 3,
      timeoutMs: 1000,
    });

    expect(result.attemptCount).toBe(1);
    expect(result.final.ok).toBe(false);
    expect(result.final.error).toBe('ACTION_INPUT_INVALID');
    expect(action.execute).not.toHaveBeenCalled();
  });
});

describe('cache helpers', () => {
  it('stores and reads cached action results through actionRunnerState', () => {
    storeCachedActionResult({
      cacheKey: 'cache-key',
      ttlMs: 60_000,
      result: {
        ok: true,
        name: 'web.search',
        summary: 'cached',
        artifacts: ['artifact-1'],
        verification: ['cached=true'],
      },
    });

    expect(getCachedActionResult('cache-key')).toEqual(expect.objectContaining({
      name: 'web.search',
      summary: 'cached',
      artifacts: ['artifact-1'],
      verification: ['cached=true'],
    }));
  });
});
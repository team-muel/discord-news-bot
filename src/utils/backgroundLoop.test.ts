import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { BackgroundLoop } from './backgroundLoop';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('BackgroundLoop', () => {
  it('start/stop lifecycle manages timer', () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 1000 });

    expect(loop.isStarted).toBe(false);
    loop.start();
    expect(loop.isStarted).toBe(true);

    loop.stop();
    expect(loop.isStarted).toBe(false);
  });

  it('start is idempotent', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 1000 });

    loop.start();
    loop.start(); // second call should be no-op
    expect(loop.isStarted).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    // Only one interval should be active
    expect(tick).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it('runs tick on interval', async () => {
    const tick = vi.fn().mockResolvedValue('ok');
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 500 });

    loop.start();
    expect(tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it('runOnStart executes tick immediately', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 60_000, runOnStart: true });

    loop.start();
    // Flush the microtask queue for the void runOnce() promise
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it('tracks stats correctly', async () => {
    const tick = vi.fn().mockResolvedValue('summary-text');
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 1000, runOnStart: true });

    const before = loop.getStats();
    expect(before.runCount).toBe(0);
    expect(before.lastRunAt).toBeNull();
    expect(before.lastSummary).toBeNull();

    loop.start();
    await vi.advanceTimersByTimeAsync(0);

    const after = loop.getStats();
    expect(after.started).toBe(true);
    expect(after.runCount).toBe(1);
    expect(after.lastSummary).toBe('summary-text');
    expect(after.lastRunAt).toBeTruthy();

    loop.stop();
  });

  it('logs errors and tracks lastErrorAt', async () => {
    const tick = vi.fn().mockRejectedValue(new Error('boom'));
    const loop = new BackgroundLoop(tick, { name: '[ERR-TEST]', intervalMs: 1000, runOnStart: true, errorLevel: 'error' });

    loop.start();
    await vi.advanceTimersByTimeAsync(0);

    const stats = loop.getStats();
    expect(stats.runCount).toBe(0); // failed ticks don't increment
    expect(stats.lastErrorAt).toBeTruthy();

    loop.stop();
  });

  it('skips overlapping ticks (reentrancy guard)', async () => {
    let resolveFirst: (() => void) | null = null;
    let callCount = 0;

    const tick = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve();
    });

    const loop = new BackgroundLoop(tick, { name: '[REENTRANT]', intervalMs: 100 });
    loop.start();

    // First tick starts
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(loop.isRunning).toBe(true);

    // Second tick fires while first is still running — should be skipped
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1); // still 1

    // Complete first tick
    resolveFirst!();
    await vi.advanceTimersByTimeAsync(0);

    loop.stop();
  });

  it('stop clears timer even when running', () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new BackgroundLoop(tick, { name: '[TEST]', intervalMs: 1000 });
    loop.start();
    loop.stop();

    // No more ticks after stop
    expect(tick).not.toHaveBeenCalled();
  });
});

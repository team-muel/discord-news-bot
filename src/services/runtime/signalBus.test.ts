import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('signalBus', () => {
  beforeEach(async () => {
    const { __resetSignalBusForTests } = await import('./signalBus');
    __resetSignalBusForTests();
  });

  it('emits signal and calls listener', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    const received: unknown[] = [];
    onSignal('reward.degrading', (s) => { received.push(s); });

    const ok = emitSignal('reward.degrading', 'test', 'guild-1', { trend: 'degrading', delta: -0.1 });
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect((received[0] as { name: string }).name).toBe('reward.degrading');
  });

  it('wildcard listener receives all signals', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    const received: unknown[] = [];
    onSignal('*', (s) => { received.push(s); });

    emitSignal('reward.degrading', 'a', 'g1', { trend: 'degrading', delta: -0.1 });
    emitSignal('gonogo.go', 'b', 'g2', { decision: 'go', failedChecks: [], failedCount: 0 });
    expect(received).toHaveLength(2);
  });

  it('respects cooldown', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    const received: unknown[] = [];
    onSignal('reward.degrading', (s) => { received.push(s); });

    emitSignal('reward.degrading', 'test', 'guild-1', { trend: 'degrading', delta: -0.1 });
    const second = emitSignal('reward.degrading', 'test', 'guild-1', { trend: 'degrading', delta: -0.2 });
    expect(second).toBe(false);
    expect(received).toHaveLength(1);
  });

  it('different guilds bypass cooldown', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    const received: unknown[] = [];
    onSignal('reward.degrading', (s) => { received.push(s); });

    emitSignal('reward.degrading', 'test', 'guild-1', { trend: 'degrading', delta: -0.1 });
    emitSignal('reward.degrading', 'test', 'guild-2', { trend: 'degrading', delta: -0.2 });
    expect(received).toHaveLength(2);
  });

  it('unsubscribe removes listener', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    const received: unknown[] = [];
    const unsub = onSignal('reward.degrading', (s) => { received.push(s); });
    unsub();

    emitSignal('reward.degrading', 'test', 'guild-1', { trend: 'degrading', delta: -0.1 });
    expect(received).toHaveLength(0);
  });

  it('getSignalBusSnapshot returns diagnostic data', async () => {
    const { emitSignal, onSignal, getSignalBusSnapshot } = await import('./signalBus');
    onSignal('reward.degrading', () => {});
    emitSignal('reward.degrading', 'test', 'g1', { trend: 'degrading', delta: -0.1 });

    const snap = getSignalBusSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.listenerCount).toBeGreaterThanOrEqual(1);
    expect(snap.recentSignals.length).toBeGreaterThanOrEqual(1);
  });

  it('async listener errors are caught', async () => {
    const { emitSignal, onSignal } = await import('./signalBus');
    onSignal('gonogo.no-go', async () => { throw new Error('boom'); });

    // Should not throw
    const ok = emitSignal('gonogo.no-go', 'test', 'g1', { decision: 'no-go', failedChecks: ['a'], failedCount: 1 });
    expect(ok).toBe(true);
  });
});

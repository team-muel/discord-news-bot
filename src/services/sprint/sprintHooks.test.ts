import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerHook,
  unregisterHook,
  clearAllHooks,
  executeHooks,
  hookCount,
  type HookPayload,
} from './sprintHooks';

const basePayload: HookPayload = {
  hookPoint: 'PhaseStart',
  sprintId: 'test-sprint-1',
  phase: 'plan',
};

beforeEach(() => {
  clearAllHooks();
});

describe('registerHook / unregisterHook', () => {
  it('registers and unregisters a hook', () => {
    const id = registerHook('PhaseStart', async () => ({}));
    expect(hookCount('PhaseStart')).toBe(1);
    expect(unregisterHook(id)).toBe(true);
    expect(hookCount('PhaseStart')).toBe(0);
  });

  it('unregister returns false for unknown id', () => {
    expect(unregisterHook('nonexistent')).toBe(false);
  });

  it('clearAllHooks removes everything', () => {
    registerHook('SprintStart', async () => ({}));
    registerHook('SprintComplete', async () => ({}));
    expect(hookCount()).toBe(2);
    clearAllHooks();
    expect(hookCount()).toBe(0);
  });
});

describe('executeHooks', () => {
  it('returns empty result when no hooks registered', async () => {
    const result = await executeHooks(basePayload);
    expect(result.cancel).toBeUndefined();
    expect(result.context).toBeUndefined();
  });

  it('collects context from all handlers', async () => {
    registerHook('PhaseStart', async () => ({ context: 'hint-A' }));
    registerHook('PhaseStart', async () => ({ context: 'hint-B' }));

    const result = await executeHooks(basePayload);
    expect(result.context).toContain('hint-A');
    expect(result.context).toContain('hint-B');
    expect(result.cancel).toBeUndefined();
  });

  it('ANY cancel = true → combined cancel is true', async () => {
    registerHook('PhaseStart', async () => ({}));
    registerHook('PhaseStart', async () => ({ cancel: true, cancelReason: 'blocked' }));

    const result = await executeHooks(basePayload);
    expect(result.cancel).toBe(true);
    expect(result.cancelReason).toBe('blocked');
  });

  it('only runs hooks matching the hook point', async () => {
    let called = false;
    registerHook('SprintComplete', async () => { called = true; return {}; });
    registerHook('PhaseStart', async () => ({ context: 'matched' }));

    const result = await executeHooks(basePayload);
    expect(result.context).toBe('matched');
    expect(called).toBe(false);
  });

  it('fail-open: handler error does not block others', async () => {
    registerHook('PhaseStart', async () => { throw new Error('boom'); });
    registerHook('PhaseStart', async () => ({ context: 'survived' }));

    const result = await executeHooks(basePayload);
    expect(result.context).toBe('survived');
  });

  it('handles sync handlers', async () => {
    registerHook('ActionPreExec', () => ({ context: 'sync-context' }));

    const result = await executeHooks({
      hookPoint: 'ActionPreExec',
      sprintId: 'test',
      actionName: 'doStuff',
    });
    expect(result.context).toBe('sync-context');
  });

  it('truncates context exceeding 50KB', async () => {
    const bigContext = 'x'.repeat(60_000);
    registerHook('PhaseStart', async () => ({ context: bigContext }));

    const result = await executeHooks(basePayload);
    expect(result.context!.length).toBeLessThanOrEqual(50 * 1024 + 30);
    expect(result.context).toContain('[hook context truncated]');
  });
});

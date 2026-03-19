import { describe, expect, it, vi } from 'vitest';

import { ensureSessionBudget, getErrorMessage, withTimeout } from './runtimeBudget';

describe('runtimeBudget', () => {
  it('withTimeout은 시간 초과 시 지정한 코드로 실패한다', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(new Promise<string>(() => {}), 50, 'TIMEOUT_CODE');
    const expectation = expect(promise).rejects.toThrow('TIMEOUT_CODE');

    await vi.advanceTimersByTimeAsync(51);
    await expectation;

    vi.useRealTimers();
  });

  it('ensureSessionBudget는 제한 시간을 넘기면 SESSION_TIMEOUT을 던진다', () => {
    const startedAt = Date.now() - 200;
    expect(() => ensureSessionBudget(startedAt, 100)).toThrow('SESSION_TIMEOUT');
  });

  it('getErrorMessage는 Error와 plain object를 문자열화한다', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage({ code: 'E1' })).toContain('E1');
  });
});
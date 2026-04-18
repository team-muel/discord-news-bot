import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiAgentRuntimeQueue } from './multiAgentRuntimeQueue';

type Session = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  status: string;
  cancelRequested: boolean;
  error: string | null;
};

describe('multiAgentRuntimeQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guild별 running count를 분리하고 다른 guild 세션은 동시에 실행한다', async () => {
    const queue = new MultiAgentRuntimeQueue<Session>();
    const sessions = new Map<string, Session>([
      ['a-1', { id: 'a-1', guildId: 'guild-a', requestedBy: 'u1', goal: 'a1', status: 'queued', cancelRequested: false, error: null }],
      ['a-2', { id: 'a-2', guildId: 'guild-a', requestedBy: 'u2', goal: 'a2', status: 'queued', cancelRequested: false, error: null }],
      ['b-1', { id: 'b-1', guildId: 'guild-b', requestedBy: 'u3', goal: 'b1', status: 'queued', cancelRequested: false, error: null }],
    ]);
    const starts: string[] = [];
    const completions = new Map<string, (status: string) => void>();

    for (const sessionId of sessions.keys()) {
      queue.enqueueSession(sessionId);
    }

    queue.scheduleDrain({
      pollMs: 10,
      maxAttempts: 1,
      maxDeadletters: 5,
      nowIso: () => '2026-04-18T00:00:00.000Z',
      getMaxConcurrent: (session) => (session.guildId === 'guild-a' ? 1 : 1),
      getSession: (sessionId) => sessions.get(sessionId),
      executeSession: (sessionId) => new Promise<string>((resolve) => {
        starts.push(sessionId);
        completions.set(sessionId, resolve);
      }),
      markCancelled: () => {},
      requeueForRetry: () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(starts).toEqual(['a-1', 'b-1']);
    expect(queue.getRunningCount()).toBe(2);
    expect(queue.getRunningCount('guild-a')).toBe(1);
    expect(queue.getRunningCount('guild-b')).toBe(1);

    completions.get('a-1')?.('completed');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);

    expect(starts).toEqual(['a-1', 'b-1', 'a-2']);
    expect(queue.getRunningCount('guild-a')).toBe(1);
  });
});
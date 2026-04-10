import { describe, expect, it } from 'vitest';

import type { AgentSession } from '../../multiAgentService';
import { cancelAllPendingSteps, cloneSession, ensureShadowGraph, touch, traceShadowNode, appendShadowOutcomes } from './runtimeSessionState';

const buildSession = (): AgentSession => ({
  id: 'session-1',
  guildId: 'guild-1',
  requestedBy: 'user-1',
  goal: '목표',
  conversationThreadId: null,
  conversationTurnIndex: null,
  priority: 'balanced',
  requestedSkillId: null,
  routedIntent: 'task',
  status: 'queued',
  createdAt: '2026-03-20T00:00:00.000Z',
  updatedAt: '2026-03-20T00:00:00.000Z',
  startedAt: null,
  endedAt: null,
  result: null,
  error: null,
  cancelRequested: false,
  memoryHints: [],
  steps: [
    {
      id: 'step-1',
      role: 'planner',
      title: '계획',
      status: 'pending',
      startedAt: null,
      endedAt: null,
      output: null,
      error: null,
    },
  ],
  shadowGraph: null,
});

describe('runtimeSessionState', () => {
  it('cancelAllPendingSteps는 pending step을 cancelled로 바꾼다', () => {
    const session = buildSession();
    cancelAllPendingSteps(session, '2026-03-20T00:01:00.000Z');

    expect(session.steps[0].status).toBe('cancelled');
    expect(session.steps[0].endedAt).toBe('2026-03-20T00:01:00.000Z');
  });

  it('ensureShadowGraph와 traceShadowNode는 trace를 누적한다', () => {
    const session = buildSession();
    expect(ensureShadowGraph(session).trace).toHaveLength(0);

    traceShadowNode(session, 'compose_response', 'unit-test');
    expect(session.shadowGraph?.trace).toHaveLength(1);
    expect(session.shadowGraph?.trace[0].node).toBe('compose_response');
  });

  it('cloneSession은 깊은 복사본을 반환하고 touch는 updatedAt을 갱신한다', () => {
    const session = buildSession();
    const cloned = cloneSession(session);
    cloned.steps[0].status = 'completed';

    expect(session.steps[0].status).toBe('pending');
    touch(session);
    expect(session.updatedAt).not.toBe('2026-03-20T00:00:00.000Z');
  });

  it('appendShadowOutcomes는 reflection metadata를 포함한 outcome을 누적하고 깊은 복사한다', () => {
    const session = buildSession();
    const reasons = ['policy block'];
    const outcomes = [{
      state: 'failure' as const,
      code: 'ACTION_NOT_ALLOWED',
      summary: '정책 차단',
      retryable: false,
      confidence: 'low' as const,
      reasons,
      reflection: {
        type: 'obsidian_reflection' as const,
        plane: 'record',
        concern: 'guild-memory',
        nextPath: 'guilds/123/Guild_Lore.md',
        customerImpact: false,
      },
    }];

    appendShadowOutcomes(session, outcomes);
    reasons[0] = 'mutated';

    expect(session.shadowGraph?.outcomes).toHaveLength(1);
    expect(session.shadowGraph?.outcomes[0]).toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
      reflection: {
        concern: 'guild-memory',
        nextPath: 'guilds/123/Guild_Lore.md',
      },
    });
    expect(session.shadowGraph?.outcomes[0].reasons).toEqual(['policy block']);
  });
});
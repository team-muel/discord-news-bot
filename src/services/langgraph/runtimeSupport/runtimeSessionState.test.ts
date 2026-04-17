import { describe, expect, it, vi } from 'vitest';

import type { AgentSession } from '../../multiAgentTypes';
import { createInitialLangGraphState } from '../stateContract';
import {
  appendShadowOutcomes,
  cancelAllPendingSteps,
  clearSessionCheckpoint,
  cloneSession,
  ensureShadowGraph,
  isResumableLangGraphSession,
  pauseSessionForHitl,
  prepareSessionForResume,
  persistSessionCheckpoint,
  resetSessionForRetry,
  touch,
  traceShadowNode,
} from './runtimeSessionState';

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

  it('persistSessionCheckpoint와 clearSessionCheckpoint는 resumable checkpoint를 관리한다', () => {
    const session = buildSession();
    const persistSession = vi.fn();
    const state = ensureShadowGraph(session);

    persistSessionCheckpoint({
      session,
      currentNode: 'compose_response',
      nextNode: 'persist_and_emit',
      state,
      reason: 'transition',
      savedAt: '2026-03-20T00:02:00.000Z',
      persistSession,
    });

    expect(session.graphCheckpoint).toMatchObject({
      currentNode: 'compose_response',
      nextNode: 'persist_and_emit',
      resumable: true,
      reason: 'transition',
    });
    expect(isResumableLangGraphSession({ ...session, executionEngine: 'langgraphjs' })).toBe(true);
    expect(persistSession).toHaveBeenCalledWith(session);

    clearSessionCheckpoint(session);
    expect(session.graphCheckpoint).toBeNull();
  });

  it('pauseSessionForHitl는 hitl state를 설정하고 checkpoint를 저장한다', () => {
    const session = { ...buildSession(), executionEngine: 'langgraphjs' as const };
    const persistCheckpoint = vi.fn();

    pauseSessionForHitl({
      session,
      gateNode: 'hitl_review',
      prompt: 'review prompt',
      requestedAt: '2026-03-20T00:03:00.000Z',
      persistCheckpoint,
    });

    expect(session.status).toBe('queued');
    expect(session.hitlState).toMatchObject({
      awaitingInput: true,
      gateNode: 'hitl_review',
      prompt: 'review prompt',
      requestedAt: '2026-03-20T00:03:00.000Z',
    });
    expect(persistCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      currentNode: 'hitl_review',
      nextNode: 'hitl_review',
      reason: 'hitl_pause',
    }));
  });

  it('resetSessionForRetry는 retry queue 기본 상태를 복원한다', () => {
    const session = {
      ...buildSession(),
      status: 'failed' as const,
      startedAt: '2026-03-20T00:00:10.000Z',
      endedAt: '2026-03-20T00:01:00.000Z',
      result: 'old-result',
      error: 'old-error',
      cancelRequested: true,
      trafficRoute: 'shadow' as const,
      trafficRoutingDecision: {
        route: 'shadow' as const,
        reason: 'test_route:shadow',
        gotCutoverAllowed: true,
        rolloutPercentage: 10,
        stableBucket: 1,
        shadowDivergenceRate: 0.1,
        shadowQualityDelta: 0.1,
        readinessRecommended: false,
        policySnapshot: {
          trafficRoutingMode: 'shadow',
        },
      },
      trafficRouteResolvedAt: '2026-03-20T00:00:30.000Z',
      executionEngine: 'langgraphjs' as const,
      graphCheckpoint: {
        currentNode: 'compose_response' as const,
        nextNode: 'persist_and_emit' as const,
        savedAt: '2026-03-20T00:00:30.000Z',
        reason: 'transition' as const,
        resumable: true,
        state: createInitialLangGraphState({
          sessionId: 'session-1',
          guildId: 'guild-1',
          requestedBy: 'user-1',
          priority: 'balanced',
          goal: '목표',
        }),
      },
      hitlState: {
        awaitingInput: true,
        gateNode: 'hitl_review' as const,
        prompt: 'review',
        requestedAt: '2026-03-20T00:00:40.000Z',
        resumedAt: null,
        decision: null,
        note: null,
      },
      deliberationMode: 'guarded' as const,
      riskScore: 99,
      policyGate: {
        decision: 'review' as const,
        reasons: ['old'],
      },
      shadowGraph: createInitialLangGraphState({
        sessionId: 'session-1',
        guildId: 'guild-1',
        requestedBy: 'user-1',
        priority: 'balanced',
        goal: '목표',
      }),
    };

    resetSessionForRetry({
      session,
      deliberationMode: 'direct',
      buildInitialSteps: () => [{
        id: 'retry-step-1',
        role: 'planner',
        title: 'Retry',
        status: 'pending',
        startedAt: null,
        endedAt: null,
        output: null,
        error: null,
      }],
      timestamp: '2026-03-20T00:02:00.000Z',
    });

    expect(session).toMatchObject({
      status: 'queued',
      startedAt: null,
      endedAt: null,
      result: null,
      error: 'old-error',
      cancelRequested: false,
      trafficRoute: 'main',
      trafficRoutingDecision: null,
      trafficRouteResolvedAt: null,
      executionEngine: 'main',
      graphCheckpoint: null,
      hitlState: null,
      deliberationMode: 'direct',
      riskScore: 0,
      policyGate: {
        decision: 'allow',
        reasons: ['legacy_default'],
      },
      shadowGraph: null,
    });
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].id).toBe('retry-step-1');
  });

  it('prepareSessionForResume는 hitl 입력을 닫고 queue 재개 상태를 준비한다', () => {
    const session = {
      ...buildSession(),
      status: 'failed' as const,
      result: 'old-result',
      error: 'old-error',
      hitlState: {
        awaitingInput: true,
        gateNode: 'hitl_review' as const,
        prompt: 'review',
        requestedAt: '2026-03-20T00:00:40.000Z',
        resumedAt: null,
        decision: null,
        note: null,
      },
    };

    prepareSessionForResume({
      session,
      decision: 'revise',
      note: '  add more detail  ',
      resumedAt: '2026-03-20T00:04:00.000Z',
    });

    expect(session.status).toBe('queued');
    expect(session.result).toBeNull();
    expect(session.error).toBeNull();
    expect(session.hitlState).toMatchObject({
      awaitingInput: false,
      decision: 'revise',
      note: 'add more detail',
      resumedAt: '2026-03-20T00:04:00.000Z',
    });
  });
});
import { describe, expect, it, vi } from 'vitest';

import type { AgentSession } from '../../multiAgentTypes';
import type { ShadowRunResult } from '../shadowGraphRunner';
import { createInitialLangGraphState } from '../stateContract';
import {
  applyLangGraphPrimaryFallback,
  buildLangGraphPrimaryFallbackDecision,
  isTerminalStatus,
  markSessionTerminal,
  resolveTerminalSessionFailure,
} from './runtimeTerminal';

const buildSession = (overrides?: Partial<AgentSession>): AgentSession => ({
  id: overrides?.id || 'session-1',
  guildId: overrides?.guildId || 'guild-1',
  requestedBy: overrides?.requestedBy || 'user-1',
  goal: overrides?.goal || 'trim executeSession coupling',
  requestedSkillId: overrides?.requestedSkillId || null,
  routedIntent: overrides?.routedIntent || 'task',
  priority: overrides?.priority || 'balanced',
  status: overrides?.status || 'running',
  createdAt: overrides?.createdAt || '2026-04-16T00:00:00.000Z',
  updatedAt: overrides?.updatedAt || '2026-04-16T00:00:00.000Z',
  startedAt: overrides?.startedAt || '2026-04-16T00:00:01.000Z',
  endedAt: overrides?.endedAt || null,
  result: overrides?.result || null,
  error: overrides?.error || null,
  memoryHints: overrides?.memoryHints || ['hint-1'],
  steps: overrides?.steps || [],
  shadowGraph: overrides?.shadowGraph || createInitialLangGraphState({
    sessionId: overrides?.id || 'session-1',
    guildId: overrides?.guildId || 'guild-1',
    requestedBy: overrides?.requestedBy || 'user-1',
    priority: overrides?.priority || 'balanced',
    goal: overrides?.goal || 'trim executeSession coupling',
  }),
  graphCheckpoint: overrides?.graphCheckpoint || null,
  cancelRequested: overrides?.cancelRequested || false,
  executionEngine: overrides?.executionEngine || 'langgraphjs',
  hitlState: overrides?.hitlState || null,
  conversationThreadId: overrides?.conversationThreadId || null,
  conversationTurnIndex: overrides?.conversationTurnIndex || null,
  trafficRoutingDecision: overrides?.trafficRoutingDecision || {
    route: 'langgraph',
    reason: 'test_route:langgraph',
    gotCutoverAllowed: true,
    rolloutPercentage: 100,
    stableBucket: 42,
    shadowDivergenceRate: 0.05,
    shadowQualityDelta: 0.1,
    readinessRecommended: true,
    policySnapshot: {
      trafficRoutingMode: 'langgraph',
    },
  },
  personalization: overrides?.personalization || undefined,
  intentClassification: overrides?.intentClassification || null,
} as AgentSession);

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const buildShadowRunResult = (): ShadowRunResult => ({
  shadowState: createInitialLangGraphState({
    sessionId: 'session-1',
    guildId: 'guild-1',
    requestedBy: 'user-1',
    priority: 'balanced',
    goal: 'trim executeSession coupling',
  }),
  visitedNodes: ['compose_response'],
  divergeAtIndex: null,
  mainPathNodes: ['compose_response'],
  elapsedMs: 12,
  error: null,
});

describe('runtimeTerminal', () => {
  it('isTerminalStatus only marks completed, failed, and cancelled sessions as terminal', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('buildLangGraphPrimaryFallbackDecision preserves prior decision metadata while forcing main route', () => {
    const decision = buildLangGraphPrimaryFallbackDecision({
      route: 'langgraph',
      reason: 'test_route:langgraph',
      gotCutoverAllowed: true,
      rolloutPercentage: 100,
      stableBucket: 42,
      shadowDivergenceRate: 0.05,
      shadowQualityDelta: 0.1,
      readinessRecommended: true,
      policySnapshot: {
        trafficRoutingMode: 'langgraph',
      },
    }, 'LANGGRAPH_UNAVAILABLE');

    expect(decision).toMatchObject({
      route: 'main',
      reason: 'langgraph_primary_fallback:LANGGRAPH_UNAVAILABLE',
      policySnapshot: {
        trafficRoutingMode: 'langgraph',
        requestedRoute: 'langgraph',
        fallbackError: 'LANGGRAPH_UNAVAILABLE',
      },
    });
  });

  it('applyLangGraphPrimaryFallback clears shadow state and persists the routed session', () => {
    const session = buildSession();
    const touchMock = vi.fn();
    const persistSessionMock = vi.fn();
    const applyTrafficRoutingDecisionToSessionMock = vi.fn((target: AgentSession, decision) => {
      target.trafficRoutingDecision = decision;
      target.trafficRoute = decision?.route || 'main';
      target.executionEngine = decision?.route === 'langgraph' ? 'langgraphjs' : 'main';
    });

    applyLangGraphPrimaryFallback({
      session,
      errorMessage: 'LANGGRAPH_UNAVAILABLE',
      applyTrafficRoutingDecisionToSession: applyTrafficRoutingDecisionToSessionMock,
      touch: touchMock,
      persistSession: persistSessionMock,
    });

    expect(applyTrafficRoutingDecisionToSessionMock).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        route: 'main',
        reason: 'langgraph_primary_fallback:LANGGRAPH_UNAVAILABLE',
      }),
    );
    expect(session.shadowGraph).toBeNull();
    expect(session.memoryHints).toEqual([]);
    expect(touchMock).toHaveBeenCalledWith(session);
    expect(persistSessionMock).toHaveBeenCalledWith(session);
  });

  it('markSessionTerminal persists terminal state and clears heavy session data', async () => {
    const session = buildSession({
      graphCheckpoint: {
        currentNode: 'compose_response',
        nextNode: 'compose_response',
        savedAt: '2026-04-16T00:00:00.000Z',
        reason: 'transition',
        resumable: true,
        state: createInitialLangGraphState({
          sessionId: 'session-1',
          guildId: 'guild-1',
          requestedBy: 'user-1',
          priority: 'balanced',
          goal: 'trim executeSession coupling',
        }),
      },
      steps: [
        {
          id: 'step-1',
          role: 'planner',
          title: 'Plan',
          status: 'completed',
          startedAt: '2026-04-16T00:00:00.000Z',
          endedAt: '2026-04-16T00:00:01.000Z',
          output: 'step-output',
          error: null,
        },
      ],
    });
    const persistSessionMock = vi.fn();
    const persistTrafficRoutingDecisionMock = vi.fn();
    const recordComplexityMetricMock = vi.fn();
    const recordSessionOutcomeMock = vi.fn();
    const precipitateSessionToMemoryMock = vi.fn(() => Promise.resolve());
    const attributeAndPersistIntentOutcomeMock = vi.fn(() => Promise.resolve());
    const bindSessionAssistantTurnMock = vi.fn(() => Promise.resolve(null));
    const runLangGraphExecutorShadowReplayMock = vi.fn();
    const runShadowGraphMock = vi.fn(() => Promise.resolve(buildShadowRunResult()));

    markSessionTerminal({
      session,
      status: 'completed',
      patch: { result: 'final answer' },
      deps: {
        langGraphNodeIds: ['compose_response'],
        ensureShadowGraph: (target) => target.shadowGraph!,
        runPersistAndEmitNode: vi.fn(() => ({
          shadowGraph: session.shadowGraph!,
          assistantPayload: null,
        })),
        nowIso: () => '2026-04-16T00:01:00.000Z',
        clearSessionCheckpoint: (target) => {
          target.graphCheckpoint = null;
        },
        touch: (target) => {
          target.updatedAt = '2026-04-16T00:01:00.000Z';
        },
        persistSession: persistSessionMock,
        persistTrafficRoutingDecision: persistTrafficRoutingDecisionMock,
        recordComplexityMetric: recordComplexityMetricMock,
        recordSessionOutcome: recordSessionOutcomeMock,
        precipitateSessionToMemory: precipitateSessionToMemoryMock,
        attributeAndPersistIntentOutcome: attributeAndPersistIntentOutcomeMock,
        logIntentAttributionFailure: vi.fn(),
        bindSessionAssistantTurn: bindSessionAssistantTurnMock,
        getSession: () => session,
        getSessionExecutionEngine: () => 'langgraphjs',
        runLangGraphExecutorShadowReplay: runLangGraphExecutorShadowReplayMock,
        isShadowRunnerEnabled: () => false,
        runShadowGraph: runShadowGraphMock,
        loadMemoryHints: vi.fn(() => Promise.resolve([])),
        persistShadowDivergence: vi.fn(),
        isShadowResultPromotable: vi.fn(() => ({ promotable: false, reason: 'n/a' })),
        logShadowPromotable: vi.fn(),
        logShadowNotPromotable: vi.fn(),
      },
    });

    await flushMicrotasks();

    expect(session.status).toBe('completed');
    expect(session.endedAt).toBe('2026-04-16T00:01:00.000Z');
    expect(session.result).toBe('final answer');
    expect(session.graphCheckpoint).toBeNull();
    expect(session.shadowGraph).toBeNull();
    expect(session.steps[0].output).toBeNull();
    expect(persistSessionMock).toHaveBeenCalledWith(session);
    expect(persistTrafficRoutingDecisionMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      guildId: 'guild-1',
      decision: expect.objectContaining({ route: 'langgraph' }),
    });
    expect(recordComplexityMetricMock).toHaveBeenCalledWith(session);
    expect(recordSessionOutcomeMock).toHaveBeenCalledWith(session, 'completed');
    expect(precipitateSessionToMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      status: 'completed',
      result: 'final answer',
    }));
    expect(attributeAndPersistIntentOutcomeMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      sessionStatus: 'completed',
    }));
    expect(runLangGraphExecutorShadowReplayMock).not.toHaveBeenCalled();
    expect(runShadowGraphMock).not.toHaveBeenCalled();
  });

  it('markSessionTerminal updates assistant turn metadata and triggers shadow follow-up paths for main engine sessions', async () => {
    const session = buildSession({
      executionEngine: 'main',
      trafficRoutingDecision: {
        route: 'shadow',
        reason: 'test_route:shadow',
        gotCutoverAllowed: true,
        rolloutPercentage: 10,
        stableBucket: 7,
        shadowDivergenceRate: 0.02,
        shadowQualityDelta: 0.1,
        readinessRecommended: false,
        policySnapshot: {
          trafficRoutingMode: 'shadow',
        },
      },
      shadowGraph: {
        ...createInitialLangGraphState({
          sessionId: 'session-1',
          guildId: 'guild-1',
          requestedBy: 'user-1',
          priority: 'balanced',
          goal: 'trim executeSession coupling',
        }),
        trace: [{
          node: 'compose_response',
          at: '2026-04-16T00:00:00.000Z',
        }],
      },
    });
    const persistSessionMock = vi.fn();
    const bindSessionAssistantTurnMock = vi.fn(() => Promise.resolve({ threadId: 123, turnIndex: 9 }));
    const runLangGraphExecutorShadowReplayMock = vi.fn();
    const runShadowGraphMock = vi.fn(() => Promise.resolve(buildShadowRunResult()));
    const persistShadowDivergenceMock = vi.fn();
    const logShadowPromotableMock = vi.fn();

    markSessionTerminal({
      session,
      status: 'failed',
      patch: { error: 'boom' },
      deps: {
        langGraphNodeIds: ['compose_response'],
        ensureShadowGraph: (target) => target.shadowGraph!,
        runPersistAndEmitNode: vi.fn(() => ({
          shadowGraph: session.shadowGraph!,
          assistantPayload: 'assistant response',
        })),
        nowIso: () => '2026-04-16T00:01:00.000Z',
        clearSessionCheckpoint: vi.fn(),
        touch: (target) => {
          target.updatedAt = '2026-04-16T00:01:00.000Z';
        },
        persistSession: persistSessionMock,
        persistTrafficRoutingDecision: vi.fn(),
        recordComplexityMetric: vi.fn(),
        recordSessionOutcome: vi.fn(),
        precipitateSessionToMemory: vi.fn(() => Promise.resolve()),
        attributeAndPersistIntentOutcome: vi.fn(() => Promise.resolve()),
        logIntentAttributionFailure: vi.fn(),
        bindSessionAssistantTurn: bindSessionAssistantTurnMock,
        getSession: () => session,
        getSessionExecutionEngine: () => 'main',
        runLangGraphExecutorShadowReplay: runLangGraphExecutorShadowReplayMock,
        isShadowRunnerEnabled: () => true,
        runShadowGraph: runShadowGraphMock,
        loadMemoryHints: vi.fn(() => Promise.resolve(['hint-1'])),
        persistShadowDivergence: persistShadowDivergenceMock,
        isShadowResultPromotable: vi.fn(() => ({ promotable: true, reason: 'promote-shadow' })),
        logShadowPromotable: logShadowPromotableMock,
        logShadowNotPromotable: vi.fn(),
      },
    });

    await flushMicrotasks();

    expect(bindSessionAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      content: 'assistant response',
      status: 'failed',
      error: 'boom',
    }));
    expect(session.conversationThreadId).toBe(123);
    expect(session.conversationTurnIndex).toBe(9);
    expect(runLangGraphExecutorShadowReplayMock).toHaveBeenCalledWith(session, 'failed');
    expect(runShadowGraphMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      mainPathNodes: ['compose_response'],
    }));
    expect(persistShadowDivergenceMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      mainFinalStatus: 'failed',
    }));
    expect(logShadowPromotableMock).toHaveBeenCalledWith('session-1', 'shadow', 'promote-shadow');
    expect(persistSessionMock).toHaveBeenCalledTimes(2);
  });

  it('resolveTerminalSessionFailure maps timeout and network failures to user-safe messages', () => {
    expect(resolveTerminalSessionFailure({
      rawErrorMessage: 'SESSION_TIMEOUT',
      cancelRequested: false,
    })).toEqual({
      status: 'failed',
      error: '처리 시간이 길어져 세션을 종료했습니다. 요청 범위를 줄여 다시 시도해주세요.',
    });

    expect(resolveTerminalSessionFailure({
      rawErrorMessage: 'fetch failed: socket hang up',
      cancelRequested: false,
    })).toEqual({
      status: 'failed',
      error: 'AI 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    });
  });

  it('resolveTerminalSessionFailure preserves cancellation and step-timeout semantics', () => {
    expect(resolveTerminalSessionFailure({
      rawErrorMessage: 'ignored',
      cancelRequested: true,
    })).toEqual({
      status: 'cancelled',
      error: '사용자 요청으로 중지되었습니다.',
    });

    expect(resolveTerminalSessionFailure({
      rawErrorMessage: 'STEP_TIMEOUT:planner',
      cancelRequested: false,
    })).toEqual({
      status: 'failed',
      error: '단계 처리 시간이 초과되었습니다(planner). 잠시 후 다시 시도해주세요.',
    });
  });
});
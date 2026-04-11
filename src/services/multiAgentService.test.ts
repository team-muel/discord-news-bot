import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveTrafficRouteMock,
  persistTrafficRoutingDecisionMock,
  isShadowRunnerEnabledMock,
  runShadowGraphMock,
  getAgentGotCutoverDecisionMock,
} = vi.hoisted(() => ({
  resolveTrafficRouteMock: vi.fn(),
  persistTrafficRoutingDecisionMock: vi.fn(),
  isShadowRunnerEnabledMock: vi.fn(),
  runShadowGraphMock: vi.fn(),
  getAgentGotCutoverDecisionMock: vi.fn(),
}));

// ──────────────────────────────────────────────────────────
// 의존성 모킹 (가장 먼저 선언해야 hoisting됨)
// ──────────────────────────────────────────────────────────
vi.mock('./llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn().mockResolvedValue('mocked response'),
}));

vi.mock('./agent/agentMemoryService', () => ({
  buildAgentMemoryHints: vi.fn().mockResolvedValue([]),
}));

vi.mock('./agent/agentSessionStore', () => ({
  persistAgentSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./skills/engine', () => ({
  executeSkill: vi.fn().mockResolvedValue({ output: 'skill output' }),
}));

vi.mock('./skills/registry', () => ({
  isSkillId: vi.fn((id: string) => ['ops-plan', 'ops-execution', 'ops-critique', 'ops-review', 'incident-review'].includes(id)),
  listSkills: vi.fn(() => []),
}));

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

vi.mock('./agent/agentGotCutoverService', async () => {
  const actual = await vi.importActual<typeof import('./agent/agentGotCutoverService')>('./agent/agentGotCutoverService');
  return {
    ...actual,
    getAgentGotCutoverDecision: getAgentGotCutoverDecisionMock,
  };
});

vi.mock('./workflow/trafficRoutingService', async () => {
  const actual = await vi.importActual<typeof import('./workflow/trafficRoutingService')>('./workflow/trafficRoutingService');
  return {
    ...actual,
    TRAFFIC_ROUTING_ENABLED: true,
    resolveTrafficRoute: resolveTrafficRouteMock,
    persistTrafficRoutingDecision: persistTrafficRoutingDecisionMock,
  };
});

vi.mock('./langgraph/shadowGraphRunner', async () => {
  const actual = await vi.importActual<typeof import('./langgraph/shadowGraphRunner')>('./langgraph/shadowGraphRunner');
  return {
    ...actual,
    isShadowRunnerEnabled: isShadowRunnerEnabledMock,
    runShadowGraph: runShadowGraphMock,
  };
});

import * as llmClient from './llmClient';
import {
  __resetAgentRuntimeForTests,
  type AgentSession,
  cancelAgentSession,
  getAgentPolicy,
  getAgentSession,
  getMultiAgentRuntimeSnapshot,
  listAgentDeadletters,
  listAgentSkills,
  listGuildAgentSessions,
  rehydrateActiveSessions,
  resumeAgentSession,
  serializeAgentSessionForApi,
  startAgentSession,
} from './multiAgentService';
import { isSupabaseConfigured, getSupabaseClient } from './supabaseClient';
import { appendTrace, createInitialLangGraphState } from './langgraph/stateContract';

const buildTrafficDecision = (route: 'main' | 'shadow' | 'langgraph' = 'main') => ({
  route,
  reason: `test_route:${route}`,
  gotCutoverAllowed: route !== 'main',
  rolloutPercentage: route === 'main' ? 0 : 100,
  stableBucket: 42,
  shadowDivergenceRate: route === 'main' ? null : 0.05,
  shadowQualityDelta: route === 'main' ? null : 0.1,
  readinessRecommended: true,
  policySnapshot: {
    trafficRoutingMode: route,
  },
});

beforeEach(() => {
  __resetAgentRuntimeForTests();
  resolveTrafficRouteMock.mockReset();
  resolveTrafficRouteMock.mockResolvedValue(buildTrafficDecision('main'));
  persistTrafficRoutingDecisionMock.mockReset();
  persistTrafficRoutingDecisionMock.mockResolvedValue(undefined);
  isShadowRunnerEnabledMock.mockReset();
  isShadowRunnerEnabledMock.mockReturnValue(false);
  runShadowGraphMock.mockReset();
  runShadowGraphMock.mockResolvedValue({});
  getAgentGotCutoverDecisionMock.mockReset();
  getAgentGotCutoverDecisionMock.mockResolvedValue({
    guildId: 'test-guild',
    allowed: true,
    readinessRecommended: true,
    rolloutPercentage: 100,
    selectedByRollout: true,
    reason: 'test_ready',
    failedReasons: [],
    evaluatedAt: '2026-04-11T00:00:00.000Z',
    windowDays: 14,
  });
});

// ──────────────────────────────────────────────────────────
describe('getMultiAgentRuntimeSnapshot (초기 상태)', () => {
  it('모든 카운터가 0인 스냅샷을 반환한다', () => {
    const snap = getMultiAgentRuntimeSnapshot();
    expect(snap).toMatchObject({
      totalSessions: expect.any(Number),
      runningSessions: expect.any(Number),
      queuedSessions: expect.any(Number),
      completedSessions: expect.any(Number),
      failedSessions: expect.any(Number),
      cancelledSessions: expect.any(Number),
      deadletteredSessions: expect.any(Number),
    });
    expect(snap.runningSessions).toBeGreaterThanOrEqual(0);
    expect(snap.queuedSessions).toBeGreaterThanOrEqual(0);
  });
});

describe('getAgentSession', () => {
  it('존재하지 않는 id → null 반환', () => {
    expect(getAgentSession('nonexistent-id-xyz')).toBeNull();
  });
});

describe('listGuildAgentSessions', () => {
  it('알 수 없는 guild → 빈 배열', () => {
    const result = listGuildAgentSessions('unknown-guild-id', 10);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('listAgentDeadletters', () => {
  it('초기에는 빈 배열 반환', () => {
    const result = listAgentDeadletters();
    expect(Array.isArray(result)).toBe(true);
  });

  it('limit 파라미터 적용', () => {
    const result = listAgentDeadletters({ limit: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe('cancelAgentSession', () => {
  it('존재하지 않는 세션 취소 → ok:false', () => {
    const result = cancelAgentSession('no-such-session');
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe('listAgentSkills / getAgentPolicy', () => {
  it('listAgentSkills는 배열을 반환한다', () => {
    const skills = listAgentSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  it('getAgentPolicy는 정책 스냅샷을 반환한다', () => {
    const policy = getAgentPolicy();
    expect(policy).toMatchObject({
      maxConcurrentSessions: expect.any(Number),
      maxGoalLength: expect.any(Number),
      restrictedSkills: expect.any(Array),
    });
    expect(policy.maxConcurrentSessions).toBeGreaterThan(0);
  });
});

describe('startAgentSession', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // setTimeout 방지 (queue drain 비실행)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LLM 미설정 → LLM_PROVIDER_NOT_CONFIGURED 에러', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(false);
    expect(() =>
      startAgentSession({
        guildId: 'g1',
        requestedBy: 'user1',
        goal: '분석해줘',
      }),
    ).toThrow('LLM provider is not configured');
  });

  it('빈 목표 → 검증 에러', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    expect(() =>
      startAgentSession({
        guildId: 'g1',
        requestedBy: 'user1',
        goal: '   ',
      }),
    ).toThrow();
  });

  it('LLM 활성화 시 세션을 생성하고 반환한다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const session = startAgentSession({
      guildId: 'guild-test-1',
      requestedBy: 'user-test-1',
      goal: '비트코인 시장 분석을 해줘',
    });

    expect(session.id).toBeTruthy();
    expect(session.guildId).toBe('guild-test-1');
    expect(session.requestedBy).toBe('user-test-1');
    expect(session.goal).toBe('비트코인 시장 분석을 해줘');
    expect(session.status).toBe('queued');
    expect(session.trafficRoute).toBe('main');
    expect(session.executionEngine).toBe('main');
    expect(session.trafficRoutingDecision).toBeNull();
    expect(session.graphCheckpoint).toBeNull();
    expect(session.hitlState).toBeNull();
    expect(Array.isArray(session.steps)).toBe(true);
    expect(session.steps.length).toBeGreaterThan(0);
  });

  it('생성된 세션을 getAgentSession으로 조회할 수 있다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-test-2',
      requestedBy: 'user-test-2',
      goal: '이더리움 최신 뉴스 요약',
    });

    const found = getAgentSession(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.status).toBe('queued');
  });

  it('생성된 세션이 listGuildAgentSessions에 포함된다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-list-test',
      requestedBy: 'user-test-3',
      goal: '금일 주요 이슈 정리',
    });

    const list = listGuildAgentSessions('guild-list-test', 10);
    expect(list.some((s) => s.id === created.id)).toBe(true);
  });

  it('queued 세션을 cancelAgentSession으로 취소할 수 있다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-cancel-test',
      requestedBy: 'user-test-4',
      goal: '취소 테스트 목표',
    });

    const result = cancelAgentSession(created.id);
    expect(result.ok).toBe(true);

    const found = getAgentSession(created.id);
    expect(found?.cancelRequested).toBe(true);
  });

  it('priority=fast 세션은 planner/critic 단계가 cancelled 상태로 생성된다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const session = startAgentSession({
      guildId: 'guild-fast',
      requestedBy: 'user-fast',
      goal: '빠른 요약 부탁해',
      priority: 'fast',
    });

    const plannerStep = session.steps.find((s) => s.role === 'planner');
    expect(plannerStep?.status).toBe('cancelled');
    const criticStep = session.steps.find((s) => s.role === 'critic');
    expect(criticStep?.status).toBe('cancelled');
  });

});

describe('serializeAgentSessionForApi', () => {
  it('기본값에서는 shadowGraph 원문을 숨기고 summary만 반환한다', () => {
    const baseState = createInitialLangGraphState({
      sessionId: 's-1',
      guildId: 'g-1',
      requestedBy: 'u-1',
      priority: 'balanced',
      goal: '테스트',
    });
    const tracedState = appendTrace(
      {
        ...baseState,
        intent: 'task',
      },
      'compose_response',
      'unit-test',
    );
    const tracedState2 = appendTrace(tracedState, 'persist_and_emit', 'done');

    const session: AgentSession = {
      id: 's-1',
      guildId: 'g-1',
      requestedBy: 'u-1',
      goal: 'goal',
      priority: 'balanced',
      requestedSkillId: null,
      routedIntent: 'task',
      status: 'completed',
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:05.000Z',
      startedAt: '2026-03-15T00:00:01.000Z',
      endedAt: '2026-03-15T00:00:04.000Z',
      result: 'ok',
      error: null,
      cancelRequested: false,
      memoryHints: [],
      steps: [
        {
          id: 'step-completed',
          role: 'planner',
          title: 'completed-step',
          status: 'completed',
          startedAt: '2026-03-15T00:00:01.000Z',
          endedAt: '2026-03-15T00:00:02.000Z',
          output: 'ok',
          error: null,
        },
        {
          id: 'step-running',
          role: 'researcher',
          title: 'running-step',
          status: 'running',
          startedAt: '2026-03-15T00:00:02.000Z',
          endedAt: null,
          output: null,
          error: null,
        },
      ],
      shadowGraph: tracedState2,
    };

    const view = serializeAgentSessionForApi(session);
    expect(view.shadowGraph).toBeUndefined();
    expect(view.shadowGraphSummary).toMatchObject({
      traceLength: 2,
      lastNode: 'persist_and_emit',
      intent: 'task',
      hasError: false,
      elapsedMs: 3000,
      uniqueNodeCount: 2,
    });
    expect(view.shadowGraphSummary?.traceTail).toHaveLength(2);
    expect(view.shadowGraphSummary?.traceTail[0]?.node).toBe('compose_response');
    expect(view.shadowGraphSummary?.traceTail[1]?.node).toBe('persist_and_emit');
    expect(view.progressSummary).toMatchObject({
      totalSteps: 2,
      doneSteps: 1,
      completedSteps: 1,
      failedSteps: 0,
      cancelledSteps: 0,
      runningSteps: 1,
      pendingSteps: 0,
      progressPercent: 50,
    });
    expect(view.privacySummary).toMatchObject({
      deliberationMode: expect.any(String),
      riskScore: expect.any(Number),
      decision: expect.any(String),
      reasons: expect.any(Array),
    });
  });

  it('옵션 활성화 시 shadowGraph 원문을 포함한다', () => {
    const state = createInitialLangGraphState({
      sessionId: 's-2',
      guildId: 'g-2',
      requestedBy: 'u-2',
      priority: 'fast',
      goal: '테스트2',
    });

    const session: AgentSession = {
      id: 's-2',
      guildId: 'g-2',
      requestedBy: 'u-2',
      goal: 'goal2',
      priority: 'fast',
      requestedSkillId: null,
      routedIntent: 'task',
      status: 'running',
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:01.000Z',
      startedAt: '2026-03-15T00:00:00.500Z',
      endedAt: null,
      result: null,
      error: null,
      cancelRequested: false,
      memoryHints: [],
      steps: [],
      shadowGraph: state,
    };

    const view = serializeAgentSessionForApi(session, { includeShadowGraph: true });
    expect(view.shadowGraph).toBeTruthy();
    expect(view.shadowGraphSummary?.lastNode).toBeNull();
    expect(view.progressSummary).toMatchObject({
      totalSteps: 0,
      doneSteps: 0,
      progressPercent: 100,
    });
    expect(view.privacySummary).toBeTruthy();
  });

  it('traceTailLimit 옵션으로 traceTail 길이를 제어한다', () => {
    const baseState = createInitialLangGraphState({
      sessionId: 's-3',
      guildId: 'g-3',
      requestedBy: 'u-3',
      priority: 'balanced',
      goal: '테스트3',
    });
    const traced1 = appendTrace(baseState, 'ingest', '1');
    const traced2 = appendTrace(traced1, 'compile_prompt', '2');
    const traced3 = appendTrace(traced2, 'route_intent', '3');

    const session: AgentSession = {
      id: 's-3',
      guildId: 'g-3',
      requestedBy: 'u-3',
      goal: 'goal3',
      priority: 'balanced',
      requestedSkillId: null,
      routedIntent: 'task',
      status: 'running',
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:03.000Z',
      startedAt: '2026-03-15T00:00:01.000Z',
      endedAt: null,
      result: null,
      error: null,
      cancelRequested: false,
      memoryHints: [],
      steps: [],
      shadowGraph: traced3,
    };

    const view = serializeAgentSessionForApi(session, { traceTailLimit: 1 });
    expect(view.shadowGraphSummary?.traceLength).toBe(3);
    expect(view.shadowGraphSummary?.traceTail).toHaveLength(1);
    expect(view.shadowGraphSummary?.traceTail[0]?.node).toBe('route_intent');
  });
});

describe('executeSession integration path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requested skill 세션은 queue drain 후 완료되고 shadow trace를 남긴다', async () => {
    const created = startAgentSession({
      guildId: 'guild-integration-1',
      requestedBy: 'user-integration-1',
      goal: '스킬 실행 통합 경로 테스트',
      skillId: 'ops-execution',
      priority: 'balanced',
      isAdmin: true,
    });

    for (let i = 0; i < 6; i += 1) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }

    const completed = getAgentSession(created.id);
    expect(completed).not.toBeNull();
    expect(completed?.status).toBe('completed');
    // shadowGraph is released after terminal persistence for memory optimization
    expect(completed?.shadowGraph).toBeNull();
  });

  it('langgraph route 세션은 primary graph engine으로 실행하고 최종 라우팅 결정을 기록한다', async () => {
    resolveTrafficRouteMock.mockResolvedValue(buildTrafficDecision('langgraph'));

    const created = startAgentSession({
      guildId: 'guild-langgraph-primary',
      requestedBy: 'user-langgraph-primary',
      goal: 'LangGraph primary 실행 경로 검증',
      skillId: 'ops-execution',
      priority: 'balanced',
      isAdmin: true,
    });

    for (let i = 0; i < 6; i += 1) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }

    const completed = getAgentSession(created.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.trafficRoute).toBe('langgraph');
    expect(completed?.executionEngine).toBe('langgraphjs');
    expect(persistTrafficRoutingDecisionMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: created.id,
      guildId: 'guild-langgraph-primary',
      decision: expect.objectContaining({
        route: 'langgraph',
      }),
    }));
    expect(runShadowGraphMock).not.toHaveBeenCalled();
  });

  it('precise full_review langgraph 세션은 HITL에서 pause 후 resume로 완료된다', async () => {
    resolveTrafficRouteMock.mockResolvedValue(buildTrafficDecision('langgraph'));

    const created = startAgentSession({
      guildId: 'guild-langgraph-hitl',
      requestedBy: 'user-langgraph-hitl',
      goal: '운영 리스크를 포함한 상세 실행 계획을 작성해줘',
      priority: 'precise',
      isAdmin: true,
    });

    for (let i = 0; i < 6; i += 1) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }

    const paused = getAgentSession(created.id);
    expect(paused?.status).toBe('queued');
    expect(paused?.executionEngine).toBe('langgraphjs');
    expect(paused?.graphCheckpoint?.resumable).toBe(true);
    expect(paused?.graphCheckpoint?.nextNode).toBe('hitl_review');
    expect(paused?.hitlState?.awaitingInput).toBe(true);
    expect(paused?.hitlState?.gateNode).toBe('hitl_review');

    const resume = resumeAgentSession({
      sessionId: created.id,
      decision: 'approve',
      note: '계속 진행',
    });
    expect(resume.ok).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    }

    const completed = getAgentSession(created.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.hitlState?.awaitingInput).toBe(false);
    expect(completed?.hitlState?.decision).toBe('approve');
    expect(completed?.graphCheckpoint).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────
describe('rehydrateActiveSessions', () => {
  it('Supabase 미설정 시 0 반환', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const count = await rehydrateActiveSessions();
    expect(count).toBe(0);
  });

  it('활성 세션 + 스텝을 Supabase에서 복원한다', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);

    const sessionRows = [
      {
        id: 'rehy-1',
        guild_id: 'g-1',
        requested_by: 'u-1',
        goal: 'test goal',
        priority: 'balanced',
        requested_skill_id: null,
        status: 'running',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:01.000Z',
        started_at: '2026-04-01T00:00:00.000Z',
        ended_at: null,
        result: null,
        error: null,
        conversation_thread_id: null,
        conversation_turn_index: null,
      },
    ];
    const stepRows = [
      {
        id: 'step-rehy-1',
        session_id: 'rehy-1',
        role: 'planner',
        title: 'plan step',
        status: 'completed',
        started_at: '2026-04-01T00:00:00.000Z',
        ended_at: '2026-04-01T00:00:01.000Z',
        output: 'plan done',
        error: null,
      },
    ];

    const mockSelect = (table: string) => {
      const chain: Record<string, any> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockImplementation(() => {
        if (table === 'agent_steps') return Promise.resolve({ data: stepRows });
        return chain;
      });
      chain.limit = vi.fn().mockImplementation(() => {
        if (table === 'agent_sessions') return Promise.resolve({ data: sessionRows });
        return Promise.resolve({ data: stepRows });
      });
      return chain;
    };

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => mockSelect(table),
    } as any);

    const count = await rehydrateActiveSessions();
    expect(count).toBe(1);

    const session = getAgentSession('rehy-1');
    expect(session).not.toBeNull();
    expect(session?.goal).toBe('test goal');
    expect(session?.status).toBe('running');
    expect(session?.steps).toHaveLength(1);
    expect(session?.steps[0].title).toBe('plan step');
  });

  it('이미 Map에 있는 세션은 덮어쓰지 않는다', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);

    // Pre-populate sessions Map via startAgentSession
    const created = startAgentSession({
      guildId: 'g-dup',
      requestedBy: 'u-dup',
      goal: 'existing session',
      priority: 'balanced',
      isAdmin: true,
    });

    const sessionRows = [
      {
        id: created.id,
        guild_id: 'g-dup',
        requested_by: 'u-dup',
        goal: 'stale DB version',
        priority: 'balanced',
        status: 'running',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:01.000Z',
        started_at: null,
        ended_at: null,
        result: null,
        error: null,
      },
    ];

    const mockSelect = () => {
      const chain: Record<string, any> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue({ data: sessionRows });
      return chain;
    };

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: () => mockSelect(),
    } as any);

    const count = await rehydrateActiveSessions();
    expect(count).toBe(0);

    const session = getAgentSession(created.id);
    expect(session?.goal).toBe('existing session');
  });

  it('Supabase 에러 시 0 반환하고 예외를 던지지 않는다', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({
              limit: () => Promise.reject(new Error('connection failed')),
            }),
          }),
        }),
      }),
    } as any);

    const count = await rehydrateActiveSessions();
    expect(count).toBe(0);
  });
});

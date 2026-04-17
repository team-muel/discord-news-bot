import { describe, expect, it, vi } from 'vitest';
import {
  runCriticReviewNode,
  runFullReviewCritiqueStateNode,
  runFullReviewExecutionStateNode,
  runFullReviewPlanStateNode,
  runPlanTaskNode,
  runResearchTaskNode,
  type FullReviewRuntimeDependencies,
} from './fullReviewNodes';
import { createInitialLangGraphState } from '../stateContract';
import type { AgentSession, AgentStep } from '../../multiAgentTypes';

const createStep = (role: AgentStep['role']): AgentStep => ({
  id: `${role}-1`,
  role,
  title: role,
  status: 'pending',
  startedAt: null,
  endedAt: null,
  output: null,
  error: null,
});

const createSession = (): AgentSession => ({
  id: 's1',
  guildId: 'g1',
  requestedBy: 'u1',
  goal: 'goal',
  priority: 'balanced',
  requestedSkillId: null,
  routedIntent: 'task',
  status: 'running',
  createdAt: '2026-03-20T00:00:00.000Z',
  updatedAt: '2026-03-20T00:00:00.000Z',
  startedAt: '2026-03-20T00:00:00.000Z',
  endedAt: null,
  result: null,
  error: null,
  cancelRequested: false,
  memoryHints: [],
  steps: [createStep('planner'), createStep('researcher'), createStep('critic')],
  shadowGraph: null,
});

const createDeps = (): FullReviewRuntimeDependencies => ({
  traceShadowNode: vi.fn(),
  runStep: vi.fn(async (_session, _step, skillId) => `out:${skillId}`),
  decomposeGoalLeastToMost: vi.fn(async () => []),
  runLeastToMostExecutionDraft: vi.fn(async () => 'ltm:draft'),
});

const ensureShadowGraph = (session: AgentSession): NonNullable<AgentSession['shadowGraph']> => {
  if (!session.shadowGraph) {
    session.shadowGraph = createInitialLangGraphState({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
      goal: session.goal,
    });
  }

  return session.shadowGraph;
};

describe('fullReviewNodes', () => {
  it('runPlanTaskNode는 subgoal을 반영한 계획을 생성한다', async () => {
    const session = createSession();
    const planner = session.steps[0];
    const deps = createDeps();
    vi.mocked(deps.decomposeGoalLeastToMost).mockResolvedValue(['A 준비', 'B 점검']);

    const out = await runPlanTaskNode({
      session,
      planner,
      taskGoal: '운영 안정화',
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
    });

    expect(out.subgoals.length).toBe(2);
    expect(out.plan).toContain('out:ops-plan');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'plan_actions', 'planner');
  });

  it('runResearchTaskNode는 LTM 실패 시 fallback 실행으로 전환한다', async () => {
    const session = createSession();
    const researcher = session.steps[1];
    const deps = createDeps();
    vi.mocked(deps.runLeastToMostExecutionDraft).mockRejectedValue(new Error('ltm_fail'));

    const out = await runResearchTaskNode({
      session,
      researcher,
      taskGoal: '운영 안정화',
      plan: '1) 단계',
      subgoals: ['A', 'B'],
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
    });

    expect(out).toContain('out:ops-execution');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'execute_actions', 'researcher_execution');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'execute_actions', expect.stringContaining('least_to_most:fallback:'));
  });

  it('runCriticReviewNode는 critic 단계 출력을 반환한다', async () => {
    const session = createSession();
    const critic = session.steps[2];
    const deps = createDeps();

    const out = await runCriticReviewNode({
      session,
      critic,
      taskGoal: '운영 안정화',
      executionDraft: 'draft',
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
    });

    expect(out).toContain('out:ops-critique');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'critic_review', 'ops-critique');
  });

  it('runFullReviewPlanStateNode는 plan state를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const traceNodeState = vi.fn();

    const out = await runFullReviewPlanStateNode({
      session,
      planner: session.steps[0],
      taskGoal: '운영 안정화',
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out.plan).toContain('out:ops-plan');
    expect(session.shadowGraph).toMatchObject({
      planText: out.plan,
      subgoals: out.subgoals,
      plans: [expect.objectContaining({ actionName: 'ops-plan' })],
    });
    expect(traceNodeState).toHaveBeenCalledWith('subgoals=0');
  });

  it('runFullReviewExecutionStateNode는 execution draft를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const traceNodeState = vi.fn();

    const out = await runFullReviewExecutionStateNode({
      session,
      researcher: session.steps[1],
      taskGoal: '운영 안정화',
      plan: '1) 단계',
      subgoals: [],
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out).toContain('out:ops-execution');
    expect(session.shadowGraph).toMatchObject({ executionDraft: out });
    expect(traceNodeState).toHaveBeenCalledWith('researcher_execution');
  });

  it('runFullReviewCritiqueStateNode는 critique text를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const traceNodeState = vi.fn();

    const out = await runFullReviewCritiqueStateNode({
      session,
      critic: session.steps[2],
      taskGoal: '운영 안정화',
      executionDraft: 'draft',
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      dependencies: deps,
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out).toContain('out:ops-critique');
    expect(session.shadowGraph).toMatchObject({ critiqueText: out });
    expect(traceNodeState).toHaveBeenCalledWith('ops-critique');
  });
});
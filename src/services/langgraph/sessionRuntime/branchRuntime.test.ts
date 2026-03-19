import { describe, expect, it, vi } from 'vitest';
import { executeSessionBranchRuntime } from './branchRuntime';
import type { AgentSession, AgentStep, BeamEvaluation } from '../../multiAgentService';

const createStep = (role: AgentStep['role'], title: string): AgentStep => ({
  id: `${role}-1`,
  role,
  title,
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
  requestedSkillId: 'ops-execution',
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
  steps: [createStep('planner', 'planner'), createStep('researcher', 'researcher'), createStep('critic', 'critic')],
  shadowGraph: null,
});

const createDependencies = () => ({
  traceShadowNode: vi.fn(),
  runStep: vi.fn(async () => 'draft'),
  runSelfRefineLite: vi.fn(async ({ currentDraft }) => currentDraft),
  finalizeTaskResult: vi.fn(({ rawResult }) => `final:${rawResult}`),
  markSessionTerminal: vi.fn(),
  ensureShadowGraph: vi.fn((session) => {
    if (!session.shadowGraph) {
      session.shadowGraph = {
        sessionId: session.id,
        guildId: session.guildId,
        requestedBy: session.requestedBy,
        priority: session.priority,
        originalGoal: session.goal,
        executionGoal: session.goal,
        compiledPrompt: null,
        intent: null,
        memoryHints: [],
        plans: [],
        outcomes: [],
        policyBlocked: false,
        finalText: null,
        errorCode: null,
        trace: [],
      };
    }
    return session.shadowGraph;
  }),
  decomposeGoalLeastToMost: vi.fn(async () => []),
  runLeastToMostExecutionDraft: vi.fn(async () => 'ltm draft'),
  getAgentTotPolicySnapshot: vi.fn(() => ({ activeEnabled: false, strategy: 'bfs' })),
  getAgentGotPolicySnapshot: vi.fn(() => ({ activeEnabled: false, minSelectedScore: 0.5 })),
  getAgentGotCutoverDecision: vi.fn(async () => ({
    guildId: 'g1',
    allowed: false,
    readinessRecommended: false,
    rolloutPercentage: 0,
    selectedByRollout: false,
    reason: 'off',
    failedReasons: ['off'],
    evaluatedAt: '2026-03-20T00:00:00.000Z',
    windowDays: 14,
  })),
  runToTShadowExploration: vi.fn(async () => null),
  resolveFinalSelfConsistencySamples: vi.fn(() => 1),
  touch: vi.fn(),
  evaluateSelfGuidedBeam: vi.fn(async (): Promise<BeamEvaluation> => ({
    probability: 0.5,
    correctness: 0.5,
    score: 0.25,
    probabilitySource: 'fallback',
  })),
  enqueueBestEffortTelemetry: vi.fn(),
});

const constants = {
  sessionTimeoutMs: 120_000,
  stepTimeoutMs: 45_000,
  ormPassThreshold: 75,
  ormReviewThreshold: 55,
  totCandidatePairRecordTask: 'tot_candidate_pair_record',
};

describe('executeSessionBranchRuntime', () => {
  it('requested_skill 전략을 실행하고 terminalize 한다', async () => {
    const session = createSession();
    const dependencies = createDependencies();

    const result = await executeSessionBranchRuntime({
      strategy: 'requested_skill',
      session,
      taskGoal: 'target',
      sessionStartedAtMs: Date.now(),
      planner: session.steps[0],
      researcher: session.steps[1],
      critic: session.steps[2],
      dependencies,
      constants,
    });

    expect(result).toBe('completed');
    expect(dependencies.runStep).toHaveBeenCalledTimes(1);
    expect(dependencies.markSessionTerminal).toHaveBeenCalledTimes(1);
  });

  it('fast_path 전략을 실행하고 fast trace를 남긴다', async () => {
    const session = createSession();
    session.requestedSkillId = null;
    session.priority = 'fast';
    const dependencies = createDependencies();

    const result = await executeSessionBranchRuntime({
      strategy: 'fast_path',
      session,
      taskGoal: 'target',
      sessionStartedAtMs: Date.now(),
      planner: session.steps[0],
      researcher: session.steps[1],
      critic: session.steps[2],
      dependencies,
      constants,
    });

    expect(result).toBe('completed');
    expect(dependencies.traceShadowNode).toHaveBeenCalledWith(session, 'execute_actions', 'fast_path');
    expect(dependencies.markSessionTerminal).toHaveBeenCalledTimes(1);
  });

  it('full_review 전략은 plan/research/critic 흐름 후 terminalize 한다', async () => {
    const session = createSession();
    session.requestedSkillId = null;
    const dependencies = createDependencies();

    const result = await executeSessionBranchRuntime({
      strategy: 'full_review',
      session,
      taskGoal: 'target',
      sessionStartedAtMs: Date.now(),
      planner: session.steps[0],
      researcher: session.steps[1],
      critic: session.steps[2],
      dependencies,
      constants,
    });

    expect(result).toBe('completed');
    expect(dependencies.traceShadowNode).toHaveBeenCalledWith(session, 'plan_actions', 'planner');
    expect(dependencies.traceShadowNode).toHaveBeenCalledWith(session, 'execute_actions', 'researcher_execution');
    expect(dependencies.traceShadowNode).toHaveBeenCalledWith(session, 'critic_review', 'ops-critique');
    expect(dependencies.markSessionTerminal).toHaveBeenCalledTimes(1);
  });
});
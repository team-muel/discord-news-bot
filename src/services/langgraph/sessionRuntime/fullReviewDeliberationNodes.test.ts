import { describe, expect, it, vi } from 'vitest';
import {
  runFullReviewComposeStateNode,
  runHitlReviewStateNode,
  runFullReviewPromoteStateNode,
  runFullReviewTotStateNode,
  runComposeFinalNode,
  runPromoteBestCandidateNode,
  type FullReviewDeliberationDependencies,
} from './fullReviewDeliberationNodes';
import { createInitialLangGraphState } from '../stateContract';
import type { AgentSession, AgentStep, BeamEvaluation } from '../../multiAgentTypes';

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

const createDeps = (): FullReviewDeliberationDependencies => ({
  traceShadowNode: vi.fn(),
  runStep: vi.fn(async () => 'base-draft'),
  touch: vi.fn(),
  runSelfRefineLite: vi.fn(async ({ currentDraft }) => `refined:${currentDraft}`),
  evaluateSelfGuidedBeam: vi.fn(async (): Promise<BeamEvaluation> => ({
    probability: 0.7,
    correctness: 0.8,
    score: 0.56,
    probabilitySource: 'self_eval',
  })),
  enqueueBestEffortTelemetry: vi.fn(),
  resolveFinalSelfConsistencySamples: vi.fn(() => 1),
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

const createTotPolicy = () => ({
  shadowEnabled: false,
  strategy: 'bfs' as const,
  branchAngles: [],
  adaptiveSamplingEnabled: false,
  samplingTempMin: 0.1,
  samplingTempMax: 0.2,
  samplingTopPMin: 0.8,
  samplingTopPMax: 0.9,
  localSearchEnabled: false,
  localSearchMutations: 0,
  replayEnabled: false,
  replayTopK: 0,
  maxBranches: 2,
  keepTop: 1,
  activeEnabled: false,
  activeAllowFast: true,
  activeMinGoalLength: 10,
  activeMinScoreGain: 2,
  activeMinBeamGain: 0.01,
  activeRequireNonPass: false,
  autoTuneEnabled: false,
  autoTuneIntervalHours: 24,
  autoTuneMinSamples: 10,
});

const createGotPolicy = () => ({
  strategy: 'got_v1',
  shadowEnabled: false,
  activeEnabled: false,
  shadowAllowlist: [],
  activeAllowlist: [],
  maxNodesFast: 10,
  maxNodesBalanced: 24,
  maxNodesPrecise: 40,
  maxEdgesFast: 20,
  maxEdgesBalanced: 64,
  maxEdgesPrecise: 120,
  minSelectedScore: 0.5,
});

describe('fullReviewDeliberationNodes', () => {
  it('runComposeFinalNode는 최종 compose 후 self-refine 결과를 반환한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const researcher = session.steps[1];

    const out = await runComposeFinalNode({
      session,
      taskGoal: '운영 안정화',
      plan: '1) 점검',
      critique: '보완',
      executionDraft: '초안',
      researcher,
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      stepTimeoutMs: 45_000,
      dependencies: deps,
      ensureSessionBudget: () => undefined,
    });

    expect(out.finalRefined).toBe('refined:base-draft');
    expect(deps.traceShadowNode).toHaveBeenCalledWith(session, 'compose_response', 'final_output');
  });

  it('runPromoteBestCandidateNode는 후보가 없으면 baseline을 유지한다', async () => {
    const session = createSession();
    const deps = createDeps();

    const out = await runPromoteBestCandidateNode({
      session,
      taskGoal: '운영 안정화',
      finalRefined: 'baseline',
      totShadowBest: null,
      gotCutoverAllowed: false,
      gotPolicy: { minSelectedScore: 0.5 },
      totPolicy: {
        activeEnabled: false,
        activeAllowFast: true,
        activeMinGoalLength: 10,
        activeRequireNonPass: false,
        activeMinScoreGain: 2,
        activeMinBeamGain: 0.01,
        strategy: 'bfs',
      },
      ormPassThreshold: 75,
      ormReviewThreshold: 55,
      totCandidatePairRecordTask: 'tot_candidate_pair_record',
      dependencies: deps,
    });

    expect(out.selectedFinalRaw).toBe('baseline');
    expect(deps.enqueueBestEffortTelemetry).not.toHaveBeenCalled();
  });

  it('runFullReviewTotStateNode는 tot shadow 결과와 cutover 상태를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const traceNodeState = vi.fn();

    const out = await runFullReviewTotStateNode({
      session,
      taskGoal: '운영 안정화',
      plan: '1) 점검',
      executionDraft: '초안',
      critique: '보완',
      sessionStartedAtMs: Date.now(),
      dependencies: {
        getAgentTotPolicySnapshot: vi.fn(() => createTotPolicy()),
        getAgentGotPolicySnapshot: vi.fn(() => createGotPolicy()),
        getAgentGotCutoverDecision: vi.fn(async () => ({
          guildId: 'g1',
          allowed: true,
          readinessRecommended: false,
          rolloutPercentage: 0,
          selectedByRollout: false,
          reason: 'manual_cutover',
          failedReasons: [],
          evaluatedAt: '2026-03-20T00:00:00.000Z',
          windowDays: 14,
        })),
        runToTShadowExploration: vi.fn(async () => ({
          rawResult: 'tot-candidate',
          score: 88,
          beamProbability: 0.7,
          beamCorrectness: 0.8,
          beamScore: 0.56,
          beamProbabilitySource: 'self_eval' as const,
          evidenceBundleId: 'evidence-1',
        })),
      },
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out.gotCutoverAllowed).toBe(false);
    expect(out.totShadowBest?.rawResult).toBe('tot-candidate');
    expect(session.shadowGraph).toMatchObject({
      totShadowBest: expect.objectContaining({ rawResult: 'tot-candidate' }),
    });
    expect(traceNodeState).toHaveBeenCalledWith(expect.stringContaining('got_cutover:allowed=false'));
  });

  it('runFullReviewComposeStateNode는 final candidate를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const traceNodeState = vi.fn();

    const out = await runFullReviewComposeStateNode({
      session,
      taskGoal: '운영 안정화',
      plan: '1) 점검',
      critique: '보완',
      executionDraft: '초안',
      researcher: session.steps[1],
      sessionStartedAtMs: Date.now(),
      sessionTimeoutMs: 120_000,
      stepTimeoutMs: 45_000,
      dependencies: deps,
      ensureSessionBudget: () => undefined,
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out.finalRefined).toBe('refined:base-draft');
    expect(session.shadowGraph).toMatchObject({ finalCandidate: 'refined:base-draft' });
    expect(traceNodeState).toHaveBeenCalledWith('final_output');
  });

  it('runFullReviewPromoteStateNode는 selected final raw를 shadowGraph에 기록한다', async () => {
    const session = createSession();
    const deps = createDeps();
    const traceNodeState = vi.fn();

    const out = await runFullReviewPromoteStateNode({
      session,
      taskGoal: '운영 안정화',
      finalRefined: 'baseline',
      totShadowBest: null,
      gotCutoverAllowed: false,
      gotPolicy: { minSelectedScore: 0.5 },
      totPolicy: {
        activeEnabled: false,
        activeAllowFast: true,
        activeMinGoalLength: 10,
        activeRequireNonPass: false,
        activeMinScoreGain: 2,
        activeMinBeamGain: 0.01,
        strategy: 'bfs',
      },
      ormPassThreshold: 75,
      ormReviewThreshold: 55,
      totCandidatePairRecordTask: 'tot_candidate_pair_record',
      dependencies: deps,
      ensureShadowGraph,
      traceNodeState,
    });

    expect(out.selectedFinalRaw).toBe('baseline');
    expect(session.shadowGraph).toMatchObject({ selectedFinalRaw: 'baseline' });
    expect(traceNodeState).toHaveBeenCalledWith('selected_candidate');
  });

  it('runHitlReviewStateNode는 review-required full review 세션을 pause 상태로 넘긴다', () => {
    const session = createSession();
    const traceNodeState = vi.fn();
    const pauseForHitl = vi.fn();
    session.executionEngine = 'langgraphjs';
    session.priority = 'precise';
    session.policyGate = { decision: 'review', reasons: ['needs_human_review'] };
    ensureShadowGraph(session).executionStrategy = 'full_review';

    const out = runHitlReviewStateNode({
      session,
      taskGoal: '운영 안정화',
      critiqueText: '보완',
      ensureShadowGraph,
      traceNodeState,
      pauseForHitl,
    });

    expect(out.executionStrategy).toBe('full_review');
    expect(traceNodeState).toHaveBeenCalledWith('awaiting_input');
    expect(pauseForHitl).toHaveBeenCalledWith(expect.stringContaining('goal=운영 안정화'));
  });

  it('runHitlReviewStateNode는 reject decision을 final candidate로 반영한다', () => {
    const session = createSession();
    const traceNodeState = vi.fn();
    session.executionEngine = 'langgraphjs';
    session.policyGate = { decision: 'review', reasons: ['needs_human_review'] };
    session.hitlState = {
      awaitingInput: false,
      gateNode: 'hitl_review',
      prompt: 'prompt',
      requestedAt: '2026-03-20T00:00:00.000Z',
      resumedAt: '2026-03-20T00:01:00.000Z',
      decision: 'reject',
      note: '추가 검토 필요',
    };
    ensureShadowGraph(session).executionStrategy = 'full_review';

    const out = runHitlReviewStateNode({
      session,
      taskGoal: '운영 안정화',
      critiqueText: '보완',
      ensureShadowGraph,
      traceNodeState,
      pauseForHitl: vi.fn(),
    });

    expect(out).toMatchObject({
      finalCandidate: expect.stringContaining('추가 지시: 추가 검토 필요'),
      selectedFinalRaw: expect.stringContaining('추가 지시: 추가 검토 필요'),
    });
    expect(traceNodeState).toHaveBeenCalledWith('decision=reject');
  });
});
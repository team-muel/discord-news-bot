import { describe, expect, it, vi } from 'vitest';
import {
  runComposeFinalNode,
  runPromoteBestCandidateNode,
  type FullReviewDeliberationDependencies,
} from './fullReviewDeliberationNodes';
import type { AgentSession, AgentStep, BeamEvaluation } from '../../multiAgentService';

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
});
import { buildTotCandidatePairTelemetryPayload, decideComposePromotion } from '../nodes/composeNodes';
import { withTimeout } from '../runtimeSupport/runtimeBudget';
import { selectConsensusText } from '../runtimeSupport/runtimeFormatting';
import { evaluateTaskResultCandidate } from '../runtimeSupport/runtimeEvaluation';
import { executeSkill } from '../../skills/engine';
import type { AgentGotPolicySnapshot } from '../../agent/agentGotPolicyService';
import type { AgentTotPolicySnapshot } from '../../agent/agentTotPolicyService';
import type { AgentSession, BeamEvaluation } from '../../multiAgentTypes';

export type TotShadowBest = {
  rawResult: string;
  score: number;
  beamProbability: number;
  beamCorrectness: number;
  beamScore: number;
  beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
  evidenceBundleId: string;
};

type TotPolicySnapshot = {
  activeEnabled: boolean;
  activeAllowFast: boolean;
  activeMinGoalLength: number;
  activeRequireNonPass: boolean;
  activeMinScoreGain: number;
  activeMinBeamGain: number;
  strategy: string;
};

type GotPolicySnapshot = {
  minSelectedScore: number;
};

export type FullReviewDeliberationDependencies = {
  traceShadowNode: (session: AgentSession, node: 'compose_response', note?: string) => void;
  runStep: (
    session: AgentSession,
    step: AgentSession['steps'][number],
    skillId: 'ops-execution',
    buildInput: (priorOutput?: string) => string,
    priorOutput?: string,
  ) => Promise<string>;
  touch: (session: AgentSession) => void;
  runSelfRefineLite: (params: {
    session: AgentSession;
    taskGoal: string;
    currentDraft: string;
    sessionStartedAtMs: number;
    traceLabel: string;
  }) => Promise<string>;
  evaluateSelfGuidedBeam: (params: {
    session: AgentSession;
    taskGoal: string;
    candidate: string;
    ormScore: number;
  }) => Promise<BeamEvaluation>;
  enqueueBestEffortTelemetry: (params: {
    name: string;
    taskType: string;
    payload: Record<string, unknown>;
    guildId?: string;
  }) => void;
  resolveFinalSelfConsistencySamples: (session: AgentSession, taskGoal: string) => number;
};

type EnsureShadowGraph = (session: AgentSession) => NonNullable<AgentSession['shadowGraph']>;

export type FullReviewTotStateDependencies = {
  getAgentTotPolicySnapshot: (guildId: string) => AgentTotPolicySnapshot;
  getAgentGotPolicySnapshot: (guildId: string) => AgentGotPolicySnapshot;
  getAgentGotCutoverDecision: (params: { guildId: string; sessionId: string }) => Promise<{
    guildId: string;
    allowed: boolean;
    readinessRecommended: boolean;
    rolloutPercentage: number;
    selectedByRollout: boolean;
    reason: string;
    failedReasons: string[];
    evaluatedAt: string;
    windowDays: number;
  }>;
  runToTShadowExploration: (params: {
    session: AgentSession;
    policy: AgentTotPolicySnapshot;
    gotPolicy: AgentGotPolicySnapshot;
    taskGoal: string;
    plan: string;
    executionDraft: string;
    critique: string;
    sessionStartedAtMs: number;
  }) => Promise<TotShadowBest | null>;
};

const shouldPauseForHitlReview = (
  session: AgentSession,
  ensureShadowGraph: EnsureShadowGraph,
): boolean => {
  if (session.executionEngine !== 'langgraphjs') {
    return false;
  }

  const strategy = ensureShadowGraph(session).executionStrategy;
  if (strategy !== 'full_review') {
    return false;
  }

  return session.policyGate?.decision === 'review' || session.priority === 'precise';
};

const buildHitlReviewPrompt = (
  session: AgentSession,
  taskGoal: string,
  ensureShadowGraph: EnsureShadowGraph,
): string => {
  const state = ensureShadowGraph(session);
  const lines = [
    'LangGraph human review is required before automatic completion.',
    `goal=${taskGoal}`,
    `strategy=${state.executionStrategy || 'unknown'}`,
    `policyDecision=${session.policyGate?.decision || 'allow'}`,
  ];

  if (state.planText) {
    lines.push(`plan=${state.planText.slice(0, 240)}`);
  }
  if (state.critiqueText) {
    lines.push(`critique=${state.critiqueText.slice(0, 240)}`);
  }
  if (state.totShadowBest?.rawResult) {
    lines.push(`totCandidate=${state.totShadowBest.rawResult.slice(0, 240)}`);
  }

  return lines.join('\n');
};

export const runHitlReviewStateNode = (params: {
  session: AgentSession;
  taskGoal: string;
  critiqueText: string;
  ensureShadowGraph: EnsureShadowGraph;
  traceNodeState: (note: string) => void;
  pauseForHitl: (prompt: string) => void;
}): NonNullable<AgentSession['shadowGraph']> => {
  const { session, taskGoal, critiqueText, ensureShadowGraph, traceNodeState, pauseForHitl } = params;

  if (!shouldPauseForHitlReview(session, ensureShadowGraph)) {
    traceNodeState('skipped');
    return ensureShadowGraph(session);
  }

  if (session.hitlState?.awaitingInput || !session.hitlState?.decision) {
    const prompt = buildHitlReviewPrompt(session, taskGoal, ensureShadowGraph);
    traceNodeState('awaiting_input');
    pauseForHitl(prompt);
    return ensureShadowGraph(session);
  }

  const decision = session.hitlState.decision;
  traceNodeState(`decision=${decision}`);

  if (decision === 'reject') {
    const note = String(session.hitlState.note || '').trim();
    const rejectionText = note
      ? `사람 검토 결과 자동 완료가 보류되었습니다.\n\n추가 지시: ${note}`
      : '사람 검토 결과 자동 완료가 보류되었습니다.';
    session.shadowGraph = {
      ...ensureShadowGraph(session),
      finalCandidate: rejectionText,
      selectedFinalRaw: rejectionText,
    };
    return ensureShadowGraph(session);
  }

  if (decision === 'revise' && session.hitlState.note) {
    session.shadowGraph = {
      ...ensureShadowGraph(session),
      critiqueText: [critiqueText, `추가 인간 검토 지시: ${session.hitlState.note}`]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  return ensureShadowGraph(session);
};

export const runFullReviewTotStateNode = async (params: {
  session: AgentSession;
  taskGoal: string;
  plan: string;
  executionDraft: string;
  critique: string;
  sessionStartedAtMs: number;
  dependencies: FullReviewTotStateDependencies;
  ensureShadowGraph: EnsureShadowGraph;
  traceNodeState: (note: string) => void;
}): Promise<{
  totPolicy: AgentTotPolicySnapshot;
  gotPolicy: AgentGotPolicySnapshot;
  gotCutoverAllowed: boolean;
  totShadowBest: TotShadowBest | null;
}> => {
  const { session, taskGoal, plan, executionDraft, critique, sessionStartedAtMs, dependencies, ensureShadowGraph, traceNodeState } = params;
  const totPolicy = dependencies.getAgentTotPolicySnapshot(session.guildId);
  const gotPolicy = dependencies.getAgentGotPolicySnapshot(session.guildId);
  const gotCutoverDecision = gotPolicy.activeEnabled
    ? await dependencies.getAgentGotCutoverDecision({ guildId: session.guildId, sessionId: session.id })
    : {
      guildId: session.guildId,
      allowed: false,
      readinessRecommended: false,
      rolloutPercentage: 0,
      selectedByRollout: false,
      reason: 'got_active_disabled_by_policy',
      failedReasons: ['got_active_disabled_by_policy'],
      evaluatedAt: new Date().toISOString(),
      windowDays: 14,
    };

  traceNodeState(`got_cutover:allowed=${gotCutoverDecision.allowed},reason=${gotCutoverDecision.reason}`);

  let totShadowBest: TotShadowBest | null = null;
  if (!session.cancelRequested) {
    totShadowBest = await dependencies.runToTShadowExploration({
      session,
      policy: totPolicy,
      gotPolicy,
      taskGoal,
      plan,
      executionDraft,
      critique,
      sessionStartedAtMs,
    });
  }

  session.shadowGraph = {
    ...ensureShadowGraph(session),
    totShadowBest,
  };

  return {
    totPolicy,
    gotPolicy,
    gotCutoverAllowed: gotCutoverDecision.allowed,
    totShadowBest,
  };
};

export const runComposeFinalNode = async (params: {
  session: AgentSession;
  taskGoal: string;
  plan: string;
  critique: string;
  executionDraft: string;
  researcher: AgentSession['steps'][number];
  sessionStartedAtMs: number;
  sessionTimeoutMs: number;
  stepTimeoutMs: number;
  dependencies: FullReviewDeliberationDependencies;
  ensureSessionBudget: (sessionStartedAtMs: number, timeoutMs: number) => void;
}): Promise<{ finalRefined: string }> => {
  const {
    session,
    taskGoal,
    plan,
    critique,
    executionDraft,
    researcher,
    sessionStartedAtMs,
    sessionTimeoutMs,
    stepTimeoutMs,
    dependencies,
    ensureSessionBudget,
  } = params;

  ensureSessionBudget(sessionStartedAtMs, sessionTimeoutMs);
  dependencies.traceShadowNode(session, 'compose_response', 'final_output');
  const finalComposeGoal = [
    '요구사항: 중간 과정/역할별 산출물 노출 금지',
    `목표: ${taskGoal}`,
    `계획 참고: ${plan}`,
    `검증 참고: ${critique}`,
    `초안 참고: ${executionDraft}`,
    '출력: 사용자에게 전달할 최종 결과물만 간결하게 작성',
  ].join('\n');

  const finalResultBase = await dependencies.runStep(session, researcher, 'ops-execution', () => finalComposeGoal, critique);
  let finalResult = finalResultBase;

  const finalSelfConsistencySamples = dependencies.resolveFinalSelfConsistencySamples(session, taskGoal);
  if (finalSelfConsistencySamples > 1 && !session.cancelRequested) {
    const candidates: string[] = [finalResultBase];
    let sampleFailures = 0;

    for (let i = 1; i < finalSelfConsistencySamples; i += 1) {
      ensureSessionBudget(sessionStartedAtMs, sessionTimeoutMs);
      if (session.cancelRequested) {
        throw new Error('SESSION_CANCELLED');
      }
      try {
        const variantGoal = [
          finalComposeGoal,
          `추가 지시: self-consistency 후보 ${i + 1}/${finalSelfConsistencySamples}.`,
          '동일 사실을 유지하되 문장 구성은 독립적으로 재작성하라.',
        ].join('\n');

        const variant = await withTimeout(executeSkill('ops-execution', {
          guildId: session.guildId,
          requestedBy: session.requestedBy,
          actionName: 'compose.self_consistency_variant',
          goal: variantGoal,
          memoryHints: session.memoryHints,
          priorOutput: critique,
        }), stepTimeoutMs, 'STEP_TIMEOUT:researcher');

        const output = String(variant.output || '').trim();
        if (output) {
          candidates.push(output);
        }
      } catch {
        sampleFailures += 1;
      }
    }

    const consensus = selectConsensusText(candidates);
    if (consensus) {
      finalResult = consensus;
      researcher.output = consensus;
      dependencies.touch(session);
    }
    dependencies.traceShadowNode(session, 'compose_response', `self_consistency:candidates=${candidates.length},failures=${sampleFailures}`);
  }

  const finalRefined = await dependencies.runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: finalResult,
    sessionStartedAtMs,
    traceLabel: 'final_output',
  });

  return { finalRefined };
};

export const runFullReviewComposeStateNode = async (params: {
  session: AgentSession;
  taskGoal: string;
  plan: string;
  critique: string;
  executionDraft: string;
  researcher: AgentSession['steps'][number];
  sessionStartedAtMs: number;
  sessionTimeoutMs: number;
  stepTimeoutMs: number;
  dependencies: FullReviewDeliberationDependencies;
  ensureSessionBudget: (sessionStartedAtMs: number, timeoutMs: number) => void;
  ensureShadowGraph: EnsureShadowGraph;
  traceNodeState: (note: string) => void;
}): Promise<{ finalRefined: string }> => {
  const {
    session,
    taskGoal,
    plan,
    critique,
    executionDraft,
    researcher,
    sessionStartedAtMs,
    sessionTimeoutMs,
    stepTimeoutMs,
    dependencies,
    ensureSessionBudget,
    ensureShadowGraph,
    traceNodeState,
  } = params;

  const composeNode = await runComposeFinalNode({
    session,
    taskGoal,
    plan,
    critique,
    executionDraft,
    researcher,
    sessionStartedAtMs,
    sessionTimeoutMs,
    stepTimeoutMs,
    dependencies,
    ensureSessionBudget,
  });

  session.shadowGraph = {
    ...ensureShadowGraph(session),
    finalCandidate: composeNode.finalRefined,
  };
  traceNodeState('final_output');

  return composeNode;
};

export const runPromoteBestCandidateNode = async (params: {
  session: AgentSession;
  taskGoal: string;
  finalRefined: string;
  totShadowBest: TotShadowBest | null;
  gotCutoverAllowed: boolean;
  gotPolicy: GotPolicySnapshot;
  totPolicy: TotPolicySnapshot;
  ormPassThreshold: number;
  ormReviewThreshold: number;
  totCandidatePairRecordTask: string;
  dependencies: FullReviewDeliberationDependencies;
}): Promise<{ selectedFinalRaw: string }> => {
  const {
    session,
    taskGoal,
    finalRefined,
    totShadowBest,
    gotCutoverAllowed,
    gotPolicy,
    totPolicy,
    ormPassThreshold,
    ormReviewThreshold,
    totCandidatePairRecordTask,
    dependencies,
  } = params;

  let selectedFinalRaw = finalRefined;
  let baseEval: ReturnType<typeof evaluateTaskResultCandidate> | null = null;
  let totEval: ReturnType<typeof evaluateTaskResultCandidate> | null = null;
  let baseBeam: BeamEvaluation | null = null;
  let totBeam: BeamEvaluation | null = null;
  let candidatePairLogged = false;

  if (totShadowBest?.rawResult) {
    baseEval = evaluateTaskResultCandidate({
      session,
      taskGoal,
      rawResult: finalRefined,
      passThreshold: ormPassThreshold,
      reviewThreshold: ormReviewThreshold,
    });
    totEval = evaluateTaskResultCandidate({
      session,
      taskGoal,
      rawResult: totShadowBest.rawResult,
      passThreshold: ormPassThreshold,
      reviewThreshold: ormReviewThreshold,
    });
    baseBeam = await dependencies.evaluateSelfGuidedBeam({
      session,
      taskGoal,
      candidate: finalRefined,
      ormScore: baseEval.orm.score,
    });
    totBeam = {
      probability: totShadowBest.beamProbability,
      correctness: totShadowBest.beamCorrectness,
      score: totShadowBest.beamScore,
      probabilitySource: totShadowBest.beamProbabilitySource,
    };
  }

  if ((totPolicy.activeEnabled || gotCutoverAllowed) && !session.cancelRequested) {
    const promotion = decideComposePromotion({
      totPolicyActiveEnabled: totPolicy.activeEnabled,
      totPolicyActiveAllowFast: totPolicy.activeAllowFast,
      totPolicyActiveMinGoalLength: totPolicy.activeMinGoalLength,
      totPolicyActiveRequireNonPass: totPolicy.activeRequireNonPass,
      totPolicyActiveMinScoreGain: totPolicy.activeMinScoreGain,
      totPolicyActiveMinBeamGain: totPolicy.activeMinBeamGain,
      gotCutoverAllowed,
      gotMinSelectedScore: gotPolicy.minSelectedScore,
      priority: session.priority,
      taskGoal,
      base: baseEval
        ? {
          ormScore: baseEval.orm.score,
          ormVerdict: baseEval.orm.verdict,
          evidenceBundleId: baseEval.orm.evidenceBundleId,
        }
        : null,
      candidate: totEval
        ? {
          ormScore: totEval.orm.score,
          ormVerdict: totEval.orm.verdict,
          evidenceBundleId: totEval.orm.evidenceBundleId,
        }
        : null,
      baseBeam,
      candidateBeam: totBeam,
    });

    if (promotion.shouldEvaluate && baseEval && totEval && totShadowBest?.rawResult && baseBeam && totBeam) {
      if (promotion.promote) {
        selectedFinalRaw = totShadowBest.rawResult;
      }

      if (session.totShadowAssessment) {
        session.totShadowAssessment.selectedByRouter = promotion.promote;
        session.totShadowAssessment.scoreGainVsBaseline = promotion.scoreGain;
      }
      dependencies.traceShadowNode(
        session,
        'compose_response',
        `tot_active:promote=${promotion.promote},tot_route=${promotion.promoteByTotPolicy},got_route=${promotion.promoteByGotCutover},base_orm=${baseEval.orm.score},tot_orm=${totEval.orm.score},orm_gain=${promotion.scoreGain},beam_gain=${promotion.beamGain.toFixed(4)}`,
      );

      dependencies.enqueueBestEffortTelemetry({
        name: 'tot_candidate_pair_record',
        taskType: totCandidatePairRecordTask,
        guildId: session.guildId,
        payload: buildTotCandidatePairTelemetryPayload({
          guildId: session.guildId,
          sessionId: session.id,
          strategy: totPolicy.strategy,
          base: {
            ormScore: baseEval.orm.score,
            ormVerdict: baseEval.orm.verdict,
            evidenceBundleId: baseEval.orm.evidenceBundleId,
          },
          candidate: {
            ormScore: totEval.orm.score,
            ormVerdict: totEval.orm.verdict,
            evidenceBundleId: totEval.orm.evidenceBundleId,
          },
          baseBeam,
          candidateBeam: totBeam,
          baselineResult: finalRefined,
          candidateResult: totShadowBest.rawResult,
          promoted: promotion.promote,
          scoreGain: promotion.scoreGain,
          beamGain: promotion.beamGain,
        }),
      });
      candidatePairLogged = true;
    } else {
      dependencies.traceShadowNode(session, 'compose_response', 'tot_active:skipped_by_policy');
    }
  }

  if (!candidatePairLogged && baseEval && totEval && totShadowBest?.rawResult && baseBeam && totBeam) {
    const scoreGain = totEval.orm.score - baseEval.orm.score;
    const beamGain = totBeam.score - baseBeam.score;
    const promoted = selectedFinalRaw === totShadowBest.rawResult;
    dependencies.enqueueBestEffortTelemetry({
      name: 'tot_candidate_pair_record',
      taskType: totCandidatePairRecordTask,
      guildId: session.guildId,
      payload: buildTotCandidatePairTelemetryPayload({
        guildId: session.guildId,
        sessionId: session.id,
        strategy: totPolicy.strategy,
        base: {
          ormScore: baseEval.orm.score,
          ormVerdict: baseEval.orm.verdict,
          evidenceBundleId: baseEval.orm.evidenceBundleId,
        },
        candidate: {
          ormScore: totEval.orm.score,
          ormVerdict: totEval.orm.verdict,
          evidenceBundleId: totEval.orm.evidenceBundleId,
        },
        baseBeam,
        candidateBeam: totBeam,
        baselineResult: finalRefined,
        candidateResult: totShadowBest.rawResult,
        promoted,
        scoreGain,
        beamGain,
      }),
    });
  }

  return { selectedFinalRaw };
};

export const runFullReviewPromoteStateNode = async (params: {
  session: AgentSession;
  taskGoal: string;
  finalRefined: string;
  totShadowBest: TotShadowBest | null;
  gotCutoverAllowed: boolean;
  gotPolicy: GotPolicySnapshot;
  totPolicy: TotPolicySnapshot;
  ormPassThreshold: number;
  ormReviewThreshold: number;
  totCandidatePairRecordTask: string;
  dependencies: FullReviewDeliberationDependencies;
  ensureShadowGraph: EnsureShadowGraph;
  traceNodeState: (note: string) => void;
}): Promise<{ selectedFinalRaw: string }> => {
  const {
    session,
    taskGoal,
    finalRefined,
    totShadowBest,
    gotCutoverAllowed,
    gotPolicy,
    totPolicy,
    ormPassThreshold,
    ormReviewThreshold,
    totCandidatePairRecordTask,
    dependencies,
    ensureShadowGraph,
    traceNodeState,
  } = params;

  const promotionNode = await runPromoteBestCandidateNode({
    session,
    taskGoal,
    finalRefined,
    totShadowBest,
    gotCutoverAllowed,
    gotPolicy,
    totPolicy,
    ormPassThreshold,
    ormReviewThreshold,
    totCandidatePairRecordTask,
    dependencies,
  });

  session.shadowGraph = {
    ...ensureShadowGraph(session),
    selectedFinalRaw: promotionNode.selectedFinalRaw,
  };
  traceNodeState('selected_candidate');

  return promotionNode;
};
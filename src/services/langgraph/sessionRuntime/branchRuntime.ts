import type { ExecutionStrategy } from '../nodes/strategyNodes';
import { ensureSessionBudget } from '../runtimeSupport/runtimeBudget';
import {
  runCriticReviewNode,
  runPlanTaskNode,
  runResearchTaskNode,
  type FullReviewRuntimeDependencies,
} from './fullReviewNodes';
import {
  runComposeFinalNode,
  runPromoteBestCandidateNode,
  type FullReviewDeliberationDependencies,
  type TotShadowBest,
} from './fullReviewDeliberationNodes';
import type { SkillId } from '../../skills/types';
import type {
  AgentSession,
  AgentSessionStatus,
  AgentStep,
} from '../../multiAgentService';

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
  activeEnabled: boolean;
  minSelectedScore: number;
};

type BranchRuntimeDependencies = FullReviewRuntimeDependencies & FullReviewDeliberationDependencies & {
  traceShadowNode: (session: AgentSession, node: 'plan_actions' | 'execute_actions' | 'critic_review' | 'policy_gate' | 'compose_response', note?: string) => void;
  finalizeTaskResult: (params: {
    session: AgentSession;
    taskGoal: string;
    rawResult: string;
    traceLabel?: string;
  }) => string;
  markSessionTerminal: (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => void;
  ensureShadowGraph: (session: AgentSession) => NonNullable<AgentSession['shadowGraph']>;
  getAgentTotPolicySnapshot: (guildId: string) => unknown;
  getAgentGotPolicySnapshot: (guildId: string) => unknown;
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
    policy: any;
    gotPolicy: any;
    taskGoal: string;
    plan: string;
    executionDraft: string;
    critique: string;
    sessionStartedAtMs: number;
  }) => Promise<TotShadowBest | null>;
};

type BranchRuntimeConstants = {
  sessionTimeoutMs: number;
  stepTimeoutMs: number;
  ormPassThreshold: number;
  ormReviewThreshold: number;
  totCandidatePairRecordTask: string;
};

const completeSession = (params: {
  session: AgentSession;
  taskGoal: string;
  rawResult: string;
  traceLabel: string;
  dependencies: BranchRuntimeDependencies;
}): AgentSessionStatus => {
  const { session, taskGoal, rawResult, traceLabel, dependencies } = params;
  dependencies.markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: dependencies.finalizeTaskResult({
      session,
      taskGoal,
      rawResult,
      traceLabel,
    }),
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};

const executeRequestedSkillBranch = async (params: {
  session: AgentSession;
  taskGoal: string;
  sessionStartedAtMs: number;
  dependencies: BranchRuntimeDependencies;
  constants: BranchRuntimeConstants;
}): Promise<AgentSessionStatus> => {
  const { session, taskGoal, sessionStartedAtMs, dependencies, constants } = params;
  if (!session.requestedSkillId) {
    throw new Error('REQUESTED_SKILL_BRANCH_UNAVAILABLE');
  }

  ensureSessionBudget(sessionStartedAtMs, constants.sessionTimeoutMs);
  const singleSkillStep = session.steps[0];
  dependencies.traceShadowNode(session, 'plan_actions', `requested_skill=${session.requestedSkillId}`);
  const singleResult = await dependencies.runStep(
    session,
    singleSkillStep,
    session.requestedSkillId,
    () => taskGoal,
    undefined,
  );
  const refinedResult = await dependencies.runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: singleResult,
    sessionStartedAtMs,
    traceLabel: 'single_skill',
  });
  dependencies.traceShadowNode(session, 'execute_actions', session.requestedSkillId);
  dependencies.traceShadowNode(session, 'compose_response', 'single_skill');

  return completeSession({
    session,
    taskGoal,
    rawResult: refinedResult,
    traceLabel: 'single_skill',
    dependencies,
  });
};

const executeFastPathBranch = async (params: {
  session: AgentSession;
  taskGoal: string;
  sessionStartedAtMs: number;
  researcher: AgentStep;
  dependencies: BranchRuntimeDependencies;
  constants: BranchRuntimeConstants;
}): Promise<AgentSessionStatus> => {
  const { session, taskGoal, sessionStartedAtMs, researcher, dependencies, constants } = params;
  ensureSessionBudget(sessionStartedAtMs, constants.sessionTimeoutMs);
  dependencies.traceShadowNode(session, 'execute_actions', 'fast_path');
  const fastDraft = await dependencies.runStep(session, researcher, 'ops-execution', () => [
    '우선순위: 빠름',
    '요구사항: 중간 과정 없이 최종 결과물만 제시',
    `목표: ${taskGoal}`,
    '출력: 바로 사용할 수 있는 결과물 텍스트',
  ].join('\n'), undefined);
  const fastRefined = await dependencies.runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: fastDraft,
    sessionStartedAtMs,
    traceLabel: 'fast_path',
  });
  dependencies.traceShadowNode(session, 'compose_response', 'fast_path');

  return completeSession({
    session,
    taskGoal,
    rawResult: fastRefined,
    traceLabel: 'fast_path',
    dependencies,
  });
};

const executeFullReviewBranch = async (params: {
  session: AgentSession;
  taskGoal: string;
  sessionStartedAtMs: number;
  planner: AgentStep;
  researcher: AgentStep;
  critic: AgentStep;
  dependencies: BranchRuntimeDependencies;
  constants: BranchRuntimeConstants;
}): Promise<AgentSessionStatus> => {
  const {
    session,
    taskGoal,
    sessionStartedAtMs,
    planner,
    researcher,
    critic,
    dependencies,
    constants,
  } = params;
  const totPolicy = dependencies.getAgentTotPolicySnapshot(session.guildId) as TotPolicySnapshot;
  const gotPolicy = dependencies.getAgentGotPolicySnapshot(session.guildId) as GotPolicySnapshot;
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

  dependencies.traceShadowNode(
    session,
    'policy_gate',
    `got_cutover:allowed=${gotCutoverDecision.allowed},reason=${gotCutoverDecision.reason}`,
  );

  const planTask = await runPlanTaskNode({
    session,
    planner,
    taskGoal,
    sessionStartedAtMs,
    sessionTimeoutMs: constants.sessionTimeoutMs,
    dependencies,
  });
  session.shadowGraph = {
    ...dependencies.ensureShadowGraph(session),
    plans: [
      ...dependencies.ensureShadowGraph(session).plans,
      {
        actionName: 'ops-plan',
        args: { goal: taskGoal },
        reason: String(planTask.plan || '').slice(0, 300),
      },
    ],
  };

  const executionDraft = await runResearchTaskNode({
    session,
    researcher,
    taskGoal,
    plan: planTask.plan,
    subgoals: planTask.subgoals,
    sessionStartedAtMs,
    sessionTimeoutMs: constants.sessionTimeoutMs,
    dependencies,
  });

  const critique = await runCriticReviewNode({
    session,
    critic,
    taskGoal,
    executionDraft,
    sessionStartedAtMs,
    sessionTimeoutMs: constants.sessionTimeoutMs,
    dependencies,
  });

  let totShadowBest: TotShadowBest | null = null;
  if (!session.cancelRequested) {
    totShadowBest = await dependencies.runToTShadowExploration({
      session,
      policy: totPolicy,
      gotPolicy,
      taskGoal,
      plan: planTask.plan,
      executionDraft,
      critique,
      sessionStartedAtMs,
    });
  }

  const composeNode = await runComposeFinalNode({
    session,
    taskGoal,
    plan: planTask.plan,
    critique,
    executionDraft,
    researcher,
    sessionStartedAtMs,
    sessionTimeoutMs: constants.sessionTimeoutMs,
    stepTimeoutMs: constants.stepTimeoutMs,
    dependencies,
    ensureSessionBudget,
  });

  const promotionNode = await runPromoteBestCandidateNode({
    session,
    taskGoal,
    finalRefined: composeNode.finalRefined,
    totShadowBest,
    gotCutoverAllowed: gotCutoverDecision.allowed,
    gotPolicy,
    totPolicy,
    ormPassThreshold: constants.ormPassThreshold,
    ormReviewThreshold: constants.ormReviewThreshold,
    totCandidatePairRecordTask: constants.totCandidatePairRecordTask,
    dependencies,
  });

  return completeSession({
    session,
    taskGoal,
    rawResult: promotionNode.selectedFinalRaw,
    traceLabel: 'final_output',
    dependencies,
  });
};

export const executeSessionBranchRuntime = async (params: {
  strategy: ExecutionStrategy;
  session: AgentSession;
  taskGoal: string;
  sessionStartedAtMs: number;
  planner: AgentStep;
  researcher: AgentStep;
  critic: AgentStep;
  dependencies: BranchRuntimeDependencies;
  constants: BranchRuntimeConstants;
}): Promise<AgentSessionStatus> => {
  const common = {
    session: params.session,
    taskGoal: params.taskGoal,
    sessionStartedAtMs: params.sessionStartedAtMs,
    dependencies: params.dependencies,
    constants: params.constants,
  };

  if (params.strategy === 'requested_skill') {
    return executeRequestedSkillBranch(common);
  }

  if (params.strategy === 'fast_path') {
    return executeFastPathBranch({
      ...common,
      researcher: params.researcher,
    });
  }

  return executeFullReviewBranch({
    ...common,
    planner: params.planner,
    researcher: params.researcher,
    critic: params.critic,
  });
};
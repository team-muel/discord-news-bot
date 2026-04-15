import { ensureSessionBudget, getErrorMessage } from '../runtimeSupport/runtimeBudget';
import type { SkillId } from '../../skills/types';
import type { AgentSession, AgentStep } from '../../multiAgentService';

export type FullReviewRuntimeDependencies = {
  traceShadowNode: (session: AgentSession, node: 'plan_actions' | 'execute_actions' | 'critic_review', note?: string) => void;
  runStep: (
    session: AgentSession,
    step: AgentStep,
    skillId: SkillId,
    buildInput: (priorOutput?: string) => string,
    priorOutput?: string,
  ) => Promise<string>;
  decomposeGoalLeastToMost: (params: {
    taskGoal: string;
    priority: AgentSession['priority'];
    guildId?: string;
    requestedBy?: string;
    sessionId?: string;
    providerProfile?: import('../../llmClient').LlmProviderProfile;
  }) => Promise<string[]>;
  runLeastToMostExecutionDraft: (params: {
    session: AgentSession;
    step: AgentStep;
    taskGoal: string;
    plan: string;
    subgoals: string[];
    sessionStartedAtMs: number;
  }) => Promise<string>;
};

export const runPlanTaskNode = async (params: {
  session: AgentSession;
  planner: AgentStep;
  taskGoal: string;
  sessionStartedAtMs: number;
  sessionTimeoutMs: number;
  dependencies: FullReviewRuntimeDependencies;
}): Promise<{
  plan: string;
  subgoals: string[];
}> => {
  const { session, planner, taskGoal, sessionStartedAtMs, sessionTimeoutMs, dependencies } = params;
  ensureSessionBudget(sessionStartedAtMs, sessionTimeoutMs);
  dependencies.traceShadowNode(session, 'plan_actions', 'planner');

  const subgoals = await dependencies.decomposeGoalLeastToMost({
    taskGoal,
    priority: session.priority,
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    sessionId: session.id,
    providerProfile: session.personalization?.effective.providerProfile,
  });
  if (subgoals.length >= 2) {
    dependencies.traceShadowNode(session, 'plan_actions', `least_to_most:subgoals=${subgoals.length}`);
  }

  const taskGoalWithSubgoals = subgoals.length >= 2
    ? [
      taskGoal,
      '',
      '하위목표(Least-to-Most):',
      ...subgoals.map((subgoal, index) => `${index + 1}. ${subgoal}`),
    ].join('\n')
    : taskGoal;

  const plan = await dependencies.runStep(session, planner, 'ops-plan', () => [
    session.priority === 'precise' ? '우선순위: 정밀 (검증과 리스크 완화를 강화)' : '우선순위: 균형',
    '역할: 계획 수립 에이전트',
    `목표: ${taskGoalWithSubgoals}`,
    '출력: 1) 실행 단계 2) 필요한 근거 3) 실패시 대안 을 간결한 한국어 문단으로 작성',
    '규칙: 추측과 단정 금지, 실제 실행 가능한 단계 중심',
  ].join('\n'), undefined);

  return {
    plan,
    subgoals,
  };
};

export const runResearchTaskNode = async (params: {
  session: AgentSession;
  researcher: AgentStep;
  taskGoal: string;
  plan: string;
  subgoals: string[];
  sessionStartedAtMs: number;
  sessionTimeoutMs: number;
  dependencies: FullReviewRuntimeDependencies;
}): Promise<string> => {
  const {
    session,
    researcher,
    taskGoal,
    plan,
    subgoals,
    sessionStartedAtMs,
    sessionTimeoutMs,
    dependencies,
  } = params;

  ensureSessionBudget(sessionStartedAtMs, sessionTimeoutMs);
  dependencies.traceShadowNode(session, 'execute_actions', 'researcher_execution');

  if (subgoals.length >= 2) {
    try {
      return await dependencies.runLeastToMostExecutionDraft({
        session,
        step: researcher,
        taskGoal,
        plan,
        subgoals,
        sessionStartedAtMs,
      });
    } catch (error) {
      dependencies.traceShadowNode(session, 'execute_actions', `least_to_most:fallback:${getErrorMessage(error)}`);
      return dependencies.runStep(session, researcher, 'ops-execution', () => [
        session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
        '역할: 실행/리서치 에이전트',
        `목표: ${taskGoal}`,
        `계획안: ${plan}`,
        '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
      ].join('\n'), plan);
    }
  }

  return dependencies.runStep(session, researcher, 'ops-execution', () => [
    session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
    '역할: 실행/리서치 에이전트',
    `목표: ${taskGoal}`,
    `계획안: ${plan}`,
    '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
  ].join('\n'), plan);
};

export const runCriticReviewNode = async (params: {
  session: AgentSession;
  critic: AgentStep;
  taskGoal: string;
  executionDraft: string;
  sessionStartedAtMs: number;
  sessionTimeoutMs: number;
  dependencies: FullReviewRuntimeDependencies;
}): Promise<string> => {
  const {
    session,
    critic,
    taskGoal,
    executionDraft,
    sessionStartedAtMs,
    sessionTimeoutMs,
    dependencies,
  } = params;

  ensureSessionBudget(sessionStartedAtMs, sessionTimeoutMs);
  dependencies.traceShadowNode(session, 'critic_review', 'ops-critique');

  return dependencies.runStep(session, critic, 'ops-critique', () => [
    session.priority === 'precise' ? '우선순위: 정밀 (보수적 관점으로 리스크를 촘촘히 점검)' : '우선순위: 균형',
    '역할: 검증 에이전트',
    `목표: ${taskGoal}`,
    `실행안: ${executionDraft}`,
    '출력: 사실성 위험, 과잉자동화 위험, 개인정보/운영 리스크를 점검하고 보완안을 제시',
  ].join('\n'), executionDraft);
};
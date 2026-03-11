import { parseIntegerEnv } from '../utils/env';
import type { SkillId } from './skills/types';

const AGENT_MAX_CONCURRENT_SESSIONS = Math.max(1, parseIntegerEnv(process.env.AGENT_MAX_CONCURRENT_SESSIONS, 4));
const AGENT_MAX_GOAL_LENGTH = Math.max(40, parseIntegerEnv(process.env.AGENT_MAX_GOAL_LENGTH, 1200));

const restrictedSkills = new Set<SkillId>(['incident-review']);

export type AgentPolicySnapshot = {
  maxConcurrentSessions: number;
  maxGoalLength: number;
  restrictedSkills: SkillId[];
};

export type AgentPolicyValidationResult = {
  ok: boolean;
  message: string;
};

export const getAgentPolicySnapshot = (): AgentPolicySnapshot => ({
  maxConcurrentSessions: AGENT_MAX_CONCURRENT_SESSIONS,
  maxGoalLength: AGENT_MAX_GOAL_LENGTH,
  restrictedSkills: [...restrictedSkills],
});

export const validateAgentSessionRequest = (params: {
  runningSessions: number;
  goal: string;
  requestedSkillId: SkillId | null;
  isAdmin: boolean;
}): AgentPolicyValidationResult => {
  const goal = String(params.goal || '').trim();
  if (!goal) {
    return { ok: false, message: '목표가 비어 있습니다.' };
  }

  if (goal.length > AGENT_MAX_GOAL_LENGTH) {
    return {
      ok: false,
      message: `목표 길이가 너무 깁니다. 최대 ${AGENT_MAX_GOAL_LENGTH}자까지 허용됩니다.`,
    };
  }

  if (params.runningSessions >= AGENT_MAX_CONCURRENT_SESSIONS) {
    return {
      ok: false,
      message: `동시 실행 세션 한도를 초과했습니다. 현재 한도: ${AGENT_MAX_CONCURRENT_SESSIONS}`,
    };
  }

  if (params.requestedSkillId && restrictedSkills.has(params.requestedSkillId) && !params.isAdmin) {
    return {
      ok: false,
      message: `스킬 ${params.requestedSkillId}은 관리자 전용입니다.`,
    };
  }

  return { ok: true, message: 'OK' };
};

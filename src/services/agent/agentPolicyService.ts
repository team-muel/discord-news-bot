import { parseMinIntEnv } from '../../utils/env';
import type { SkillId } from '../skills/types';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { listSkills } from '../skills/registry';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

const AGENT_MAX_CONCURRENT_SESSIONS = parseMinIntEnv(process.env.AGENT_MAX_CONCURRENT_SESSIONS, 4, 1);
const AGENT_MAX_GOAL_LENGTH = parseMinIntEnv(process.env.AGENT_MAX_GOAL_LENGTH, 1200, 40);
const AGENT_POLICY_CACHE_TTL_MS = parseMinIntEnv(process.env.AGENT_POLICY_CACHE_TTL_MS, 60_000, 5_000);
const AGENT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS = parseMinIntEnv(process.env.AGENT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS, 5 * 60_000, 30_000);

type AgentPolicyCacheRow = {
  maxConcurrentSessions: number;
  maxGoalLength: number;
  restrictedSkills: SkillId[];
};

const DEFAULT_POLICY: AgentPolicyCacheRow = {
  maxConcurrentSessions: AGENT_MAX_CONCURRENT_SESSIONS,
  maxGoalLength: AGENT_MAX_GOAL_LENGTH,
  restrictedSkills: [],
};

let policyCache = new Map<string, AgentPolicyCacheRow>();
let cacheLoadedAt = 0;
let cacheLoading: Promise<void> | null = null;
let lastPolicyCacheErrorLogAt = 0;

const POLICY_LOADING_MESSAGE = '에이전트 실행 정책을 불러오는 중입니다. 잠시 후 다시 시도해주세요.';

export type AgentPolicySnapshot = {
  maxConcurrentSessions: number;
  maxGoalLength: number;
  restrictedSkills: SkillId[];
};

export type AgentPolicyValidationResult = {
  ok: boolean;
  message: string;
};

const isCacheFresh = () => Date.now() - cacheLoadedAt < AGENT_POLICY_CACHE_TTL_MS;

const toBoundedInt = (value: unknown, fallback: number, min: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.trunc(n));
};

export const refreshAgentPolicyCache = async (): Promise<void> => {
  if (!isSupabaseConfigured()) {
    policyCache = new Map();
    cacheLoadedAt = Date.now();
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_runtime_policies')
    .select('guild_id, max_concurrent_sessions, max_goal_length, restricted_skills, enabled')
    .eq('enabled', true)
    .limit(300);

  if (error) {
    return;
  }

  const nextCache = new Map<string, AgentPolicyCacheRow>();
  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const guildId = String(row.guild_id || '').trim() || '*';
    const restrictedSkills = Array.isArray(row.restricted_skills)
      ? row.restricted_skills.map((v) => String(v || '').trim()).filter(Boolean)
      : [];

    nextCache.set(guildId, {
      maxConcurrentSessions: toBoundedInt(row.max_concurrent_sessions, AGENT_MAX_CONCURRENT_SESSIONS, 1),
      maxGoalLength: toBoundedInt(row.max_goal_length, AGENT_MAX_GOAL_LENGTH, 40),
      restrictedSkills,
    });
  }

  policyCache = nextCache;
  cacheLoadedAt = Date.now();
};

export const primeAgentPolicyCache = (): void => {
  if (cacheLoading || isCacheFresh()) {
    return;
  }

  cacheLoading = refreshAgentPolicyCache()
    .catch((error) => {
      const now = Date.now();
      if (now - lastPolicyCacheErrorLogAt >= AGENT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS) {
        lastPolicyCacheErrorLogAt = now;
        logger.warn('[AGENT-POLICY] cache refresh failed (throttled): %s', getErrorMessage(error));
      }
    })
    .finally(() => {
      cacheLoading = null;
    });
};

export const canResolveAgentPolicyForGuild = (guildId?: string): boolean => {
  primeAgentPolicyCache();

  const key = String(guildId || '').trim();
  if (key && policyCache.has(key)) {
    return true;
  }

  return !isSupabaseConfigured() || isCacheFresh();
};

export const getAgentPolicyLoadingMessage = (): string => POLICY_LOADING_MESSAGE;

export const getAgentPolicySnapshot = (guildId?: string): AgentPolicySnapshot => {
  primeAgentPolicyCache();

  const key = String(guildId || '').trim();
  const cached = (key && policyCache.get(key)) || policyCache.get('*') || DEFAULT_POLICY;
  return {
    maxConcurrentSessions: cached.maxConcurrentSessions,
    maxGoalLength: cached.maxGoalLength,
    restrictedSkills: [...cached.restrictedSkills],
  };
};

export const validateAgentSessionRequest = (params: {
  guildId?: string;
  runningSessions: number;
  goal: string;
  requestedSkillId: SkillId | null;
  isAdmin: boolean;
}): AgentPolicyValidationResult => {
  if (!canResolveAgentPolicyForGuild(params.guildId)) {
    return { ok: false, message: POLICY_LOADING_MESSAGE };
  }

  const snapshot = getAgentPolicySnapshot(params.guildId);
  const adminOnlySkills = listSkills()
    .filter((skill) => skill.adminOnly)
    .map((skill) => skill.id);
  const restrictedSkills = new Set<SkillId>([
    ...snapshot.restrictedSkills,
    ...adminOnlySkills,
  ]);

  const goal = String(params.goal || '').trim();
  if (!goal) {
    return { ok: false, message: '목표가 비어 ?�습?�다.' };
  }

  if (goal.length > snapshot.maxGoalLength) {
    return {
      ok: false,
      message: `목표 길이가 ?�무 깁니?? 최�? ${snapshot.maxGoalLength}?�까지 ?�용?�니??`,
    };
  }

  if (params.runningSessions >= snapshot.maxConcurrentSessions) {
    return {
      ok: false,
      message: `?�시 ?�행 ?�션 ?�도�?초과?�습?�다. ?�재 ?�도: ${snapshot.maxConcurrentSessions}`,
    };
  }

  if (params.requestedSkillId && restrictedSkills.has(params.requestedSkillId) && !params.isAdmin) {
    return {
      ok: false,
      message: `?�킬 ${params.requestedSkillId}?� 관리자 ?�용?�니??`,
    };
  }

  return { ok: true, message: 'OK' };
};

import { parseBooleanEnv, parseBoundedNumberEnv, parseStringEnv } from '../../utils/env';

export type AgentPriorityLike = 'fast' | 'balanced' | 'precise';

export type AgentGotPolicySnapshot = {
  strategy: string;
  shadowEnabled: boolean;
  activeEnabled: boolean;
  shadowAllowlist: string[];
  activeAllowlist: string[];
  maxNodesFast: number;
  maxNodesBalanced: number;
  maxNodesPrecise: number;
  maxEdgesFast: number;
  maxEdgesBalanced: number;
  maxEdgesPrecise: number;
  minSelectedScore: number;
};

const parseAllowlist = (value: string | undefined): string[] => {
  const normalized = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 500);
};

const isAllowedGuild = (guildId: string | undefined, allowlist: string[]): boolean => {
  if (allowlist.length === 0) {
    return true;
  }
  const normalized = String(guildId || '').trim();
  return Boolean(normalized) && allowlist.includes(normalized);
};

export const getAgentGotPolicySnapshot = (guildId?: string): AgentGotPolicySnapshot => {
  const shadowAllowlist = parseAllowlist(process.env.GOT_SHADOW_GUILD_ALLOWLIST);
  const activeAllowlist = parseAllowlist(process.env.GOT_ACTIVE_GUILD_ALLOWLIST);

  const shadowEnabled = parseBooleanEnv(process.env.GOT_SHADOW_ENABLED, false)
    && isAllowedGuild(guildId, shadowAllowlist);
  const activeEnabled = parseBooleanEnv(process.env.GOT_ACTIVE_ENABLED, false)
    && isAllowedGuild(guildId, activeAllowlist);

  return {
    strategy: parseStringEnv(process.env.GOT_STRATEGY, 'got_v1') || 'got_v1',
    shadowEnabled,
    activeEnabled,
    shadowAllowlist,
    activeAllowlist,
    maxNodesFast: parseBoundedNumberEnv(process.env.GOT_MAX_NODES_FAST, 10, 2, 200),
    maxNodesBalanced: parseBoundedNumberEnv(process.env.GOT_MAX_NODES_BALANCED, 24, 2, 200),
    maxNodesPrecise: parseBoundedNumberEnv(process.env.GOT_MAX_NODES_PRECISE, 40, 2, 200),
    maxEdgesFast: parseBoundedNumberEnv(process.env.GOT_MAX_EDGES_FAST, 20, 1, 800),
    maxEdgesBalanced: parseBoundedNumberEnv(process.env.GOT_MAX_EDGES_BALANCED, 64, 1, 800),
    maxEdgesPrecise: parseBoundedNumberEnv(process.env.GOT_MAX_EDGES_PRECISE, 120, 1, 800),
    minSelectedScore: parseBoundedNumberEnv(process.env.GOT_MIN_SELECTED_SCORE, 0.5, 0, 1),
  };
};

export const resolveGotBudgetForPriority = (
  priority: AgentPriorityLike,
  policy: AgentGotPolicySnapshot,
): { maxNodes: number; maxEdges: number } => {
  if (priority === 'fast') {
    return { maxNodes: policy.maxNodesFast, maxEdges: policy.maxEdgesFast };
  }
  if (priority === 'precise') {
    return { maxNodes: policy.maxNodesPrecise, maxEdges: policy.maxEdgesPrecise };
  }
  return { maxNodes: policy.maxNodesBalanced, maxEdges: policy.maxEdgesBalanced };
};

export const primeAgentGotPolicyCache = (): void => {
  // Reserved for DB-backed cache rollout. Current policy is env-only.
};

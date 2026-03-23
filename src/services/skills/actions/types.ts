export type ActionExecutionInput = {
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
};

export const LEGACY_AGENT_ROLES = ['openjarvis', 'opencode', 'nemoclaw', 'opendev'] as const;
export const NEUTRAL_AGENT_ROLES = ['operate', 'implement', 'review', 'architect'] as const;

export type LegacyAgentRole = (typeof LEGACY_AGENT_ROLES)[number];
export type NeutralAgentRole = (typeof NEUTRAL_AGENT_ROLES)[number];
export type AgentRole = LegacyAgentRole | NeutralAgentRole;

const NEUTRAL_TO_LEGACY_ROLE: Record<NeutralAgentRole, LegacyAgentRole> = {
  operate: 'openjarvis',
  implement: 'opencode',
  review: 'nemoclaw',
  architect: 'opendev',
};

export const normalizeAgentRole = (value: unknown, fallback: LegacyAgentRole = 'openjarvis'): LegacyAgentRole => {
  const role = String(value || '').trim().toLowerCase() as AgentRole;
  if ((LEGACY_AGENT_ROLES as readonly string[]).includes(role)) {
    return role as LegacyAgentRole;
  }
  if ((NEUTRAL_AGENT_ROLES as readonly string[]).includes(role)) {
    return NEUTRAL_TO_LEGACY_ROLE[role as NeutralAgentRole];
  }
  return fallback;
};

export const inferLegacyAgentRoleByActionName = (actionName: string): LegacyAgentRole => {
  const normalized = String(actionName || '').trim().toLowerCase();
  if (normalized.startsWith('opencode.') || normalized.startsWith('implement.')) {
    return 'opencode';
  }
  if (normalized.startsWith('nemoclaw.')
    || normalized.startsWith('review.')
    || normalized.startsWith('news.')
    || normalized.startsWith('web.')
    || normalized.startsWith('youtube.')
    || normalized.startsWith('community.')) {
    return 'nemoclaw';
  }
  if (normalized.startsWith('opendev.')
    || normalized.startsWith('architect.')
    || normalized.startsWith('db.')
    || normalized.startsWith('code.')
    || normalized.startsWith('rag.')) {
    return 'opendev';
  }
  return 'openjarvis';
};

export type ActionHandoff = {
  fromAgent: LegacyAgentRole;
  toAgent: LegacyAgentRole;
  reason?: string;
  evidenceId?: string;
};

export type ActionExecutionResult = {
  ok: boolean;
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  error?: string;
  durationMs?: number;
  agentRole?: LegacyAgentRole;
  handoff?: ActionHandoff;
};

export type ActionDefinition = {
  name: string;
  description: string;
  /** When true, this action runs without LLM — subprocess exit code drives pass/fail. */
  deterministic?: boolean;
  execute: (input: ActionExecutionInput) => Promise<ActionExecutionResult>;
};

export type ActionPlan = {
  actionName: string;
  args: Record<string, unknown>;
  reason?: string;
};

export type ActionChainPlan = {
  actions: ActionPlan[];
};

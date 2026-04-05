export type ActionExecutionInput = {
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
};

/** Canonical agent role names — neutral, function-based labels. */
export const AGENT_ROLES = ['operate', 'implement', 'review', 'architect'] as const;
export type AgentRoleName = (typeof AGENT_ROLES)[number];

/** Legacy role names kept for backward compatibility (stored DB data, env vars). */
export const LEGACY_AGENT_ROLES = ['openjarvis', 'opencode', 'nemoclaw', 'opendev'] as const;
export type LegacyAgentRole = (typeof LEGACY_AGENT_ROLES)[number];

/** Union of canonical + legacy names — use for input acceptance only. */
export type AgentRole = AgentRoleName | LegacyAgentRole;

const LEGACY_TO_NEUTRAL_ROLE: Record<LegacyAgentRole, AgentRoleName> = {
  openjarvis: 'operate',
  opencode: 'implement',
  nemoclaw: 'review',
  opendev: 'architect',
};

/**
 * Normalize any agent role input (legacy or neutral) to canonical neutral name.
 * Accepts both legacy ('openjarvis') and neutral ('operate') names.
 */
export const normalizeAgentRole = (value: unknown, fallback: AgentRoleName = 'operate'): AgentRoleName => {
  const role = String(value || '').trim().toLowerCase();
  if ((AGENT_ROLES as readonly string[]).includes(role)) {
    return role as AgentRoleName;
  }
  if ((LEGACY_AGENT_ROLES as readonly string[]).includes(role)) {
    return LEGACY_TO_NEUTRAL_ROLE[role as LegacyAgentRole];
  }
  return fallback;
};

export function inferAgentRoleByActionName(actionName: string): AgentRoleName {
  const normalized = String(actionName || '').trim().toLowerCase();
  if (normalized.startsWith('opencode.') || normalized.startsWith('implement.')) {
    return 'implement';
  }
  if (normalized.startsWith('nemoclaw.')
    || normalized.startsWith('review.')
    || normalized.startsWith('news.')
    || normalized.startsWith('web.')
    || normalized.startsWith('youtube.')
    || normalized.startsWith('community.')) {
    return 'review';
  }
  if (normalized.startsWith('opendev.')
    || normalized.startsWith('architect.')
    || normalized.startsWith('db.')
    || normalized.startsWith('code.')
    || normalized.startsWith('rag.')) {
    return 'architect';
  }
  return 'operate';
}

export type ActionHandoff = {
  fromAgent: AgentRoleName;
  toAgent: AgentRoleName;
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
  agentRole?: AgentRoleName;
  handoff?: ActionHandoff;
};

/** Tool parameter specification for prompt generation. */
export type ActionParameterSpec = {
  name: string;
  required: boolean;
  description: string;
  example?: string;
};

/** Action categories for grouping in prompts and UI. */
export type ActionCategory =
  | 'agent'     // multi-agent collaboration / routing
  | 'data'      // data retrieval (RAG, DB, search)
  | 'finance'   // stock, trading, analysis
  | 'content'   // news, youtube, community
  | 'code'      // code generation, execution
  | 'ops'       // privacy, governance, release
  | 'automation' // n8n workflows, delegation tasks
  | 'tool';     // CLI tools, web fetch

export type ActionDefinition = {
  name: string;
  description: string;
  /** Action category for prompt grouping and phase-based tool filtering. */
  category: ActionCategory;
  /** Parameter specs — single source of truth for prompt generation. */
  parameters?: ActionParameterSpec[];
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

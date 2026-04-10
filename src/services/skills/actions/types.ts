export type ActionExecutionInput = {
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
};

export type ActionReflectionArtifact = {
  type: 'obsidian_reflection';
  plane: string;
  concern: string;
  nextPath: string;
  customerImpact: boolean;
};

export const ACTION_REFLECTION_ARTIFACT_PREFIX = 'reflection=';

/** Canonical agent role names — neutral, function-based labels. */
export const AGENT_ROLES = ['operate', 'implement', 'review', 'architect'] as const;
export type AgentRoleName = (typeof AGENT_ROLES)[number];

/** Legacy role names kept for backward compatibility (stored DB data, env vars). */
export const LEGACY_AGENT_ROLES = ['openjarvis', 'opencode', 'nemoclaw', 'opendev'] as const;
export type LegacyAgentRole = (typeof LEGACY_AGENT_ROLES)[number];

/** Union of canonical + legacy names — use for input acceptance only. */
export type AgentRole = AgentRoleName | LegacyAgentRole;

export const EXECUTOR_ACTION_CANONICAL_NAME = 'implement.execute' as const;
export const EXECUTOR_ACTION_LEGACY_NAME = 'opencode.execute' as const;
export const EXECUTOR_ACTION_ALIASES = [EXECUTOR_ACTION_CANONICAL_NAME, EXECUTOR_ACTION_LEGACY_NAME] as const;
export type ExecutorActionName = (typeof EXECUTOR_ACTION_ALIASES)[number];

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

export const isExecutorActionName = (value: unknown): value is ExecutorActionName => {
  const actionName = String(value || '').trim().toLowerCase();
  return (EXECUTOR_ACTION_ALIASES as readonly string[]).includes(actionName);
};

export const canonicalizeActionName = (value: unknown): string => {
  const actionName = String(value || '').trim();
  if (!actionName) {
    return '';
  }
  return isExecutorActionName(actionName)
    ? EXECUTOR_ACTION_CANONICAL_NAME
    : actionName;
};

export const expandActionNameAliases = (value: unknown): string[] => {
  const actionName = String(value || '').trim();
  if (!actionName) {
    return [];
  }
  return isExecutorActionName(actionName)
    ? [...EXECUTOR_ACTION_ALIASES]
    : [actionName];
};

export const normalizeActionNameList = (values: Iterable<unknown>): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const actionName = canonicalizeActionName(value);
    if (!actionName || seen.has(actionName)) {
      continue;
    }
    seen.add(actionName);
    normalized.push(actionName);
  }

  return normalized;
};

export const buildActionReflectionArtifact = (value: Omit<ActionReflectionArtifact, 'type'>): string => {
  return `${ACTION_REFLECTION_ARTIFACT_PREFIX}${JSON.stringify({
    type: 'obsidian_reflection',
    plane: String(value.plane || '').trim() || 'none',
    concern: String(value.concern || '').trim() || 'none',
    nextPath: String(value.nextPath || '').trim() || 'none',
    customerImpact: Boolean(value.customerImpact),
  })}`;
};

export const parseActionReflectionArtifact = (value: unknown): ActionReflectionArtifact | null => {
  const text = String(value || '').trim();
  if (!text.startsWith(ACTION_REFLECTION_ARTIFACT_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(ACTION_REFLECTION_ARTIFACT_PREFIX.length)) as Record<string, unknown>;
    if (parsed.type !== 'obsidian_reflection') {
      return null;
    }

    const plane = String(parsed.plane || '').trim();
    const concern = String(parsed.concern || '').trim();
    const nextPath = String(parsed.nextPath || '').trim();
    if (!plane || !concern || !nextPath) {
      return null;
    }

    return {
      type: 'obsidian_reflection',
      plane,
      concern,
      nextPath,
      customerImpact: Boolean(parsed.customerImpact),
    };
  } catch {
    return null;
  }
};

export const findActionReflectionArtifact = (values: Iterable<unknown>): ActionReflectionArtifact | null => {
  for (const value of values) {
    const parsed = parseActionReflectionArtifact(value);
    if (parsed) {
      return parsed;
    }
  }
  return null;
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

/**
 * Shared helpers for agent collaboration actions.
 * Extracted from agentCollab.ts to enable domain-scoped action files.
 */
import {
  recommendSuperAgent,
  startSuperAgentSessionFromTask,
  type SuperAgentLeadAgent,
  type SuperAgentTaskInput,
} from '../../superAgentService';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { runDelegatedAction } from './mcpDelegatedAction';
import type { ActionExecutionResult, AgentRoleName } from './types';

export const MAX_ARTIFACT_CHARS = 3200;
export const MAX_PROMPT_CODE_CHARS = 1800;

export const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

export const clip = (value: unknown, max = MAX_ARTIFACT_CHARS): string => String(value || '').slice(0, max);

export const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)).filter(Boolean);
  }
  const single = compact(value);
  return single ? [single] : [];
};

export const toBoolean = (value: unknown, fallback = false): boolean => {
  const normalized = compact(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

export const toJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const resolveGoal = (goal: string, args?: Record<string, unknown>): string => {
  const query = compact(args?.query);
  return query || compact(goal);
};

export const resolveGuildId = (guildId?: string, args?: Record<string, unknown>): string => {
  return compact(guildId) || compact(args?.guildId) || 'local-ide';
};

export const createTaskInput = (params: {
  goal: string;
  guildId?: string;
  args?: Record<string, unknown>;
  requestedLeadAgent?: SuperAgentLeadAgent;
}): SuperAgentTaskInput => {
  return {
    task_id: compact(params.args?.taskId) || `task-${Date.now()}`,
    guild_id: resolveGuildId(params.guildId, params.args),
    objective: params.goal,
    constraints: toStringList(params.args?.constraints),
    acceptance_criteria: toStringList(params.args?.acceptanceCriteria),
    inputs: params.args?.inputs ?? {},
    budget: params.args?.budget ?? {},
    route_mode: compact(params.args?.routeMode) || null,
    requested_lead_agent: params.requestedLeadAgent || compact(params.args?.requestedLeadAgent) || null,
    current_stage: compact(params.args?.currentStage) || null,
    changed_files: toStringList(params.args?.changedFiles),
  };
};

export const leadAgentToRole = (value: string): AgentRoleName => {
  const normalized = compact(value).toLowerCase();
  if (normalized === 'opencode' || normalized === 'implement') return 'implement';
  if (normalized === 'opendev' || normalized === 'architect') return 'architect';
  if (normalized === 'nemoclaw' || normalized === 'review') return 'review';
  return 'operate';
};

export const roleToLeadAgent = (value: AgentRoleName): SuperAgentLeadAgent => {
  if (value === 'implement') return 'Implement';
  if (value === 'architect') return 'Architect';
  if (value === 'review') return 'Review';
  return 'Operate';
};

export const withRouting = (
  result: ActionExecutionResult,
  toAgent: AgentRoleName,
  reason: string,
  evidenceId?: string,
): ActionExecutionResult => ({
  ...result,
  handoff: result.handoff || {
    fromAgent: 'operate',
    toAgent,
    reason,
    evidenceId,
  },
});

export const renderRecommendation = (recommendation: ReturnType<typeof recommendSuperAgent>): string => {
  const consults = recommendation.route.consult_agents.length > 0
    ? recommendation.route.consult_agents.map((item) => `- ${item.name} (${item.timing}): ${item.reason}`).join('\n')
    : '- none';

  return [
    '# Route',
    `- mode: ${recommendation.route.mode}`,
    `- lead_agent: ${recommendation.route.lead_agent.name}`,
    `- lead_reason: ${recommendation.route.lead_agent.reason}`,
    '',
    '# Consult Agents',
    consults,
    '',
    '# Required Gates',
    ...recommendation.route.required_gates.map((item) => `- ${item}`),
    '',
    '# Handoff',
    `- next_owner: ${recommendation.route.handoff.next_owner}`,
    `- expected_outcome: ${recommendation.route.handoff.expected_outcome}`,
    '',
    '# Escalation',
    `- required: ${recommendation.route.escalation.required}`,
    `- target_mode: ${recommendation.route.escalation.target_mode}`,
    `- reason: ${recommendation.route.escalation.reason}`,
    '',
    '# Next Action',
    `- ${recommendation.route.next_action}`,
  ].join('\n');
};

export const maybeGenerateRoleText = async (params: {
  enabled: boolean;
  actionName: string;
  system: string;
  user: string;
  fallback: string;
}): Promise<string> => {
  if (!params.enabled) {
    return params.fallback;
  }

  try {
    const raw = await generateText({
      system: params.system,
      user: params.user,
      actionName: params.actionName,
      temperature: 0.2,
      maxTokens: 1000,
    });
    return compact(raw) ? clip(raw) : params.fallback;
  } catch {
    return params.fallback;
  }
};

export const tryParseDelegatedActionResult = (blocks: string[]): ActionExecutionResult | null => {
  const first = String(blocks[0] || '').trim();
  if (!first) {
    return null;
  }
  try {
    const parsed = JSON.parse(first) as Partial<ActionExecutionResult>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean' || typeof parsed.name !== 'string') {
      return null;
    }
    return {
      ok: parsed.ok,
      name: parsed.name,
      summary: String(parsed.summary || '').trim() || parsed.name,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map((item) => String(item || '')) : [],
      verification: Array.isArray(parsed.verification) ? parsed.verification.map((item) => String(item || '')) : [],
      error: parsed.error ? String(parsed.error) : undefined,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      agentRole: parsed.agentRole,
      handoff: parsed.handoff,
    };
  } catch {
    return null;
  }
};

const getActiveWorkerRole = (): string => String(process.env.AGENT_ROLE_WORKER_ROLE || '').trim().toLowerCase();

export const maybeDelegateAgentAction = async (params: {
  actionName: string;
  workerKind: 'coordinate' | 'architect' | 'review' | 'operate' | 'local-orchestrator' | 'opendev' | 'nemoclaw' | 'openjarvis';
  toolName: string;
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
}): Promise<ActionExecutionResult | null> => {
  if (getActiveWorkerRole() === params.workerKind) {
    return null;
  }

  return runDelegatedAction({
    actionName: params.actionName,
    workerKind: params.workerKind,
    toolName: params.toolName,
    args: {
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      ...(params.args || {}),
    },
    successSummary: (blocks) => {
      const parsed = tryParseDelegatedActionResult(blocks);
      return parsed?.summary || compact(blocks[0] || '') || `${params.actionName} delegated`;
    },
    strictFailureSummary: `${params.actionName} worker delegation failed`,
    strictFailureVerification: ['mcp strict routing', `${params.workerKind} delegation failed`],
    strictFailureError: `${params.actionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_DELEGATION_FAILED`,
    parseStructuredResult: tryParseDelegatedActionResult,
    onWorkerMissing: () => null,
    onEmptyResult: () => ({
      ok: false,
      name: params.actionName,
      summary: `${params.actionName} worker returned empty result`,
      artifacts: [],
      verification: ['delegated result empty'],
      error: `${params.actionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_EMPTY_RESULT`,
    }),
  });
};

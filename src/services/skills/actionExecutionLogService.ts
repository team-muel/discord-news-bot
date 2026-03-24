import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import { inferAgentRoleByActionName, normalizeAgentRole, type AgentRoleName } from './actions/types';

type AgentRole = AgentRoleName;

type ActionHandoff = {
  fromAgent: AgentRole;
  toAgent: AgentRole;
  reason?: string;
  evidenceId?: string;
};

export type ActionExecutionLogEvent = {
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  ok: boolean;
  summary: string;
  artifacts: string[];
  verification: string[];
  durationMs: number;
  retryCount: number;
  circuitOpen: boolean;
  error?: string;
  estimatedCostUsd?: number;
  finopsMode?: 'normal' | 'degraded' | 'blocked';
  agentRole?: AgentRole;
  handoff?: ActionHandoff;
};

const appendRoutingVerification = (event: ActionExecutionLogEvent): string[] => {
  const lines = [...(Array.isArray(event.verification) ? event.verification : [])];
  const effectiveRole = event.agentRole ? normalizeAgentRole(event.agentRole) : inferAgentRoleByActionName(event.actionName);
  lines.push(`agent_role=${effectiveRole}`);

  const handoff = event.handoff;
  if (handoff && handoff.fromAgent && handoff.toAgent) {
    lines.push(`handoff=${handoff.fromAgent}->${handoff.toAgent}`);
    if (handoff.reason) {
      lines.push(`handoff_reason=${String(handoff.reason).slice(0, 120)}`);
    }
    if (handoff.evidenceId) {
      lines.push(`handoff_evidence=${String(handoff.evidenceId).slice(0, 120)}`);
    }
  }

  return [...new Set(lines.filter((line) => String(line || '').trim().length > 0))];
};

export const logActionExecutionEvent = async (event: ActionExecutionLogEvent) => {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const verification = appendRoutingVerification(event);
    await client.from('agent_action_logs').insert({
      guild_id: event.guildId,
      requested_by: event.requestedBy,
      goal: String(event.goal || '').slice(0, 1200),
      action_name: event.actionName,
      status: event.ok ? 'success' : 'failed',
      summary: String(event.summary || '').slice(0, 1200),
      artifacts: event.artifacts,
      verification,
      duration_ms: Math.max(0, Math.trunc(event.durationMs || 0)),
      retry_count: Math.max(0, Math.trunc(event.retryCount || 0)),
      circuit_open: Boolean(event.circuitOpen),
      estimated_cost_usd: typeof event.estimatedCostUsd === 'number' ? Math.max(0, Number(event.estimatedCostUsd)) : null,
      finops_mode: event.finopsMode || null,
      error: event.error || null,
    });
  } catch {
    // Logging must never break user flow.
  }
};

import { parseIntegerEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

export type AgentRetentionPolicySnapshot = {
  guildId: string;
  actionLogDays: number;
  memoryDays: number;
  socialGraphDays: number;
  conversationDays: number;
  approvalRequestDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
  source: 'default' | 'stored';
};

const RETENTION_TABLE = String(process.env.AGENT_RETENTION_POLICY_TABLE || 'agent_retention_policies').trim();
const DEFAULT_ACTION_LOG_DAYS = Math.max(1, parseIntegerEnv(process.env.AGENT_ACTION_LOG_RETENTION_DAYS, 90));
const DEFAULT_MEMORY_DAYS = Math.max(1, parseIntegerEnv(process.env.AGENT_MEMORY_RETENTION_DAYS, 180));
const DEFAULT_SOCIAL_GRAPH_DAYS = Math.max(1, parseIntegerEnv(process.env.AGENT_SOCIAL_GRAPH_RETENTION_DAYS, 180));
const DEFAULT_CONVERSATION_DAYS = Math.max(1, parseIntegerEnv(process.env.AGENT_CONVERSATION_RETENTION_DAYS, 90));
const DEFAULT_APPROVAL_REQUEST_DAYS = Math.max(1, parseIntegerEnv(process.env.AGENT_APPROVAL_RETENTION_DAYS, 30));

const MAX_POLICY_CACHE_ENTRIES = 300;
const memoryPolicies = new Map<string, AgentRetentionPolicySnapshot>();

const nowIso = () => new Date().toISOString();

import { isMissingTableError } from '../../utils/supabaseErrors';

const clampDays = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(3650, Math.trunc(numeric)));
};

const buildDefaultPolicy = (guildId: string): AgentRetentionPolicySnapshot => ({
  guildId,
  actionLogDays: DEFAULT_ACTION_LOG_DAYS,
  memoryDays: DEFAULT_MEMORY_DAYS,
  socialGraphDays: DEFAULT_SOCIAL_GRAPH_DAYS,
  conversationDays: DEFAULT_CONVERSATION_DAYS,
  approvalRequestDays: DEFAULT_APPROVAL_REQUEST_DAYS,
  updatedAt: null,
  updatedBy: null,
  source: 'default',
});

const normalizePolicy = (row: Record<string, unknown>, fallback: AgentRetentionPolicySnapshot): AgentRetentionPolicySnapshot => ({
  guildId: String(row.guild_id || fallback.guildId).trim() || fallback.guildId,
  actionLogDays: clampDays(row.action_log_days, fallback.actionLogDays),
  memoryDays: clampDays(row.memory_days, fallback.memoryDays),
  socialGraphDays: clampDays(row.social_graph_days, fallback.socialGraphDays),
  conversationDays: clampDays(row.conversation_days, fallback.conversationDays),
  approvalRequestDays: clampDays(row.approval_request_days, fallback.approvalRequestDays),
  updatedAt: row.updated_at ? String(row.updated_at) : fallback.updatedAt,
  updatedBy: row.updated_by ? String(row.updated_by) : fallback.updatedBy,
  source: 'stored',
});

export const getAgentRetentionPolicySnapshot = async (guildIdInput?: string): Promise<AgentRetentionPolicySnapshot> => {
  const guildId = String(guildIdInput || '*').trim() || '*';
  const fallback = buildDefaultPolicy(guildId);

  if (!isSupabaseConfigured()) {
    return memoryPolicies.get(guildId) || fallback;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(RETENTION_TABLE)
      .select('guild_id, action_log_days, memory_days, social_graph_days, conversation_days, approval_request_days, updated_at, updated_by')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return fallback;
      }
      return memoryPolicies.get(guildId) || fallback;
    }

    if (!data) {
      return fallback;
    }

    return normalizePolicy(data as Record<string, unknown>, fallback);
  } catch {
    return memoryPolicies.get(guildId) || fallback;
  }
};

export const upsertAgentRetentionPolicy = async (params: {
  guildId: string;
  actionLogDays?: number;
  memoryDays?: number;
  socialGraphDays?: number;
  conversationDays?: number;
  approvalRequestDays?: number;
  updatedBy?: string;
}): Promise<AgentRetentionPolicySnapshot> => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const current = await getAgentRetentionPolicySnapshot(guildId);
  const policy: AgentRetentionPolicySnapshot = {
    guildId,
    actionLogDays: clampDays(params.actionLogDays, current.actionLogDays),
    memoryDays: clampDays(params.memoryDays, current.memoryDays),
    socialGraphDays: clampDays(params.socialGraphDays, current.socialGraphDays),
    conversationDays: clampDays(params.conversationDays, current.conversationDays),
    approvalRequestDays: clampDays(params.approvalRequestDays, current.approvalRequestDays),
    updatedAt: nowIso(),
    updatedBy: params.updatedBy || current.updatedBy,
    source: 'stored',
  };

  memoryPolicies.set(guildId, policy);
  if (memoryPolicies.size > MAX_POLICY_CACHE_ENTRIES) {
    const first = memoryPolicies.keys().next().value;
    if (first !== undefined) memoryPolicies.delete(first);
  }

  if (!isSupabaseConfigured()) {
    return policy;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(RETENTION_TABLE)
    .upsert({
      guild_id: guildId,
      action_log_days: policy.actionLogDays,
      memory_days: policy.memoryDays,
      social_graph_days: policy.socialGraphDays,
      conversation_days: policy.conversationDays,
      approval_request_days: policy.approvalRequestDays,
      updated_by: policy.updatedBy,
      updated_at: policy.updatedAt,
    }, { onConflict: 'guild_id' })
    .select('guild_id, action_log_days, memory_days, social_graph_days, conversation_days, approval_request_days, updated_at, updated_by')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return policy;
    }
    throw new Error(error.message || 'RETENTION_POLICY_UPSERT_FAILED');
  }

  return normalizePolicy(data as Record<string, unknown>, policy);
};

export const __resetRetentionPolicyMemoryForTests = (): void => {
  memoryPolicies.clear();
};
import crypto from 'crypto';
import { parseIntegerEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

export type ActionRunMode = 'auto' | 'approval_required' | 'disabled';
export type ActionApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type GuildActionPolicy = {
  guildId: string;
  actionName: string;
  enabled: boolean;
  runMode: ActionRunMode;
  updatedAt: string;
  updatedBy: string | null;
};

export type ActionApprovalRequest = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  actionArgs: Record<string, unknown>;
  status: ActionApprovalStatus;
  reason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  expiresAt: string;
};

const ACTION_POLICY_TABLE = String(process.env.ACTION_POLICY_TABLE || 'agent_action_policies').trim();
const ACTION_APPROVAL_TABLE = String(process.env.ACTION_APPROVAL_TABLE || 'agent_action_approval_requests').trim();
const ACTION_APPROVAL_TTL_MS = Math.max(60_000, parseIntegerEnv(process.env.ACTION_APPROVAL_TTL_MS, 60 * 60 * 1000));

const memoryPolicies = new Map<string, GuildActionPolicy>();
const memoryApprovals = new Map<string, ActionApprovalRequest>();

const toPolicyKey = (guildId: string, actionName: string): string => `${guildId}::${actionName}`;

const nowIso = () => new Date().toISOString();

export const isActionRunMode = (value: string): value is ActionRunMode => {
  return value === 'auto' || value === 'approval_required' || value === 'disabled';
};

const normalizePolicyRow = (row: any): GuildActionPolicy => {
  const runModeRaw = String(row?.run_mode || 'auto').trim();
  const runMode: ActionRunMode = isActionRunMode(runModeRaw) ? runModeRaw : 'auto';
  return {
    guildId: String(row?.guild_id || '').trim(),
    actionName: String(row?.action_name || '').trim(),
    enabled: row?.enabled !== false,
    runMode,
    updatedAt: String(row?.updated_at || nowIso()),
    updatedBy: row?.updated_by ? String(row.updated_by) : null,
  };
};

const normalizeApprovalRow = (row: any): ActionApprovalRequest => {
  const statusRaw = String(row?.status || 'pending').trim();
  const status: ActionApprovalStatus = ['pending', 'approved', 'rejected', 'expired'].includes(statusRaw)
    ? (statusRaw as ActionApprovalStatus)
    : 'pending';

  return {
    id: String(row?.id || crypto.randomUUID()),
    guildId: String(row?.guild_id || '').trim(),
    requestedBy: String(row?.requested_by || '').trim(),
    goal: String(row?.goal || '').trim(),
    actionName: String(row?.action_name || '').trim(),
    actionArgs: row?.action_args && typeof row.action_args === 'object' && !Array.isArray(row.action_args)
      ? row.action_args
      : {},
    status,
    reason: row?.reason ? String(row.reason) : null,
    approvedBy: row?.approved_by ? String(row.approved_by) : null,
    approvedAt: row?.approved_at ? String(row.approved_at) : null,
    createdAt: String(row?.created_at || nowIso()),
    expiresAt: String(row?.expires_at || nowIso()),
  };
};

export const getGuildActionPolicy = async (guildId: string, actionName: string): Promise<GuildActionPolicy> => {
  const fallback: GuildActionPolicy = {
    guildId,
    actionName,
    enabled: true,
    runMode: 'auto',
    updatedAt: nowIso(),
    updatedBy: null,
  };

  if (!guildId || !actionName) {
    return fallback;
  }

  if (!isSupabaseConfigured()) {
    return memoryPolicies.get(toPolicyKey(guildId, actionName)) || fallback;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(ACTION_POLICY_TABLE)
      .select('guild_id, action_name, enabled, run_mode, updated_at, updated_by')
      .eq('guild_id', guildId)
      .eq('action_name', actionName)
      .maybeSingle();

    if (error || !data) {
      return fallback;
    }

    return normalizePolicyRow(data);
  } catch {
    return fallback;
  }
};

export const listGuildActionPolicies = async (guildId: string): Promise<GuildActionPolicy[]> => {
  if (!guildId) {
    return [];
  }

  if (!isSupabaseConfigured()) {
    return [...memoryPolicies.values()].filter((row) => row.guildId === guildId);
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(ACTION_POLICY_TABLE)
      .select('guild_id, action_name, enabled, run_mode, updated_at, updated_by')
      .eq('guild_id', guildId)
      .order('action_name', { ascending: true })
      .limit(200);

    if (error || !data) {
      return [];
    }

    return (data as any[]).map((row) => normalizePolicyRow(row));
  } catch {
    return [];
  }
};

export const upsertGuildActionPolicy = async (params: {
  guildId: string;
  actionName: string;
  enabled: boolean;
  runMode: ActionRunMode;
  actorId: string;
}): Promise<GuildActionPolicy> => {
  const row: GuildActionPolicy = {
    guildId: params.guildId,
    actionName: params.actionName,
    enabled: params.enabled,
    runMode: params.runMode,
    updatedAt: nowIso(),
    updatedBy: params.actorId,
  };

  if (!isSupabaseConfigured()) {
    memoryPolicies.set(toPolicyKey(row.guildId, row.actionName), row);
    return row;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(ACTION_POLICY_TABLE)
    .upsert({
      guild_id: row.guildId,
      action_name: row.actionName,
      enabled: row.enabled,
      run_mode: row.runMode,
      updated_by: row.updatedBy,
      updated_at: row.updatedAt,
    }, {
      onConflict: 'guild_id,action_name',
    })
    .select('guild_id, action_name, enabled, run_mode, updated_at, updated_by')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'ACTION_POLICY_UPSERT_FAILED');
  }

  return normalizePolicyRow(data);
};

export const createActionApprovalRequest = async (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  actionArgs: Record<string, unknown>;
  reason?: string;
}): Promise<ActionApprovalRequest> => {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ACTION_APPROVAL_TTL_MS).toISOString();
  const request: ActionApprovalRequest = {
    id: crypto.randomUUID(),
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: String(params.goal || '').slice(0, 2000),
    actionName: params.actionName,
    actionArgs: params.actionArgs || {},
    status: 'pending',
    reason: params.reason ? String(params.reason) : null,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    expiresAt,
  };

  if (!isSupabaseConfigured()) {
    memoryApprovals.set(request.id, request);
    return request;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(ACTION_APPROVAL_TABLE)
      .insert({
        id: request.id,
        guild_id: request.guildId,
        requested_by: request.requestedBy,
        goal: request.goal,
        action_name: request.actionName,
        action_args: request.actionArgs,
        status: request.status,
        reason: request.reason,
        created_at: request.createdAt,
        expires_at: request.expiresAt,
      })
      .select('*')
      .single();

    if (error || !data) {
      memoryApprovals.set(request.id, request);
      return request;
    }

    return normalizeApprovalRow(data);
  } catch {
    memoryApprovals.set(request.id, request);
    return request;
  }
};

export const listActionApprovalRequests = async (params: {
  guildId: string;
  status?: ActionApprovalStatus;
  limit?: number;
}): Promise<ActionApprovalRequest[]> => {
  const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 30)));

  if (!isSupabaseConfigured()) {
    return [...memoryApprovals.values()]
      .filter((row) => row.guildId === params.guildId)
      .filter((row) => !params.status || row.status === params.status)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  try {
    const client = getSupabaseClient();
    let query = client
      .from(ACTION_APPROVAL_TABLE)
      .select('*')
      .eq('guild_id', params.guildId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (params.status) {
      query = query.eq('status', params.status);
    }

    const { data, error } = await query;
    if (error || !data) {
      return [];
    }

    return (data as any[]).map((row) => normalizeApprovalRow(row));
  } catch {
    return [];
  }
};

export const decideActionApprovalRequest = async (params: {
  requestId: string;
  decision: 'approve' | 'reject';
  actorId: string;
  reason?: string;
}): Promise<ActionApprovalRequest | null> => {
  const status: ActionApprovalStatus = params.decision === 'approve' ? 'approved' : 'rejected';
  const decidedAt = nowIso();

  if (!isSupabaseConfigured()) {
    const row = memoryApprovals.get(params.requestId);
    if (!row) {
      return null;
    }
    if (row.status !== 'pending') {
      return row;
    }

    const next: ActionApprovalRequest = {
      ...row,
      status,
      approvedBy: params.actorId,
      approvedAt: decidedAt,
      reason: params.reason ? String(params.reason) : row.reason,
    };
    memoryApprovals.set(params.requestId, next);
    return next;
  }

  try {
    const client = getSupabaseClient();
    const { data: existing } = await client
      .from(ACTION_APPROVAL_TABLE)
      .select('*')
      .eq('id', params.requestId)
      .maybeSingle();

    if (!existing) {
      return null;
    }

    if (String(existing.status) !== 'pending') {
      return normalizeApprovalRow(existing);
    }

    const { data, error } = await client
      .from(ACTION_APPROVAL_TABLE)
      .update({
        status,
        approved_by: params.actorId,
        approved_at: decidedAt,
        reason: params.reason ? String(params.reason) : existing.reason,
      })
      .eq('id', params.requestId)
      .select('*')
      .single();

    if (error || !data) {
      return null;
    }

    return normalizeApprovalRow(data);
  } catch {
    return null;
  }
};

import { parseBooleanEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

export type AgentUserConsentSnapshot = {
  guildId: string;
  userId: string;
  memoryEnabled: boolean;
  socialGraphEnabled: boolean;
  profilingEnabled: boolean;
  actionAuditDisclosureEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  source: 'default' | 'stored';
};

const CONSENT_TABLE = String(process.env.AGENT_USER_CONSENT_TABLE || 'agent_user_privacy_preferences').trim();
const REQUIRE_EXPLICIT_CONSENT = parseBooleanEnv(process.env.AGENT_REQUIRE_EXPLICIT_CONSENT, false);
const DEFAULT_MEMORY_ENABLED = parseBooleanEnv(process.env.AGENT_CONSENT_DEFAULT_MEMORY_ENABLED, !REQUIRE_EXPLICIT_CONSENT);
const DEFAULT_SOCIAL_GRAPH_ENABLED = parseBooleanEnv(process.env.AGENT_CONSENT_DEFAULT_SOCIAL_GRAPH_ENABLED, !REQUIRE_EXPLICIT_CONSENT);
const DEFAULT_PROFILING_ENABLED = parseBooleanEnv(process.env.AGENT_CONSENT_DEFAULT_PROFILING_ENABLED, !REQUIRE_EXPLICIT_CONSENT);
const DEFAULT_ACTION_AUDIT_DISCLOSURE_ENABLED = parseBooleanEnv(process.env.AGENT_CONSENT_DEFAULT_ACTION_AUDIT_DISCLOSURE_ENABLED, true);

const MAX_CONSENT_CACHE_ENTRIES = 500;
const memoryConsent = new Map<string, AgentUserConsentSnapshot>();

const nowIso = () => new Date().toISOString();

const toConsentKey = (guildId: string, userId: string) => `${guildId}::${userId}`;

import { isMissingTableError } from '../../utils/supabaseErrors';

const buildDefaultSnapshot = (guildId: string, userId: string): AgentUserConsentSnapshot => ({
  guildId,
  userId,
  memoryEnabled: DEFAULT_MEMORY_ENABLED,
  socialGraphEnabled: DEFAULT_SOCIAL_GRAPH_ENABLED,
  profilingEnabled: DEFAULT_PROFILING_ENABLED,
  actionAuditDisclosureEnabled: DEFAULT_ACTION_AUDIT_DISCLOSURE_ENABLED,
  updatedAt: null,
  updatedBy: null,
  source: 'default',
});

const normalizeSnapshot = (row: Record<string, unknown>, fallback: AgentUserConsentSnapshot): AgentUserConsentSnapshot => ({
  guildId: String(row.guild_id || fallback.guildId).trim() || fallback.guildId,
  userId: String(row.user_id || fallback.userId).trim() || fallback.userId,
  memoryEnabled: row.memory_enabled === true,
  socialGraphEnabled: row.social_graph_enabled === true,
  profilingEnabled: row.profiling_enabled === true,
  actionAuditDisclosureEnabled: row.action_audit_disclosure_enabled === true,
  updatedAt: row.updated_at ? String(row.updated_at) : fallback.updatedAt,
  updatedBy: row.updated_by ? String(row.updated_by) : fallback.updatedBy,
  source: 'stored',
});

export const getUserConsentSnapshot = async (params: {
  guildId: string;
  userId: string;
}): Promise<AgentUserConsentSnapshot> => {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  const fallback = buildDefaultSnapshot(guildId, userId);

  if (!guildId || !userId) {
    return fallback;
  }

  if (!isSupabaseConfigured()) {
    return memoryConsent.get(toConsentKey(guildId, userId)) || fallback;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(CONSENT_TABLE)
      .select('guild_id, user_id, memory_enabled, social_graph_enabled, profiling_enabled, action_audit_disclosure_enabled, updated_at, updated_by')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return fallback;
      }
      return memoryConsent.get(toConsentKey(guildId, userId)) || fallback;
    }

    if (!data) {
      return fallback;
    }

    return normalizeSnapshot(data as Record<string, unknown>, fallback);
  } catch {
    return memoryConsent.get(toConsentKey(guildId, userId)) || fallback;
  }
};

export const upsertUserConsentSnapshot = async (params: {
  guildId: string;
  userId: string;
  memoryEnabled?: boolean;
  socialGraphEnabled?: boolean;
  profilingEnabled?: boolean;
  actionAuditDisclosureEnabled?: boolean;
  updatedBy?: string;
}): Promise<AgentUserConsentSnapshot> => {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  if (!guildId || !userId) {
    throw new Error('VALIDATION');
  }

  const current = await getUserConsentSnapshot({ guildId, userId });
  const snapshot: AgentUserConsentSnapshot = {
    guildId,
    userId,
    memoryEnabled: params.memoryEnabled ?? current.memoryEnabled,
    socialGraphEnabled: params.socialGraphEnabled ?? current.socialGraphEnabled,
    profilingEnabled: params.profilingEnabled ?? current.profilingEnabled,
    actionAuditDisclosureEnabled: params.actionAuditDisclosureEnabled ?? current.actionAuditDisclosureEnabled,
    updatedAt: nowIso(),
    updatedBy: params.updatedBy || current.updatedBy,
    source: 'stored',
  };

  memoryConsent.set(toConsentKey(guildId, userId), snapshot);
  if (memoryConsent.size > MAX_CONSENT_CACHE_ENTRIES) {
    const first = memoryConsent.keys().next().value;
    if (first !== undefined) memoryConsent.delete(first);
  }

  if (!isSupabaseConfigured()) {
    return snapshot;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(CONSENT_TABLE)
    .upsert({
      guild_id: guildId,
      user_id: userId,
      memory_enabled: snapshot.memoryEnabled,
      social_graph_enabled: snapshot.socialGraphEnabled,
      profiling_enabled: snapshot.profilingEnabled,
      action_audit_disclosure_enabled: snapshot.actionAuditDisclosureEnabled,
      updated_by: snapshot.updatedBy,
      updated_at: snapshot.updatedAt,
    }, { onConflict: 'guild_id,user_id' })
    .select('guild_id, user_id, memory_enabled, social_graph_enabled, profiling_enabled, action_audit_disclosure_enabled, updated_at, updated_by')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return snapshot;
    }
    throw new Error(error.message || 'CONSENT_UPSERT_FAILED');
  }

  return normalizeSnapshot(data as Record<string, unknown>, snapshot);
};

export const hasMemoryConsent = async (params: { guildId: string; userId: string }): Promise<boolean> => {
  const snapshot = await getUserConsentSnapshot(params);
  return snapshot.memoryEnabled;
};

export const hasSocialGraphConsent = async (params: { guildId: string; userId: string }): Promise<boolean> => {
  const snapshot = await getUserConsentSnapshot(params);
  return snapshot.socialGraphEnabled && snapshot.profilingEnabled;
};

export const __resetConsentMemoryForTests = (): void => {
  memoryConsent.clear();
};
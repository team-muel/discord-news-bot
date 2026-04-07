/**
 * Intent Store — persists and queries intents in Supabase.
 *
 * Uses the `intents` table (created by migration 012).
 * Falls back to in-memory buffer when Supabase is unavailable.
 * Pattern follows observationStore.ts.
 */

import logger from '../../logger';
import { isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_INTENTS } from '../infra/tableRegistry';
import type { IntentRecord, IntentStatus } from './intentTypes';
import { getErrorMessage } from '../../utils/errorMessage';

// ── In-memory fallback ──────────────────────────────────────────────────────

const FALLBACK_MAX = 200;
const fallbackBuffer: IntentRecord[] = [];

// ── Row mapping helpers ─────────────────────────────────────────────────────

function toRow(intent: IntentRecord): Record<string, unknown> {
  return {
    guild_id: intent.guildId,
    hypothesis: intent.hypothesis,
    objective: intent.objective,
    rule_id: intent.ruleId,
    priority_score: intent.priorityScore,
    autonomy_level: intent.autonomyLevel,
    status: intent.status,
    observation_ids: intent.observationIds,
    sprint_id: intent.sprintId ?? null,
    cooldown_key: intent.cooldownKey,
    token_cost: intent.tokenCost,
    decided_at: intent.decidedAt ?? null,
  };
}

function fromRow(row: Record<string, unknown>): IntentRecord {
  return {
    id: row.id as number,
    guildId: row.guild_id as string,
    hypothesis: row.hypothesis as string,
    objective: row.objective as string,
    ruleId: row.rule_id as string,
    priorityScore: row.priority_score as number,
    autonomyLevel: row.autonomy_level as string,
    status: row.status as IntentStatus,
    observationIds: (row.observation_ids as string[]) ?? [],
    sprintId: row.sprint_id as string | null,
    cooldownKey: row.cooldown_key as string,
    tokenCost: row.token_cost as number,
    decidedAt: row.decided_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

export async function persistIntent(intent: IntentRecord): Promise<IntentRecord | null> {
  const qb = fromTable(T_INTENTS);
  if (!qb) {
    const fallback = { ...intent, id: Date.now(), createdAt: new Date().toISOString() };
    fallbackBuffer.push(fallback);
    if (fallbackBuffer.length > FALLBACK_MAX) fallbackBuffer.shift();
    return fallback;
  }

  try {
    const { data, error } = await qb.insert(toRow(intent)).select().single();
    if (error || !data) {
      logger.debug('[INTENT-STORE] persist failed: %s', error?.message);
      return null;
    }
    return fromRow(data as Record<string, unknown>);
  } catch (err) {
    logger.debug('[INTENT-STORE] persist error: %s', getErrorMessage(err));
    return null;
  }
}

export async function updateIntentStatus(
  intentId: number,
  status: IntentStatus,
  extra?: Partial<Pick<IntentRecord, 'sprintId' | 'decidedAt'>>,
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    const found = fallbackBuffer.find((i) => i.id === intentId);
    if (found) {
      found.status = status;
      if (extra?.sprintId) found.sprintId = extra.sprintId;
      if (extra?.decidedAt) found.decidedAt = extra.decidedAt;
    }
    return !!found;
  }

  try {
    const sb = getClient()!;
    const update: Record<string, unknown> = { status };
    if (extra?.sprintId) update.sprint_id = extra.sprintId;
    if (status === 'approved' || status === 'rejected') {
      update.decided_at = extra?.decidedAt ?? new Date().toISOString();
    }

    const { error } = await sb.from(T_INTENTS).update(update).eq('id', intentId);
    return !error;
  } catch {
    return false;
  }
}

export async function getIntents(opts: {
  guildId?: string;
  status?: IntentStatus;
  ruleId?: string;
  limit?: number;
}): Promise<IntentRecord[]> {
  const limit = opts.limit ?? 50;

  if (!isSupabaseConfigured()) {
    let results = [...fallbackBuffer];
    if (opts.guildId) results = results.filter((i) => i.guildId === opts.guildId);
    if (opts.status) results = results.filter((i) => i.status === opts.status);
    if (opts.ruleId) results = results.filter((i) => i.ruleId === opts.ruleId);
    return results.slice(-limit).reverse();
  }

  try {
    const sb = getClient()!;
    let query = sb.from(T_INTENTS).select('*').order('created_at', { ascending: false }).limit(limit);

    if (opts.guildId) query = query.eq('guild_id', opts.guildId);
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.ruleId) query = query.eq('rule_id', opts.ruleId);

    const { data, error } = await query;
    if (error || !data) return [];

    return (data as Record<string, unknown>[]).map(fromRow);
  } catch {
    return [];
  }
}

export async function getIntentById(intentId: number): Promise<IntentRecord | null> {
  if (!isSupabaseConfigured()) {
    return fallbackBuffer.find((i) => i.id === intentId) ?? null;
  }

  try {
    const sb = getClient()!;
    const { data, error } = await sb.from(T_INTENTS).select('*').eq('id', intentId).single();
    if (error || !data) return null;
    return fromRow(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getPendingIntentCount(guildId: string): Promise<number> {
  if (!isSupabaseConfigured()) {
    return fallbackBuffer.filter((i) => i.guildId === guildId && i.status === 'pending').length;
  }

  try {
    const sb = getClient()!;
    const { count, error } = await sb
      .from(T_INTENTS)
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('status', 'pending');
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export async function isCooldownActive(cooldownKey: string, cooldownMs: number): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    const cutoff = Date.now() - cooldownMs;
    return fallbackBuffer.some(
      (i) => i.cooldownKey === cooldownKey && new Date(i.createdAt ?? 0).getTime() > cutoff,
    );
  }

  try {
    const sb = getClient()!;
    const cutoff = new Date(Date.now() - cooldownMs).toISOString();
    const { count, error } = await sb
      .from(T_INTENTS)
      .select('*', { count: 'exact', head: true })
      .eq('cooldown_key', cooldownKey)
      .gt('created_at', cutoff);
    return !error && (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getIntentStats(guildId?: string): Promise<Record<IntentStatus, number>> {
  const base: Record<IntentStatus, number> = {
    pending: 0,
    approved: 0,
    executing: 0,
    completed: 0,
    rejected: 0,
    expired: 0,
  };

  if (!isSupabaseConfigured()) {
    const source = guildId ? fallbackBuffer.filter((i) => i.guildId === guildId) : fallbackBuffer;
    for (const i of source) {
      base[i.status] = (base[i.status] ?? 0) + 1;
    }
    return base;
  }

  try {
    const sb = getClient()!;
    let query = sb.from(T_INTENTS).select('status');
    if (guildId) query = query.eq('guild_id', guildId);
    const { data, error } = await query;
    if (error || !data) return base;

    for (const row of data as Array<{ status: IntentStatus }>) {
      base[row.status] = (base[row.status] ?? 0) + 1;
    }
    return base;
  } catch {
    return base;
  }
}

/** For diagnostics / testing */
export const getFallbackBufferSnapshot = (): readonly IntentRecord[] => [...fallbackBuffer];

/** Test-only reset */
export const __resetIntentStoreForTests = (): void => {
  fallbackBuffer.length = 0;
};

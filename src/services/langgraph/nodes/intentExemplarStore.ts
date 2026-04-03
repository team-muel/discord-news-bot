/**
 * Intent Exemplar Store (ADR-006)
 *
 * Manages the `intent_exemplars` Supabase table for:
 * - Storing every intent classification result
 * - Querying top-k high-quality exemplars for few-shot injection
 * - Updating correctness attribution after session outcome
 */

import logger from '../../../logger';
import { getSupabaseClient, isSupabaseConfigured } from '../../supabaseClient';
import type { IntentClassification, IntentTaxonomy } from '../../agent/agentRuntimeTypes';

// ──── Types ─────────────────────────────────────────────────────────────────

export type IntentExemplar = {
  id: number;
  guildId: string;
  message: string;
  signalSnapshot: Record<string, unknown>;
  classifiedIntent: string;
  confidence: number | null;
  wasCorrect: boolean | null;
  sessionId: string | null;
  sessionReward: number | null;
  userCorrection: string | null;
  createdAt: string;
};

export type IntentExemplarInsert = {
  guildId: string;
  message: string;
  signalSnapshot?: Record<string, unknown>;
  classification: IntentClassification;
  sessionId?: string;
};

// ──── Schema Bootstrap ──────────────────────────────────────────────────────

let tableVerified = false;
let tableDisabled = false;

const ensureTable = async (): Promise<boolean> => {
  if (tableDisabled) return false;
  if (tableVerified) return true;
  if (!isSupabaseConfigured()) return false;

  try {
    const client = getSupabaseClient();
    const { error } = await client
      .from('intent_exemplars')
      .select('id')
      .limit(1);

    if (error) {
      const code = String(error.code || '');
      const msg = String(error.message || '').toLowerCase();
      if (code === '42P01' || code === 'PGRST205' || msg.includes('intent_exemplars')) {
        logger.info('[INTENT-EXEMPLAR] Table not found; store disabled until migration runs');
        tableDisabled = true;
        return false;
      }
      logger.warn('[INTENT-EXEMPLAR] Table check error: %s', error.message);
      return false;
    }

    tableVerified = true;
    return true;
  } catch (err) {
    logger.warn('[INTENT-EXEMPLAR] Table check failed: %s', err instanceof Error ? err.message : String(err));
    return false;
  }
};

// ──── Write ─────────────────────────────────────────────────────────────────

export const persistIntentExemplar = async (input: IntentExemplarInsert): Promise<boolean> => {
  if (!(await ensureTable())) return false;

  try {
    const client = getSupabaseClient();
    const { error } = await client.from('intent_exemplars').insert({
      guild_id: input.guildId,
      message: input.message.slice(0, 2000),
      signal_snapshot: input.signalSnapshot || {},
      classified_intent: input.classification.primary,
      confidence: Number.isFinite(input.classification.confidence) ? input.classification.confidence : null,
      session_id: input.sessionId || null,
      was_correct: null,
      session_reward: null,
      user_correction: null,
    });

    if (error) {
      logger.warn('[INTENT-EXEMPLAR] persist failed: %s', error.message);
      return false;
    }

    return true;
  } catch (err) {
    logger.warn('[INTENT-EXEMPLAR] persist error: %s', err instanceof Error ? err.message : String(err));
    return false;
  }
};

// ──── Outcome Attribution ───────────────────────────────────────────────────

export const attributeIntentOutcome = async (params: {
  sessionId: string;
  wasCorrect: boolean;
  sessionReward: number | null;
  userCorrection?: string;
}): Promise<boolean> => {
  if (!(await ensureTable())) return false;

  try {
    const client = getSupabaseClient();
    const update: Record<string, unknown> = {
      was_correct: params.wasCorrect,
    };
    if (params.sessionReward !== null && Number.isFinite(params.sessionReward)) {
      update.session_reward = params.sessionReward;
    }
    if (params.userCorrection) {
      update.user_correction = params.userCorrection.slice(0, 200);
    }

    const { error } = await client
      .from('intent_exemplars')
      .update(update)
      .eq('session_id', params.sessionId);

    if (error) {
      logger.warn('[INTENT-EXEMPLAR] attribution failed session=%s: %s', params.sessionId, error.message);
      return false;
    }

    return true;
  } catch (err) {
    logger.warn('[INTENT-EXEMPLAR] attribution error: %s', err instanceof Error ? err.message : String(err));
    return false;
  }
};

// ──── Read: Top-K Exemplars for Few-Shot ────────────────────────────────────

export const loadTopExemplars = async (params: {
  guildId: string;
  limit: number;
}): Promise<IntentExemplar[]> => {
  if (!(await ensureTable())) return [];

  try {
    const client = getSupabaseClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
      .from('intent_exemplars')
      .select('*')
      .eq('guild_id', params.guildId)
      .eq('was_correct', true)
      .not('session_reward', 'is', null)
      .gte('created_at', thirtyDaysAgo)
      .order('session_reward', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(params.limit);

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      guildId: String(row.guild_id || ''),
      message: String(row.message || ''),
      signalSnapshot: (row.signal_snapshot as Record<string, unknown>) || {},
      classifiedIntent: String(row.classified_intent || ''),
      confidence: row.confidence !== null ? Number(row.confidence) : null,
      wasCorrect: row.was_correct as boolean | null,
      sessionId: row.session_id !== null ? String(row.session_id) : null,
      sessionReward: row.session_reward !== null ? Number(row.session_reward) : null,
      userCorrection: row.user_correction !== null ? String(row.user_correction) : null,
      createdAt: String(row.created_at || ''),
    }));
  } catch {
    return [];
  }
};

// ──── Read: Intent Frequency for Enricher ───────────────────────────────────

export const loadIntentFrequency = async (params: {
  guildId: string;
  userId: string;
  limit: number;
}): Promise<{ userHistory: Array<{ intent: string; count: number }>; guildDominant: string | null }> => {
  if (!(await ensureTable())) return { userHistory: [], guildDominant: null };

  try {
    const client = getSupabaseClient();

    // Guild-level dominant intent (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: guildData } = await client
      .from('intent_exemplars')
      .select('classified_intent')
      .eq('guild_id', params.guildId)
      .gte('created_at', thirtyDaysAgo)
      .limit(200);

    const guildCounts = new Map<string, number>();
    if (guildData) {
      for (const row of guildData as Array<{ classified_intent: string }>) {
        const intent = String(row.classified_intent || '');
        if (intent) guildCounts.set(intent, (guildCounts.get(intent) || 0) + 1);
      }
    }
    const guildSorted = [...guildCounts.entries()].sort((a, b) => b[1] - a[1]);
    const guildDominant = guildSorted.length > 0 ? guildSorted[0][0] : null;

    // User-level intent frequency is not yet feasible without a user_id column
    // (current schema uses session_id). Placeholder returning guild data.
    const userHistory = guildSorted.slice(0, params.limit).map(([intent, count]) => ({ intent, count }));

    return { userHistory, guildDominant };
  } catch {
    return { userHistory: [], guildDominant: null };
  }
};

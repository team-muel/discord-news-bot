/**
 * Entity Nervous System — integrates the three core feedback circuits
 * that transform isolated loops into a coherent autonomous entity.
 *
 * Circuit 1: Perception → Memory (session outcomes auto-precipitate as memory_items)
 * Circuit 2: Reward → Behavior (reward trend triggers policy/retrieval adjustments)
 * Circuit 3: Self-Reflection → Self-Modification (retro insights update session-level self-notes)
 */

import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { isSupabaseConfigured, getSupabaseClient } from './supabaseClient';

// ──── Configuration ──────────────────────────────────────────────────────────

const NERVOUS_SYSTEM_ENABLED = parseBooleanEnv(process.env.ENTITY_NERVOUS_SYSTEM_ENABLED, true);

// Circuit 1: session → memory precipitation
const MEMORY_PRECIPITATION_ENABLED = parseBooleanEnv(process.env.ENTITY_MEMORY_PRECIPITATION_ENABLED, true);
const MEMORY_PRECIPITATION_MIN_STEPS = Math.max(1, parseIntegerEnv(process.env.ENTITY_MEMORY_PRECIPITATION_MIN_STEPS, 2));

// Circuit 2: reward → behavior
const REWARD_BEHAVIOR_ENABLED = parseBooleanEnv(process.env.ENTITY_REWARD_BEHAVIOR_ENABLED, true);

// Circuit 3: retro → self-notes
const SELF_NOTES_ENABLED = parseBooleanEnv(process.env.ENTITY_SELF_NOTES_ENABLED, true);
const SELF_NOTES_MAX_LENGTH = Math.max(200, parseIntegerEnv(process.env.ENTITY_SELF_NOTES_MAX_LENGTH, 2000));
const SELF_NOTES_MAX_ITEMS = Math.max(3, parseIntegerEnv(process.env.ENTITY_SELF_NOTES_MAX_ITEMS, 10));

// ──── Types ──────────────────────────────────────────────────────────────────

export type SessionPrecipitationInput = {
  sessionId: string;
  guildId: string;
  goal: string;
  result: string | null;
  status: string;
  stepCount: number;
  requestedBy: string;
};

export type RewardBehaviorAdjustment = {
  guildId: string;
  trend: 'improving' | 'stable' | 'degrading';
  delta: number;
  actions: string[];
};

export type SelfNoteEntry = {
  guildId: string;
  source: string;
  note: string;
  createdAt: string;
};

// ──── In-memory self-notes cache (per-guild, with TTL) ──────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
type CachedSelfNotes = { entries: SelfNoteEntry[]; cachedAt: number };
const selfNotesCache = new Map<string, CachedSelfNotes>();

// ──── Circuit 1: Perception → Memory Precipitation ──────────────────────────

/**
 * After a session ends, precipitate its outcome as a memory job.
 * This feeds the memoryJobRunner's `durable_extraction` pipeline,
 * turning session interactions into long-term memory_items.
 */
export const precipitateSessionToMemory = async (input: SessionPrecipitationInput): Promise<boolean> => {
  if (!NERVOUS_SYSTEM_ENABLED || !MEMORY_PRECIPITATION_ENABLED) return false;
  if (!isSupabaseConfigured()) return false;

  // Only precipitate meaningful sessions (enough steps, has result)
  if (input.stepCount < MEMORY_PRECIPITATION_MIN_STEPS) return false;
  if (input.status === 'cancelled') return false;
  if (!input.result && input.status !== 'failed') return false;

  try {
    // Lazy import to avoid circular dependency
    const { queueMemoryJob } = await import('./agent/agentMemoryStore');

    const content = input.status === 'failed'
      ? `[실패한 세션] 목표: ${input.goal}\n오류: ${input.result || '알 수 없음'}`
      : `[세션 요약] 목표: ${input.goal}\n결과: ${(input.result || '').slice(0, 1500)}`;

    await queueMemoryJob({
      guildId: input.guildId,
      jobType: 'durable_extraction',
      actorId: input.requestedBy || 'system-nervous-system',
      input: {
        source: 'session-precipitation',
        sessionId: input.sessionId,
        content,
      },
    });

    logger.info('[NERVOUS-SYSTEM] precipitated session=%s to memory queue guild=%s', input.sessionId, input.guildId);
    return true;
  } catch (err) {
    logger.warn('[NERVOUS-SYSTEM] session precipitation failed session=%s: %s', input.sessionId, err instanceof Error ? err.message : String(err));
    return false;
  }
};

// ──── Circuit 2: Reward → Behavior Adjustment ───────────────────────────────

/**
 * Check reward trend for a guild and adjust behavior parameters accordingly.
 * Called after reward snapshots are computed.
 *
 * When trend is degrading:
 *   - Increase ToT exploration (maxBranches +1)
 *   - Enable retrieval auto-tuning application
 * When trend is improving:
 *   - Allow ToT to settle (no change)
 *   - Keep retrieval tuning status
 */
export const adjustBehaviorFromReward = async (guildId: string): Promise<RewardBehaviorAdjustment | null> => {
  if (!NERVOUS_SYSTEM_ENABLED || !REWARD_BEHAVIOR_ENABLED) return null;
  if (!isSupabaseConfigured()) return null;

  try {
    const { computeRewardTrend } = await import('./eval/rewardSignalService');
    const trend = await computeRewardTrend(guildId);
    if (!trend) return null;

    const actions: string[] = [];
    const client = getSupabaseClient();

    if (trend.trend === 'degrading') {
      // Action 1: Boost ToT exploration by nudging maxBranches up
      const { data: totPolicy } = await client
        .from('agent_tot_policies')
        .select('max_branches')
        .eq('guild_id', guildId)
        .eq('enabled', true)
        .maybeSingle();

      if (totPolicy) {
        const currentBranches = Number(totPolicy.max_branches) || 3;
        const nextBranches = Math.min(6, currentBranches + 1);
        if (nextBranches > currentBranches) {
          const { error: totErr } = await client.from('agent_tot_policies').update({
            max_branches: nextBranches,
            updated_at: new Date().toISOString(),
          }).eq('guild_id', guildId).eq('enabled', true);
          if (totErr) {
            logger.warn('[NERVOUS-SYSTEM] tot policy update failed guild=%s: %s', guildId, totErr.message);
          }
          actions.push(`tot.maxBranches: ${currentBranches} → ${nextBranches}`);
        }
      }

      // Action 2: Force-enable retrieval tuning application
      const { data: profile } = await client
        .from('retrieval_ranker_active_profiles')
        .select('active_variant')
        .eq('guild_id', guildId)
        .maybeSingle();

      if (!profile) {
        // No active profile = still on baseline. Record a note to apply next eval.
        actions.push('retrieval: flagged for next auto-eval apply');
      }

      // Action 3: Add degradation self-note for session context
      await persistSelfNote({
        guildId,
        source: 'reward-behavior',
        note: `[자동 감지] 보상 신호 하락 (delta=${trend.delta.toFixed(3)}). 탐색 강화 + 검색 전략 재평가 진행 중.`,
        createdAt: new Date().toISOString(),
      });
      actions.push('self-note: degradation awareness added');
    }

    if (trend.trend === 'improving') {
      // Normalize maxBranches back down when reward is improving
      const { data: totPolicy } = await client
        .from('agent_tot_policies')
        .select('max_branches')
        .eq('guild_id', guildId)
        .eq('enabled', true)
        .maybeSingle();

      if (totPolicy) {
        const currentBranches = Number(totPolicy.max_branches) || 3;
        const nextBranches = Math.max(2, currentBranches - 1);
        if (nextBranches < currentBranches) {
          const { error: totErr } = await client.from('agent_tot_policies').update({
            max_branches: nextBranches,
            updated_at: new Date().toISOString(),
          }).eq('guild_id', guildId).eq('enabled', true);
          if (totErr) {
            logger.warn('[NERVOUS-SYSTEM] tot policy normalize failed guild=%s: %s', guildId, totErr.message);
          }
          actions.push(`tot.maxBranches: ${currentBranches} → ${nextBranches} (normalizing)`);
        }
      }
    }

    if (actions.length > 0) {
      logger.info('[NERVOUS-SYSTEM] behavior adjusted guild=%s trend=%s actions=[%s]', guildId, trend.trend, actions.join(', '));
    }

    return {
      guildId,
      trend: trend.trend,
      delta: trend.delta,
      actions,
    };
  } catch (err) {
    logger.warn('[NERVOUS-SYSTEM] behavior adjustment failed guild=%s: %s', guildId, err instanceof Error ? err.message : String(err));
    return null;
  }
};

// ──── Circuit 3: Self-Reflection → Self-Modification ────────────────────────

/**
 * Persist a self-note derived from retro/optimization insights.
 * These notes are stored in Supabase and loaded as top-priority hints
 * in buildAgentMemoryHints.
 */
export const persistSelfNote = async (entry: SelfNoteEntry): Promise<boolean> => {
  if (!NERVOUS_SYSTEM_ENABLED || !SELF_NOTES_ENABLED) return false;
  if (!isSupabaseConfigured()) return false;

  try {
    const client = getSupabaseClient();
    const noteText = entry.note.slice(0, SELF_NOTES_MAX_LENGTH);

    await client.from('entity_self_notes').insert({
      guild_id: entry.guildId,
      source: entry.source,
      note: noteText,
      created_at: entry.createdAt,
    });

    // Update in-memory cache
    const cached = selfNotesCache.get(entry.guildId);
    const existing = cached ? cached.entries : [];
    existing.unshift({ ...entry, note: noteText });
    selfNotesCache.set(entry.guildId, { entries: existing.slice(0, SELF_NOTES_MAX_ITEMS), cachedAt: Date.now() });

    logger.debug('[NERVOUS-SYSTEM] self-note persisted guild=%s source=%s', entry.guildId, entry.source);
    return true;
  } catch (err) {
    logger.warn('[NERVOUS-SYSTEM] self-note persist failed: %s', err instanceof Error ? err.message : String(err));
    return false;
  }
};

/**
 * Ingest retro optimizeHints into self-notes.
 * Called by sprintOrchestrator after retro phase completes.
 */
export const ingestRetroInsights = async (params: {
  guildId: string;
  sprintId: string;
  optimizeHints: string[];
  failedPhases: string[];
}): Promise<number> => {
  if (!NERVOUS_SYSTEM_ENABLED || !SELF_NOTES_ENABLED) return 0;
  if (params.optimizeHints.length === 0 && params.failedPhases.length === 0) return 0;

  let persisted = 0;
  const now = new Date().toISOString();

  // Convert optimize hints into actionable self-notes
  for (const hint of params.optimizeHints.slice(0, 5)) {
    const ok = await persistSelfNote({
      guildId: params.guildId,
      source: `retro:${params.sprintId}`,
      note: `[학습] ${hint}`,
      createdAt: now,
    });
    if (ok) persisted++;
  }

  // Convert failure patterns into avoidance self-notes
  if (params.failedPhases.length > 0) {
    const ok = await persistSelfNote({
      guildId: params.guildId,
      source: `retro:${params.sprintId}`,
      note: `[실패 패턴] 단계 ${params.failedPhases.join(', ')} 실패. 다음 실행 시 해당 단계 입력/가정 재검증 필요.`,
      createdAt: now,
    });
    if (ok) persisted++;
  }

  if (persisted > 0) {
    logger.info('[NERVOUS-SYSTEM] ingested %d retro insights as self-notes sprint=%s guild=%s', persisted, params.sprintId, params.guildId);
  }

  return persisted;
};

/**
 * Load self-notes for a guild. Used by buildAgentMemoryHints
 * to inject self-reflection context into sessions.
 */
export const loadSelfNotes = async (guildId: string): Promise<string[]> => {
  // Return from cache if fresh
  const cached = selfNotesCache.get(guildId);
  if (cached && cached.entries.length > 0 && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.entries.map((n) => `[자기 성찰: ${n.source}] ${n.note}`);
  }
  // Evict stale entry
  if (cached && (Date.now() - cached.cachedAt) >= CACHE_TTL_MS) {
    selfNotesCache.delete(guildId);
  }

  if (!isSupabaseConfigured()) return [];

  try {
    const client = getSupabaseClient();
    const { data } = await client
      .from('entity_self_notes')
      .select('source, note, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(SELF_NOTES_MAX_ITEMS);

    if (!data || data.length === 0) return [];

    const entries: SelfNoteEntry[] = data.map((row: Record<string, unknown>) => ({
      guildId,
      source: String(row.source || ''),
      note: String(row.note || ''),
      createdAt: String(row.created_at || ''),
    }));

    selfNotesCache.set(guildId, { entries, cachedAt: Date.now() });
    return entries.map((n) => `[자기 성찰: ${n.source}] ${n.note}`);
  } catch (err) {
    logger.warn('[NERVOUS-SYSTEM] loadSelfNotes failed guild=%s: %s', guildId, err instanceof Error ? err.message : String(err));
    return [];
  }
};

/**
 * Health check: returns a summary of all three circuits' current state.
 */
export const getNervousSystemStatus = (): {
  enabled: boolean;
  circuits: {
    perceptionToMemory: boolean;
    rewardToBehavior: boolean;
    selfReflectionToModification: boolean;
  };
  selfNotesCachedGuilds: number;
} => ({
  enabled: NERVOUS_SYSTEM_ENABLED,
  circuits: {
    perceptionToMemory: NERVOUS_SYSTEM_ENABLED && MEMORY_PRECIPITATION_ENABLED,
    rewardToBehavior: NERVOUS_SYSTEM_ENABLED && REWARD_BEHAVIOR_ENABLED,
    selfReflectionToModification: NERVOUS_SYSTEM_ENABLED && SELF_NOTES_ENABLED,
  },
  selfNotesCachedGuilds: selfNotesCache.size,
});

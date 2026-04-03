/**
 * Memory Evolution Service (ADR-006)
 *
 * A-MEM inspired: when a new memory is stored, find related existing memories
 * and create inter-memory links. Optionally boost/update existing memories
 * that are reinforced by new information.
 *
 * Flow:
 *   1. New memory about to be inserted (durable_extraction)
 *   2. Hybrid search for related existing memories in same guild
 *   3. For each related memory above threshold:
 *      a. Create a memory_item_link (related / contradicts / derived_from)
 *      b. Boost confidence of existing memory if reinforced
 *      c. Touch updated_at so recency scoring picks it up
 *   4. Return evolution results for audit trail
 */

import logger from '../../logger';
import { memoryConfig } from '../../config';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { searchMemoryHybrid } from '../agent/agentMemoryStore';

// ──── Configuration ───────────────────────────────────────────────────────────

const EVOLUTION_ENABLED = memoryConfig.evolutionEnabled;
const EVOLUTION_MAX_LINKS = memoryConfig.evolutionMaxLinks;
const EVOLUTION_MIN_SIMILARITY = memoryConfig.evolutionMinSimilarity;
const EVOLUTION_CONFIDENCE_BOOST = memoryConfig.evolutionConfidenceBoost;

// ──── Types ───────────────────────────────────────────────────────────────────

export type EvolutionCandidate = {
  id: string;
  title: string;
  similarity: number;
  confidence: number;
};

export type LinkRelation = 'related' | 'derived_from' | 'contradicts' | 'supersedes';

export type EvolutionResult = {
  evolved: boolean;
  linksCreated: number;
  memoriesBoosted: number;
  candidates: EvolutionCandidate[];
};

const EMPTY_RESULT: EvolutionResult = { evolved: false, linksCreated: 0, memoriesBoosted: 0, candidates: [] };

// ──── Helpers ─────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const classifyRelation = (similarity: number, _newTitle: string, _existingTitle: string): LinkRelation => {
  // High similarity suggests direct relationship; very high might be reinforcement
  // Future: LLM-based classification for contradicts/supersedes
  if (similarity >= 0.85) return 'derived_from';
  return 'related';
};

// ──── Core ────────────────────────────────────────────────────────────────────

/**
 * Find related memories and create evolution links.
 * Called from memoryJobRunner immediately after a new memory_item is inserted.
 */
export const evolveMemoryLinks = async (params: {
  newMemoryId: string;
  guildId: string;
  title: string;
  content: string;
  summary: string;
}): Promise<EvolutionResult> => {
  if (!EVOLUTION_ENABLED) return EMPTY_RESULT;
  if (!isSupabaseConfigured()) return EMPTY_RESULT;

  const queryText = [params.title, params.summary].filter(Boolean).join(' ').trim();
  if (!queryText || queryText.length < 4) return EMPTY_RESULT;

  try {
    const client = getSupabaseClient();
    let candidates: EvolutionCandidate[] = [];

    // Use shared hybrid search helper (vector + lexical fallback)
    const rawItems = await searchMemoryHybrid({
      guildId: params.guildId,
      query: queryText.slice(0, 400),
      type: null,
      limit: EVOLUTION_MAX_LINKS + 2, // fetch extra to exclude self
      minSimilarity: EVOLUTION_MIN_SIMILARITY,
    });

    candidates = rawItems
      .filter((row) => String(row.id || '') !== params.newMemoryId)
      .slice(0, EVOLUTION_MAX_LINKS)
      .map((row) => ({
        id: String(row.id || ''),
        title: String(row.title || row.summary || '').slice(0, 120),
        similarity: clamp01(Number(row.similarity ?? row.score ?? 0.3)),
        confidence: clamp01(Number(row.confidence ?? 0.5)),
      }));

    if (candidates.length === 0) return EMPTY_RESULT;

    // Create links and boost related memories
    let linksCreated = 0;
    let memoriesBoosted = 0;

    for (const candidate of candidates) {
      if (!candidate.id) continue;

      const relation = classifyRelation(candidate.similarity, params.title, candidate.title);

      // Insert link (unique constraint prevents duplicates)
      const { error: linkError } = await client
        .from('memory_item_links')
        .insert({
          source_id: params.newMemoryId,
          target_id: candidate.id,
          guild_id: params.guildId,
          relation_type: relation,
          strength: Number(candidate.similarity.toFixed(3)),
          created_by: 'evolution-service',
        });

      if (!linkError) {
        linksCreated++;
      } else if (linkError.code !== '23505') {
        // 23505 = unique violation (duplicate link) — expected, skip
        logger.debug('[MEMORY-EVOLUTION] link insert failed: %s', linkError.message);
      }

      // Boost confidence of related memory (reinforcement)
      if (relation === 'related' || relation === 'derived_from') {
        const newConfidence = clamp01(candidate.confidence + EVOLUTION_CONFIDENCE_BOOST);
        if (newConfidence > candidate.confidence) {
          const { error: boostError } = await client
            .from('memory_items')
            .update({
              confidence: Number(newConfidence.toFixed(3)),
              updated_by: 'evolution-service',
            })
            .eq('id', candidate.id)
            .eq('status', 'active');

          if (!boostError) {
            memoriesBoosted++;
          }
        }
      }
    }

    if (linksCreated > 0 || memoriesBoosted > 0) {
      logger.info(
        '[MEMORY-EVOLUTION] guild=%s new=%s links=%d boosted=%d candidates=%d',
        params.guildId, params.newMemoryId, linksCreated, memoriesBoosted, candidates.length,
      );
    }

    return { evolved: true, linksCreated, memoriesBoosted, candidates };
  } catch (err) {
    logger.warn('[MEMORY-EVOLUTION] failed guild=%s: %s', params.guildId, err instanceof Error ? err.message : String(err));
    return EMPTY_RESULT;
  }
};

/**
 * Count inbound links for a memory item (used in scoring).
 * Returns 0 on any failure — never blocks the hint pipeline.
 */
export const countMemoryLinks = async (memoryId: string): Promise<number> => {
  if (!isSupabaseConfigured()) return 0;
  try {
    const client = getSupabaseClient();
    const { count, error } = await client
      .from('memory_item_links')
      .select('id', { count: 'exact', head: true })
      .or(`source_id.eq.${memoryId},target_id.eq.${memoryId}`);

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
};

/**
 * Batch-fetch link counts for multiple memory items.
 * Returns a Map<memoryId, linkCount>.
 */
export const batchCountMemoryLinks = async (memoryIds: string[], guildId: string): Promise<Map<string, number>> => {
  const result = new Map<string, number>();
  if (!isSupabaseConfigured() || memoryIds.length === 0) return result;

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('memory_item_links')
      .select('source_id, target_id')
      .eq('guild_id', guildId)
      .or(
        memoryIds.map((id) => `source_id.eq.${id},target_id.eq.${id}`).join(','),
      )
      .limit(500);

    if (error || !data) return result;

    for (const row of data as Array<Record<string, unknown>>) {
      const src = String(row.source_id || '');
      const tgt = String(row.target_id || '');
      if (memoryIds.includes(src)) {
        result.set(src, (result.get(src) || 0) + 1);
      }
      if (memoryIds.includes(tgt)) {
        result.set(tgt, (result.get(tgt) || 0) + 1);
      }
    }

    return result;
  } catch {
    return result;
  }
};

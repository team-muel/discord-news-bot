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
import { getClient, fromTable } from '../infra/baseRepository';
import { T_MEMORY_ITEMS, T_MEMORY_ITEM_LINKS } from '../infra/tableRegistry';
import { searchMemoryHybrid } from '../agent/agentMemoryStore';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { getErrorMessage } from '../../utils/errorMessage';

// ──── Configuration ───────────────────────────────────────────────────────────

const EVOLUTION_ENABLED = memoryConfig.evolutionEnabled;
const EVOLUTION_MAX_LINKS = memoryConfig.evolutionMaxLinks;
const EVOLUTION_MIN_SIMILARITY = memoryConfig.evolutionMinSimilarity;
const EVOLUTION_CONFIDENCE_BOOST = memoryConfig.evolutionConfidenceBoost;
const EVOLUTION_LLM_CLASSIFY = memoryConfig.evolutionLlmClassify;

// ──── Types ───────────────────────────────────────────────────────────────────

export type EvolutionCandidate = {
  id: string;
  title: string;
  summary: string;
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

const classifyRelationHeuristic = (similarity: number): LinkRelation => {
  if (similarity >= 0.85) return 'derived_from';
  return 'related';
};

const CLASSIFY_SYSTEM = `You classify the relationship between two memory items.
Respond with EXACTLY one of: related, derived_from, contradicts, supersedes

Definitions:
- related: the two items share a topic but are complementary
- derived_from: the new item is a more specific version or elaboration of the existing item
- contradicts: the new item conflicts with or negates part of the existing item
- supersedes: the new item fully replaces the existing item with newer information

Output ONLY the single relationship word, nothing else.`;

const VALID_RELATIONS = new Set<LinkRelation>(['related', 'derived_from', 'contradicts', 'supersedes']);

const classifyRelationLlm = async (
  newTitle: string,
  newSummary: string,
  existingTitle: string,
  existingSummary: string,
  similarity: number,
): Promise<LinkRelation> => {
  const fallback = classifyRelationHeuristic(similarity);
  if (!isAnyLlmConfigured()) return fallback;

  try {
    const user = `New memory:\nTitle: ${newTitle}\nSummary: ${newSummary}\n\nExisting memory:\nTitle: ${existingTitle}\nSummary: ${existingSummary}\n\nSimilarity score: ${similarity.toFixed(2)}`;
    const raw = await generateText({
      system: CLASSIFY_SYSTEM,
      user,
      maxTokens: 16,
      temperature: 0.1,
      actionName: 'memory.evolution.classify',
    });
    const parsed = raw.trim().toLowerCase().replace(/[^a-z_]/g, '') as LinkRelation;
    if (VALID_RELATIONS.has(parsed)) return parsed;
    logger.debug('[MEMORY-EVOLUTION] LLM classify returned invalid: %s, using heuristic', raw);
    return fallback;
  } catch (err) {
    logger.debug('[MEMORY-EVOLUTION] LLM classify failed, using heuristic: %s', getErrorMessage(err));
    return fallback;
  }
};

const classifyRelation = async (
  similarity: number,
  newTitle: string,
  newSummary: string,
  existingTitle: string,
  existingSummary: string,
): Promise<LinkRelation> => {
  if (!EVOLUTION_LLM_CLASSIFY) return classifyRelationHeuristic(similarity);
  return classifyRelationLlm(newTitle, newSummary, existingTitle, existingSummary, similarity);
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
  const client = getClient();
  if (!client) return EMPTY_RESULT;

  const queryText = [params.title, params.summary].filter(Boolean).join(' ').trim();
  if (!queryText || queryText.length < 4) return EMPTY_RESULT;

  try {
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
        summary: String(row.summary || row.content || '').slice(0, 200),
        similarity: clamp01(Number(row.similarity ?? row.score ?? 0.3)),
        confidence: clamp01(Number(row.confidence ?? 0.5)),
      }));

    if (candidates.length === 0) return EMPTY_RESULT;

    // Create links and boost related memories
    let linksCreated = 0;
    let memoriesBoosted = 0;

    for (const candidate of candidates) {
      if (!candidate.id) continue;

      const relation = await classifyRelation(
        candidate.similarity,
        params.title,
        params.summary,
        candidate.title,
        candidate.summary,
      );

      // Insert link (unique constraint prevents duplicates)
      const { error: linkError } = await client
        .from(T_MEMORY_ITEM_LINKS)
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

      // Boost or penalize confidence based on relation type
      if (relation === 'related' || relation === 'derived_from') {
        const newConfidence = clamp01(candidate.confidence + EVOLUTION_CONFIDENCE_BOOST);
        if (newConfidence > candidate.confidence) {
          const { error: boostError } = await client
            .from(T_MEMORY_ITEMS)
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
      } else if (relation === 'supersedes') {
        // Superseded memory gets confidence penalty and archived
        const { error: supersedeError } = await client
          .from(T_MEMORY_ITEMS)
          .update({
            confidence: Number(clamp01(candidate.confidence * 0.5).toFixed(3)),
            status: 'archived',
            updated_by: 'evolution-service',
          })
          .eq('id', candidate.id)
          .eq('status', 'active');

        if (!supersedeError) {
          memoriesBoosted++;
          logger.info('[MEMORY-EVOLUTION] superseded mem=%s by new=%s', candidate.id, params.newMemoryId);
        }
      } else if (relation === 'contradicts') {
        // Contradicting memories get confidence reduction but stay active
        const reducedConfidence = clamp01(candidate.confidence - EVOLUTION_CONFIDENCE_BOOST * 2);
        if (reducedConfidence < candidate.confidence) {
          const { error: contradictError } = await client
            .from(T_MEMORY_ITEMS)
            .update({
              confidence: Number(reducedConfidence.toFixed(3)),
              updated_by: 'evolution-service',
            })
            .eq('id', candidate.id)
            .eq('status', 'active');

          if (!contradictError) {
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
    logger.warn('[MEMORY-EVOLUTION] failed guild=%s: %s', params.guildId, getErrorMessage(err));
    return EMPTY_RESULT;
  }
};

/**
 * Count inbound links for a memory item (used in scoring).
 * Returns 0 on any failure — never blocks the hint pipeline.
 */
export const countMemoryLinks = async (memoryId: string): Promise<number> => {
  const qb = fromTable(T_MEMORY_ITEM_LINKS);
  if (!qb) return 0;
  try {
    const { count, error } = await qb
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
  const qb = fromTable(T_MEMORY_ITEM_LINKS);
  if (!qb || memoryIds.length === 0) return result;

  try {
    const { data, error } = await qb
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

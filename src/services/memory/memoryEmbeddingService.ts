/**
 * Memory Embedding Service
 *
 * Generates vector embeddings for memory_items via LiteLLM proxy,
 * stores them in the pgvector `embedding` column, and provides
 * a query-embedding helper for hybrid search.
 *
 * Uses text-embedding-3-small (1536 dims) by default via LiteLLM.
 */

import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseStringEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_MEMORY_ITEMS } from '../infra/tableRegistry';
import { getErrorMessage } from '../../utils/errorMessage';

const EMBEDDING_ENABLED = parseBooleanEnv(process.env.MEMORY_EMBEDDING_ENABLED, true);
const EMBEDDING_MODEL = parseStringEnv(process.env.MEMORY_EMBEDDING_MODEL, 'text-embedding-3-small');
const EMBEDDING_DIMENSIONS = Math.max(256, parseIntegerEnv(process.env.MEMORY_EMBEDDING_DIMENSIONS, 1536));
const LITELLM_BASE_URL = parseStringEnv(process.env.LITELLM_BASE_URL, 'http://127.0.0.1:4000').replace(/\/+$/, '');
const LITELLM_API_KEY = String(process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '').trim();
const EMBEDDING_BATCH_SIZE = Math.max(1, Math.min(100, parseIntegerEnv(process.env.MEMORY_EMBEDDING_BATCH_SIZE, 20)));
const EMBEDDING_TIMEOUT_MS = Math.max(5_000, parseIntegerEnv(process.env.MEMORY_EMBEDDING_TIMEOUT_MS, 30_000));

export const isEmbeddingEnabled = (): boolean => EMBEDDING_ENABLED && isSupabaseConfigured();

/**
 * Generate embedding for a single text string via LiteLLM /embeddings endpoint.
 */
export const generateEmbedding = async (text: string): Promise<number[] | null> => {
  if (!EMBEDDING_ENABLED) return null;

  const trimmed = String(text || '').trim().slice(0, 8000);
  if (!trimmed) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (LITELLM_API_KEY) {
      headers['authorization'] = `Bearer ${LITELLM_API_KEY}`;
    }

    const res = await fetch(`${LITELLM_BASE_URL}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: trimmed,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn('[EMBEDDING] LiteLLM returned %d', res.status);
      return null;
    }

    const data = await res.json() as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      logger.warn('[EMBEDDING] Empty embedding response');
      return null;
    }

    return embedding;
  } catch (err) {
    logger.warn('[EMBEDDING] Failed: %s', getErrorMessage(err));
    return null;
  }
};

/**
 * Generate embedding for a query string (for use as search vector).
 * Returns the raw float array suitable for passing to the hybrid search RPC.
 */
export const generateQueryEmbedding = async (query: string): Promise<number[] | null> => {
  return generateEmbedding(query);
};

/**
 * Store an embedding for a specific memory_item.
 */
export const storeMemoryEmbedding = async (memoryItemId: string, embedding: number[]): Promise<boolean> => {
  const qb = fromTable(T_MEMORY_ITEMS);
  if (!qb) return false;

  try {
    // pgvector expects a string representation: [0.1,0.2,...]
    const vectorStr = `[${embedding.join(',')}]`;

    const { error } = await qb
      .update({ embedding: vectorStr })
      .eq('id', memoryItemId);

    if (error) {
      logger.warn('[EMBEDDING] Store failed for %s: %s', memoryItemId, error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('[EMBEDDING] Store error: %s', getErrorMessage(err));
    return false;
  }
};

/**
 * Backfill embeddings for memory_items that don't have them yet.
 * Processes in batches to avoid overwhelming the embedding API.
 */
export const backfillMemoryEmbeddings = async (params?: {
  guildId?: string;
  limit?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> => {
  const stats = { processed: 0, succeeded: 0, failed: 0 };
  if (!isEmbeddingEnabled()) return stats;

  const db = getClient()!;
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));

  let query = db
    .from(T_MEMORY_ITEMS)
    .select('id, title, content, summary')
    .eq('status', 'active')
    .is('embedding', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (params?.guildId) {
    query = query.eq('guild_id', params.guildId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return stats;
  }

  // Process in batches
  for (let i = 0; i < data.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = data.slice(i, i + EMBEDDING_BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (item: { id: string; title?: string; content?: string; summary?: string }) => {
        stats.processed++;
        const text = [item.title, item.summary, item.content]
          .filter(Boolean)
          .join(' ')
          .trim();

        if (!text) {
          stats.failed++;
          return;
        }

        const embedding = await generateEmbedding(text);
        if (!embedding) {
          stats.failed++;
          return;
        }

        const stored = await storeMemoryEmbedding(item.id, embedding);
        if (stored) {
          stats.succeeded++;
        } else {
          stats.failed++;
        }
      }),
    );
  }

  logger.info('[EMBEDDING] Backfill complete: processed=%d succeeded=%d failed=%d',
    stats.processed, stats.succeeded, stats.failed);
  return stats;
};

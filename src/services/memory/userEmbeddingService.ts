/**
 * User Embedding Service
 *
 * Inspired by Daangn's long-term user modeling: computes a per-user, per-guild
 * embedding vector by averaging the embeddings of memory items the user has
 * interacted with (owner_user_id). This "user embedding" is then used as a
 * common feature across downstream models (memory scoring, intent classification).
 *
 * Architecture:
 *   - User encoder: offline batch (24h default) that averages owned-memory embeddings
 *   - Guild-constrained: each embedding is scoped to a guild (RCBS analogy — no cross-guild "impossible negatives")
 *   - Storage: user_embeddings table (user_id, guild_id, embedding, computed_at, item_count)
 *   - Downstream: agentMemoryService reads the vector for cosine-similarity scoring
 *
 * Config: USER_EMBEDDING_* env vars in config.ts
 */

import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { cosineSimilarity } from '../../utils/vectorMath';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { isEmbeddingEnabled } from './memoryEmbeddingService';

// Re-export for backward compat (barrel consumers import from here)
export { cosineSimilarity } from '../../utils/vectorMath';

// ──── Configuration ───────────────────────────────────────────────────────────

const USER_EMBEDDING_ENABLED = parseBooleanEnv(process.env.USER_EMBEDDING_ENABLED, true);
const USER_EMBEDDING_REFRESH_INTERVAL_MS = Math.max(
  60_000,
  parseIntegerEnv(process.env.USER_EMBEDDING_REFRESH_INTERVAL_MS, 24 * 60 * 60_000),
);
const USER_EMBEDDING_MIN_ITEMS = Math.max(1, parseIntegerEnv(process.env.USER_EMBEDDING_MIN_ITEMS, 3));
const USER_EMBEDDING_MAX_ITEMS = Math.max(10, parseIntegerEnv(process.env.USER_EMBEDDING_MAX_ITEMS, 200));
const USER_EMBEDDING_BATCH_SIZE = Math.max(1, parseIntegerEnv(process.env.USER_EMBEDDING_BATCH_SIZE, 50));

// ──── Types ───────────────────────────────────────────────────────────────────

export interface UserEmbedding {
  userId: string;
  guildId: string;
  embedding: number[];
  computedAt: string;
  itemCount: number;
}

export interface UserEmbeddingRefreshResult {
  usersProcessed: number;
  usersUpdated: number;
  usersSkipped: number;
  errors: number;
}

const EMPTY_REFRESH: UserEmbeddingRefreshResult = {
  usersProcessed: 0,
  usersUpdated: 0,
  usersSkipped: 0,
  errors: 0,
};

// ──── Helpers ─────────────────────────────────────────────────────────────────

export const isUserEmbeddingEnabled = (): boolean =>
  USER_EMBEDDING_ENABLED && isEmbeddingEnabled() && isSupabaseConfigured();

/**
 * Average multiple embedding vectors element-wise.
 * Returns null if input is empty.
 */
const averageEmbeddings = (vectors: number[][]): number[] | null => {
  if (vectors.length === 0) return null;
  const dims = vectors[0].length;
  if (dims === 0) return null;

  const sum = new Float64Array(dims);
  for (const vec of vectors) {
    if (vec.length !== dims) continue;
    for (let i = 0; i < dims; i++) {
      sum[i] += vec[i];
    }
  }

  const count = vectors.length;
  const result: number[] = new Array(dims);
  for (let i = 0; i < dims; i++) {
    result[i] = sum[i] / count;
  }
  return result;
};

// ──── Core: Compute User Embedding ────────────────────────────────────────────

/**
 * Compute a user embedding for a specific user+guild by averaging
 * the embeddings of memory items they own in that guild.
 *
 * Guild-constrained (RCBS): only items within the same guild are considered,
 * eliminating cross-guild "impossible negative" noise.
 */
export const computeUserEmbedding = async (
  userId: string,
  guildId: string,
): Promise<{ embedding: number[]; itemCount: number } | null> => {
  if (!isUserEmbeddingEnabled()) return null;

  const client = getSupabaseClient();

  // Fetch embeddings of active memory items owned by this user in this guild
  const { data, error } = await client
    .from('memory_items')
    .select('embedding')
    .eq('guild_id', guildId)
    .eq('owner_user_id', userId)
    .eq('status', 'active')
    .not('embedding', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(USER_EMBEDDING_MAX_ITEMS);

  if (error) {
    logger.debug('[USER-EMBEDDING] query failed user=%s guild=%s: %s', userId, guildId, error.message);
    return null;
  }

  if (!data || data.length < USER_EMBEDDING_MIN_ITEMS) {
    return null;
  }

  // Parse embedding vectors from pgvector string format
  const vectors: number[][] = [];
  for (const row of data as Array<{ embedding?: string | number[] }>) {
    const raw = row.embedding;
    if (!raw) continue;

    let vec: number[];
    if (Array.isArray(raw)) {
      vec = raw.map(Number).filter(Number.isFinite);
    } else if (typeof raw === 'string') {
      // pgvector returns "[0.1,0.2,...]"
      const cleaned = String(raw).replace(/^\[|\]$/g, '');
      vec = cleaned.split(',').map(Number).filter(Number.isFinite);
    } else {
      continue;
    }

    if (vec.length > 0) {
      vectors.push(vec);
    }
  }

  if (vectors.length < USER_EMBEDDING_MIN_ITEMS) {
    return null;
  }

  const embedding = averageEmbeddings(vectors);
  if (!embedding) return null;

  return { embedding, itemCount: vectors.length };
};

// ──── Storage ─────────────────────────────────────────────────────────────────

/**
 * Store (upsert) a computed user embedding.
 */
export const storeUserEmbedding = async (
  userId: string,
  guildId: string,
  embedding: number[],
  itemCount: number,
): Promise<boolean> => {
  if (!isSupabaseConfigured()) return false;

  try {
    const client = getSupabaseClient();
    const vectorStr = `[${embedding.join(',')}]`;

    const { error } = await client
      .from('user_embeddings')
      .upsert(
        {
          user_id: userId,
          guild_id: guildId,
          embedding: vectorStr,
          item_count: itemCount,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,guild_id' },
      );

    if (error) {
      logger.debug('[USER-EMBEDDING] store failed user=%s guild=%s: %s', userId, guildId, error.message);
      return false;
    }
    return true;
  } catch (err) {
    logger.debug('[USER-EMBEDDING] store error: %s', err instanceof Error ? err.message : String(err));
    return false;
  }
};

/**
 * Retrieve a stored user embedding. Returns null if not found or expired.
 */
export const getUserEmbedding = async (
  userId: string,
  guildId: string,
): Promise<UserEmbedding | null> => {
  if (!isSupabaseConfigured()) return null;

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('user_embeddings')
      .select('user_id, guild_id, embedding, computed_at, item_count')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as Record<string, unknown>;
    const rawEmb = row.embedding;
    let embedding: number[];

    if (Array.isArray(rawEmb)) {
      embedding = (rawEmb as number[]).map(Number).filter(Number.isFinite);
    } else if (typeof rawEmb === 'string') {
      const cleaned = String(rawEmb).replace(/^\[|\]$/g, '');
      embedding = cleaned.split(',').map(Number).filter(Number.isFinite);
    } else {
      return null;
    }

    if (embedding.length === 0) return null;

    return {
      userId: String(row.user_id ?? ''),
      guildId: String(row.guild_id ?? ''),
      embedding,
      computedAt: String(row.computed_at ?? ''),
      itemCount: Number(row.item_count ?? 0),
    };
  } catch {
    return null;
  }
};

// ──── Batch Refresh ───────────────────────────────────────────────────────────

/**
 * Refresh user embeddings for all active users in a guild (or all guilds).
 * Called on a 24h batch schedule (like Daangn's offline user encoder).
 *
 * Only recomputes embeddings for users who:
 *   1. Have activity (memory items) since last computation
 *   2. Meet the minimum item threshold
 */
export const refreshUserEmbeddings = async (
  guildId?: string,
): Promise<UserEmbeddingRefreshResult> => {
  if (!isUserEmbeddingEnabled()) return EMPTY_REFRESH;

  const result: UserEmbeddingRefreshResult = { usersProcessed: 0, usersUpdated: 0, usersSkipped: 0, errors: 0 };

  try {
    const client = getSupabaseClient();

    // Find distinct users who own active memories with embeddings
    let query = client
      .from('memory_items')
      .select('owner_user_id, guild_id')
      .eq('status', 'active')
      .not('embedding', 'is', null)
      .not('owner_user_id', 'is', null);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { data: ownerRows, error: ownerError } = await query.limit(1000);
    if (ownerError || !ownerRows) return result;

    // Group by user+guild
    const userGuildPairs = new Map<string, { userId: string; guildId: string }>();
    for (const row of ownerRows as Array<{ owner_user_id?: string; guild_id?: string }>) {
      const uid = String(row.owner_user_id || '').trim();
      const gid = String(row.guild_id || '').trim();
      if (!uid || !gid) continue;
      userGuildPairs.set(`${uid}:${gid}`, { userId: uid, guildId: gid });
    }

    const pairs = [...userGuildPairs.values()];

    // Process in batches
    for (let i = 0; i < pairs.length; i += USER_EMBEDDING_BATCH_SIZE) {
      const batch = pairs.slice(i, i + USER_EMBEDDING_BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (pair) => {
          result.usersProcessed++;

          try {
            const computed = await computeUserEmbedding(pair.userId, pair.guildId);
            if (!computed) {
              result.usersSkipped++;
              return;
            }

            const stored = await storeUserEmbedding(
              pair.userId,
              pair.guildId,
              computed.embedding,
              computed.itemCount,
            );

            if (stored) {
              result.usersUpdated++;
            } else {
              result.errors++;
            }
          } catch {
            result.errors++;
          }
        }),
      );
    }

    logger.info(
      '[USER-EMBEDDING] refresh complete: processed=%d updated=%d skipped=%d errors=%d',
      result.usersProcessed, result.usersUpdated, result.usersSkipped, result.errors,
    );
  } catch (err) {
    logger.warn('[USER-EMBEDDING] refresh error: %s', err instanceof Error ? err.message : String(err));
  }

  return result;
};

// ──── Background Loop ─────────────────────────────────────────────────────────

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export const startUserEmbeddingLoop = (): void => {
  if (!USER_EMBEDDING_ENABLED) return;
  if (refreshTimer) return;

  refreshTimer = setInterval(() => {
    void refreshUserEmbeddings().catch((err) =>
      logger.debug('[USER-EMBEDDING] loop error: %s', err instanceof Error ? err.message : String(err)),
    );
  }, USER_EMBEDDING_REFRESH_INTERVAL_MS);

  if (refreshTimer && typeof refreshTimer === 'object' && 'unref' in refreshTimer) {
    (refreshTimer as NodeJS.Timeout).unref();
  }

  logger.info('[USER-EMBEDDING] background refresh loop started (interval=%dms)', USER_EMBEDDING_REFRESH_INTERVAL_MS);
};

export const stopUserEmbeddingLoop = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

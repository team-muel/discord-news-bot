/**
 * Obsidian Document Cache Service
 * 
 * Caches frequently accessed Obsidian documents in Supabase to reduce CLI calls.
 * Maintains TTL-based eviction and tracks query statistics.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';
import { parseIntegerEnv } from '../../utils/env';

const CACHE_TTL_MS = Math.max(60_000, parseIntegerEnv(process.env.OBSIDIAN_RAG_CACHE_TTL_MS, 3_600_000));
const CACHE_ENABLED = process.env.OBSIDIAN_RAG_CACHE_ENABLED !== 'false';
const HIT_FLUSH_INTERVAL_MS = 30_000;
const MAX_PENDING_HIT_ENTRIES = 500; // Prevent unbounded in-memory growth
const MAX_PARALLEL_LOADS = 10; // Limit concurrent vault loads to prevent memory pressure

// Batched hit counter: accumulate in-memory, flush periodically
const pendingHitCounts = new Map<string, number>();

const flushHitCounts = async (): Promise<void> => {
  if (pendingHitCounts.size === 0 || !isSupabaseConfigured()) return;
  const batch = new Map(pendingHitCounts);
  pendingHitCounts.clear();
  const db = getSupabaseClient();
  const now = new Date().toISOString();

  // Parallel atomic increments — each UPDATE is independent.
  // Uses RPC to atomically increment hit_count without a separate SELECT.
  const tasks = [...batch.entries()].map(([filePath, increment]) => {
    const rpcCall = async () => {
      const { error } = await db.rpc('increment_obsidian_cache_hit', {
        p_file_path: filePath,
        p_increment: increment,
        p_accessed_at: now,
      });
      if (error) {
        // Fallback: plain update (non-atomic but still avoids N+1 SELECT)
        await db
          .from('obsidian_cache')
          .update({ last_accessed_at: now })
          .eq('file_path', filePath)
          .then(() => undefined);
      }
    };
    return rpcCall().catch(() => { /* best-effort */ });
  });
  // Limit concurrency to prevent connection pool exhaustion
  for (let i = 0; i < tasks.length; i += MAX_PARALLEL_LOADS) {
    await Promise.allSettled(tasks.slice(i, i + MAX_PARALLEL_LOADS));
  }
};

// Lazy flush: timer is only active when there are pending hits to flush.
// Starts on first cache hit, auto-stops when buffer is empty.
let flushTimer: ReturnType<typeof setInterval> | null = null;

const ensureFlushTimer = (): void => {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (pendingHitCounts.size === 0) {
      // No pending data — stop timer until next cache hit
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      return;
    }
    void flushHitCounts();
  }, HIT_FLUSH_INTERVAL_MS);
  if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref();
  }
};

export interface CachedDocument {
  filePath: string;
  content: string;
  frontmatter: Record<string, any>;
  cachedAt: string;
  hitCount: number;
}

/**
 * Initialize cache table (idempotent)
 */
export async function initObsidianCache(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    logger.warn('[OBSIDIAN-CACHE] Supabase not configured, cache disabled');
    return false;
  }

  try {
    const db = getSupabaseClient();

    // Check if table exists by querying
    const { error } = await db
      .from('obsidian_cache')
      .select('id')
      .limit(1);

    if (error && error.code === 'PGRST116') {
      logger.warn('[OBSIDIAN-CACHE] Table not found, will be created via migration');
    }

    logger.info('[OBSIDIAN-CACHE] Initialized');
    return true;
  } catch (error) {
    logger.error('[OBSIDIAN-CACHE] Initialization failed: %o', error);
    return false;
  }
}

/**
 * Get cached document, returns null if expired or not found
 */
export async function getCachedDocument(filePath: string): Promise<CachedDocument | null> {
  if (!CACHE_ENABLED || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const db = getSupabaseClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data, error } = await db
      .from('obsidian_cache')
      .select('file_path, content, frontmatter, cached_at, hit_count')
      .eq('file_path', filePath)
      .gt('cached_at', cutoff)
      .single();

    if (error || !data) {
      return null;
    }

    // Batch hit counter increment instead of per-read Supabase UPDATE
    // Guard against unbounded map growth from many unique file paths
    if (pendingHitCounts.size < MAX_PENDING_HIT_ENTRIES) {
      pendingHitCounts.set(filePath, (pendingHitCounts.get(filePath) ?? 0) + 1);
      ensureFlushTimer();
    }

    logger.debug('[OBSIDIAN-CACHE] HIT %s', filePath);

    return {
      filePath: data.file_path,
      content: data.content,
      frontmatter: data.frontmatter || {},
      cachedAt: data.cached_at,
      hitCount: (data.hit_count || 0) + 1,
    };
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Get failed for %s: %o', filePath, error);
    return null;
  }
}

/**
 * Batch-fetch multiple cached documents in a single Supabase query.
 * Replaces N individual getCachedDocument() calls with 1 round-trip.
 */
export async function getCachedDocumentsBatch(filePaths: string[]): Promise<Map<string, CachedDocument>> {
  const result = new Map<string, CachedDocument>();
  if (!CACHE_ENABLED || !isSupabaseConfigured() || filePaths.length === 0) {
    return result;
  }

  try {
    const db = getSupabaseClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data, error } = await db
      .from('obsidian_cache')
      .select('file_path, content, frontmatter, cached_at, hit_count')
      .in('file_path', filePaths)
      .gt('cached_at', cutoff);

    if (error || !data) {
      return result;
    }

    for (const row of data) {
      const fp = String(row.file_path || '');
      if (!fp) continue;

      if (pendingHitCounts.size < MAX_PENDING_HIT_ENTRIES) {
        pendingHitCounts.set(fp, (pendingHitCounts.get(fp) || (row.hit_count || 0)) + 1);
      }

      result.set(fp, {
        filePath: fp,
        content: row.content,
        frontmatter: row.frontmatter || {},
        cachedAt: row.cached_at,
        hitCount: (row.hit_count || 0) + 1,
      });
    }

    logger.debug('[OBSIDIAN-CACHE] BATCH HIT %d/%d', result.size, filePaths.length);
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Batch get failed: %o', error);
    return result;
  }
}

/**
 * Cache a document
 */
export async function cacheDocument(
  filePath: string,
  content: string,
  frontmatter: Record<string, any> = {}
): Promise<boolean> {
  if (!CACHE_ENABLED || !isSupabaseConfigured()) {
    return false;
  }

  try {
    const db = getSupabaseClient();

    const { error } = await db.from('obsidian_cache').upsert(
      {
        file_path: filePath,
        content,
        frontmatter,
        cached_at: new Date().toISOString(),
        hit_count: 0,
      },
      { onConflict: 'file_path' }
    );

    if (error) {
      logger.warn('[OBSIDIAN-CACHE] Cache failed for %s: %o', filePath, error);
      return false;
    }

    logger.debug('[OBSIDIAN-CACHE] Cached %s (%d bytes)', filePath, content.length);
    return true;
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Upsert failed: %o', error);
    return false;
  }
}

/**
 * Load multiple documents with cache fallback
 * Tries cache first, then loads uncached from vault
 */
export async function loadDocumentsWithCache(
  filePaths: string[],
  loader: (path: string) => Promise<string | null>
): Promise<Map<string, CachedDocument>> {
  const docs = new Map<string, CachedDocument>();
  const uncached: string[] = [];

  // Phase 1: Batch cache lookup — single Supabase IN query instead of N individual queries
  const cachedBatch = await getCachedDocumentsBatch(filePaths);

  for (const path of filePaths) {
    const cached = cachedBatch.get(path);
    if (cached) {
      docs.set(path, cached);
    } else {
      uncached.push(path);
    }
  }

  // Phase 2: Load uncached documents in batches to limit concurrent memory usage
  for (let i = 0; i < uncached.length; i += MAX_PARALLEL_LOADS) {
    const batch = uncached.slice(i, i + MAX_PARALLEL_LOADS);
    await Promise.all(
      batch.map(async (path) => {
        try {
          const content = await loader(path);
          if (content) {
            const doc: CachedDocument = {
              filePath: path,
              content,
              frontmatter: {},
              cachedAt: new Date().toISOString(),
              hitCount: 0,
            };
            docs.set(path, doc);

            // Cache for next time
            await cacheDocument(path, content, {});
          }
        } catch (error) {
          logger.warn('[OBSIDIAN-CACHE] Load failed for %s: %o', path, error);
        }
      })
    );
  }

  return docs;
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalDocs: number;
  activeDocs: number;
  totalHits: number;
  averageHitsPerDoc: number;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const db = getSupabaseClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data, error } = await db
      .from('obsidian_cache')
      .select('hit_count')
      .gt('cached_at', cutoff);

    if (error || !data) {
      return null;
    }

    const totalHits = data.reduce((sum, row) => sum + (row.hit_count || 0), 0);

    return {
      totalDocs: data.length,
      activeDocs: data.length,
      totalHits,
      averageHitsPerDoc: data.length > 0 ? totalHits / data.length : 0,
    };
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Stats fetch failed: %o', error);
    return null;
  }
}

/**
 * Clear expired documents from cache
 */
export async function clearExpiredCache(): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  try {
    const db = getSupabaseClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data, error } = await db
      .from('obsidian_cache')
      .delete()
      .lt('cached_at', cutoff)
      .select('file_path');

    if (error) {
      logger.warn('[OBSIDIAN-CACHE] Expiration clear failed: %o', error);
      return 0;
    }

    const count = data?.length || 0;
    logger.info('[OBSIDIAN-CACHE] Cleared %d expired documents', count);
    return count;
  } catch (error) {
    logger.error('[OBSIDIAN-CACHE] Clear failed: %o', error);
    return 0;
  }
}

/**
 * Obsidian Document Cache Service
 * 
 * Caches frequently accessed Obsidian documents in Supabase to reduce CLI calls.
 * Maintains TTL-based eviction and tracks query statistics.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import logger from '../logger';
import { parseIntegerEnv } from '../utils/env';

const CACHE_TTL_MS = Math.max(60_000, parseIntegerEnv(process.env.OBSIDIAN_RAG_CACHE_TTL_MS, 3_600_000));
const CACHE_ENABLED = process.env.OBSIDIAN_RAG_CACHE_ENABLED !== 'false';

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

    // Increment hit counter (best-effort, don't block on error)
    try {
      await db
        .from('obsidian_cache')
        .update({
          hit_count: (data.hit_count || 0) + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq('file_path', filePath);
    } catch (error) {
      logger.debug('[OBSIDIAN-CACHE] Hit counter increment failed: %o', error);
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

  // Phase 1: Check cache in parallel
  const cachedRows = await Promise.all(
    filePaths.map(async (path) => ({
      path,
      cached: await getCachedDocument(path),
    }))
  );

  for (const row of cachedRows) {
    if (row.cached) {
      docs.set(row.path, row.cached);
    } else {
      uncached.push(row.path);
    }
  }

  // Phase 2: Load uncached documents in parallel
  await Promise.all(
    uncached.map(async (path) => {
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

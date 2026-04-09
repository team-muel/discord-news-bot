/**
 * Obsidian Document Cache Service
 * 
 * Caches frequently accessed Obsidian documents in Supabase to reduce CLI calls.
 * Maintains TTL-based eviction and tracks query statistics.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';
import { parseBooleanEnv, parseMinIntEnv } from '../../utils/env';
import { getErrorMessage } from '../../utils/errorMessage';

const CACHE_TTL_MS = parseMinIntEnv(process.env.OBSIDIAN_RAG_CACHE_TTL_MS, 3_600_000, 60_000);
const CACHE_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_RAG_CACHE_ENABLED, true);
const HIT_FLUSH_INTERVAL_MS = 30_000;
const MAX_PENDING_HIT_ENTRIES = 500; // Prevent unbounded in-memory growth
const MAX_PARALLEL_LOADS = 10; // Limit concurrent vault loads to prevent memory pressure
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

const stripWrappingQuotes = (value: string): string => {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseFrontmatterScalar = (rawValue: string): string | number | boolean => {
  const value = stripWrappingQuotes(rawValue);
  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true';
  }
  const numeric = Number(value);
  if (value !== '' && Number.isFinite(numeric)) {
    return numeric;
  }
  return value;
};

const parseFrontmatterValue = (rawValue: string): string | number | boolean | string[] => {
  const value = String(rawValue || '').trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(',')
      .map((entry) => stripWrappingQuotes(entry))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return parseFrontmatterScalar(value);
};

export function parseObsidianFrontmatter(markdown: string): Record<string, any> {
  const match = String(markdown || '').match(FRONTMATTER_PATTERN);
  if (!match) {
    return {};
  }

  const result: Record<string, any> = {};
  const lines = match[1].split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const propertyMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!propertyMatch) {
      continue;
    }

    const [, key, inlineValue] = propertyMatch;
    const trimmedInlineValue = String(inlineValue || '').trim();
    if (trimmedInlineValue.length > 0) {
      result[key] = parseFrontmatterValue(trimmedInlineValue);
      continue;
    }

    const listValues: string[] = [];
    let lookahead = index + 1;
    while (lookahead < lines.length) {
      const nextLine = lines[lookahead];
      const listMatch = nextLine.match(/^\s*-\s*(.+)$/);
      if (!listMatch) {
        break;
      }
      listValues.push(stripWrappingQuotes(listMatch[1]));
      lookahead += 1;
    }

    if (listValues.length > 0) {
      result[key] = listValues;
      index = lookahead - 1;
      continue;
    }

    result[key] = '';
  }

  return result;
}

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

export interface ObsidianCacheStats {
  enabled: boolean;
  supabaseConfigured: boolean;
  ttlMs: number;
  pendingHitEntries: number;
  totalDocs: number;
  activeDocs: number;
  staleDocs: number;
  totalHits: number;
  averageHitsPerDoc: number;
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
    logger.error('[OBSIDIAN-CACHE] Initialization failed: %s', getErrorMessage(error));
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

    const parsedFrontmatter = data.frontmatter && Object.keys(data.frontmatter).length > 0
      ? data.frontmatter
      : parseObsidianFrontmatter(data.content || '');

    return {
      filePath: data.file_path,
      content: data.content,
      frontmatter: parsedFrontmatter,
      cachedAt: data.cached_at,
      hitCount: (data.hit_count || 0) + 1,
    };
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Get failed for %s: %s', filePath, getErrorMessage(error));
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

      const parsedFrontmatter = row.frontmatter && Object.keys(row.frontmatter).length > 0
        ? row.frontmatter
        : parseObsidianFrontmatter(row.content || '');

      if (pendingHitCounts.size < MAX_PENDING_HIT_ENTRIES) {
        pendingHitCounts.set(fp, (pendingHitCounts.get(fp) || (row.hit_count || 0)) + 1);
      }

      result.set(fp, {
        filePath: fp,
        content: row.content,
        frontmatter: parsedFrontmatter,
        cachedAt: row.cached_at,
        hitCount: (row.hit_count || 0) + 1,
      });
    }

    logger.debug('[OBSIDIAN-CACHE] BATCH HIT %d/%d', result.size, filePaths.length);
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Batch get failed: %s', getErrorMessage(error));
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
      logger.warn('[OBSIDIAN-CACHE] Cache failed for %s: %s', filePath, getErrorMessage(error));
      return false;
    }

    logger.debug('[OBSIDIAN-CACHE] Cached %s (%d bytes)', filePath, content.length);
    return true;
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Upsert failed: %s', getErrorMessage(error));
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
            const frontmatter = parseObsidianFrontmatter(content);
            const doc: CachedDocument = {
              filePath: path,
              content,
              frontmatter,
              cachedAt: new Date().toISOString(),
              hitCount: 0,
            };
            docs.set(path, doc);

            // Cache for next time
            await cacheDocument(path, content, frontmatter);
          }
        } catch (error) {
          logger.warn('[OBSIDIAN-CACHE] Load failed for %s: %s', path, getErrorMessage(error));
        }
      })
    );
  }

  return docs;
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<ObsidianCacheStats | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const db = getSupabaseClient();
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

    const { data, error } = await db
      .from('obsidian_cache')
      .select('cached_at, hit_count');

    if (error || !data) {
      return null;
    }

    const totalDocs = data.length;
    const activeDocs = data.reduce((count, row) => count + (String(row.cached_at || '') > cutoff ? 1 : 0), 0);
    const totalHits = data.reduce((sum, row) => sum + (row.hit_count || 0), 0);

    return {
      enabled: CACHE_ENABLED,
      supabaseConfigured: true,
      ttlMs: CACHE_TTL_MS,
      pendingHitEntries: pendingHitCounts.size,
      totalDocs,
      activeDocs,
      staleDocs: Math.max(0, totalDocs - activeDocs),
      totalHits,
      averageHitsPerDoc: totalDocs > 0 ? totalHits / totalDocs : 0,
    };
  } catch (error) {
    logger.warn('[OBSIDIAN-CACHE] Stats fetch failed: %s', getErrorMessage(error));
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
      logger.warn('[OBSIDIAN-CACHE] Expiration clear failed: %s', getErrorMessage(error));
      return 0;
    }

    const count = data?.length || 0;
    logger.info('[OBSIDIAN-CACHE] Cleared %d expired documents', count);
    return count;
  } catch (error) {
    logger.error('[OBSIDIAN-CACHE] Clear failed: %s', getErrorMessage(error));
    return 0;
  }
}

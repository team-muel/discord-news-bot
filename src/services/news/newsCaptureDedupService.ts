/**
 * Persistent deduplication for external news captures.
 * Uses Supabase `news_capture_fingerprints` table when available,
 * falls back to in-process TtlCache when Supabase is not configured.
 */
import crypto from 'crypto';
import { TtlCache } from '../../utils/ttlCache';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';

const FINGERPRINT_TABLE = 'news_capture_fingerprints';

// In-memory fallback (single-process, lost on restart)
const memoryCache = new TtlCache<true>(10_000);

/**
 * Builds a stable SHA-1 fingerprint for a news capture batch.
 * Combines guildId + normalised goal + sorted canonical URLs.
 */
export const buildNewsFingerprint = (params: {
  guildId: string;
  goal: string;
  canonicalUrls: string[];
}): string => {
  const seed = [
    params.guildId,
    params.goal.trim().toLowerCase().slice(0, 200),
    ...[...params.canonicalUrls].sort().map((u) => u.toLowerCase()),
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex');
};

/**
 * Returns true if this fingerprint was already recorded (duplicate).
 * Checks DB first; falls back to memory cache.
 */
export const isNewsFingerprinted = async (params: {
  guildId: string;
  fingerprint: string;
  ttlMs: number;
}): Promise<boolean> => {
  const memKey = `${params.guildId}:${params.fingerprint}`;

  if (!isSupabaseConfigured()) {
    return Boolean(memoryCache.get(memKey));
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(FINGERPRINT_TABLE)
      .select('id')
      .eq('guild_id', params.guildId)
      .eq('fingerprint', params.fingerprint)
      .maybeSingle();

    if (error) {
      // DB 오류 시 메모리 캐시로 폴백
      return Boolean(memoryCache.get(memKey));
    }

    return Boolean(data);
  } catch (err) {
    logger.debug('[NEWS-DEDUP] DB check fallback to memory: %s', err instanceof Error ? err.message : String(err));
    return Boolean(memoryCache.get(memKey));
  }
};

/**
 * Records the fingerprint so future calls to isNewsFingerprinted return true.
 */
export const recordNewsFingerprint = async (params: {
  guildId: string;
  fingerprint: string;
  goal: string;
  ttlMs: number;
}): Promise<void> => {
  const memKey = `${params.guildId}:${params.fingerprint}`;
  memoryCache.set(memKey, true, params.ttlMs);

  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const expiresAt = new Date(Date.now() + params.ttlMs).toISOString();
    await client
      .from(FINGERPRINT_TABLE)
      .upsert(
        {
          guild_id: params.guildId,
          fingerprint: params.fingerprint,
          goal_preview: params.goal.trim().slice(0, 200),
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'guild_id,fingerprint', ignoreDuplicates: true },
      );
  } catch (err) {
    logger.debug('[NEWS-DEDUP] DB record fallback to memory: %s', err instanceof Error ? err.message : String(err));
  }
};

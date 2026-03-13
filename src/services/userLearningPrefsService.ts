/**
 * Per-user learning preference store.
 *
 * Semantics:
 *   enabled = true  → 메시지를 학습에 포함 (기본값)
 *   enabled = false → 학습 제외 (잊어줘와 달리 기존 데이터 유지, 앞으로만 수집 안 함)
 *
 * Storage: Supabase `user_learning_prefs` table when available, in-memory map otherwise.
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { TtlCache } from '../utils/ttlCache';

const TABLE = 'user_learning_prefs';
const CACHE_TTL_MS = 60_000;

const memoryStore = new Map<string, boolean>();
const readCache = new TtlCache<boolean>(5000);

const cacheKey = (userId: string, guildId: string) => `${guildId}:${userId}`;

/**
 * Returns true when the user allows learning in this guild.
 * Defaults to true (opt-in by default).
 */
export const isUserLearningEnabled = async (userId: string, guildId: string): Promise<boolean> => {
  const key = cacheKey(userId, guildId);
  const cached = readCache.get(key);
  if (cached !== null) {
    return cached;
  }

  if (!isSupabaseConfigured()) {
    return memoryStore.get(key) ?? true;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(TABLE)
      .select('enabled')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .maybeSingle();

    if (error || !data) {
      readCache.set(key, true, CACHE_TTL_MS);
      return true;
    }

    const enabled = Boolean(data.enabled);
    readCache.set(key, enabled, CACHE_TTL_MS);
    return enabled;
  } catch {
    return true;
  }
};

/**
 * Sets the user's learning preference.
 * Returns the saved value.
 */
export const setUserLearningEnabled = async (
  userId: string,
  guildId: string,
  enabled: boolean,
  actorId: string,
): Promise<boolean> => {
  const key = cacheKey(userId, guildId);

  memoryStore.set(key, enabled);
  readCache.set(key, enabled, CACHE_TTL_MS);

  if (!isSupabaseConfigured()) {
    return enabled;
  }

  try {
    const client = getSupabaseClient();
    await client
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          guild_id: guildId,
          enabled,
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,guild_id' },
      );
  } catch {
    // Memory fallback already applied.
  }

  return enabled;
};

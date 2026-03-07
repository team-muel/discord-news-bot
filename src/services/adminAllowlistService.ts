import {
  ADMIN_ALLOWLIST_CACHE_TTL_MS,
  ADMIN_ALLOWLIST_ROLE_VALUE,
  ADMIN_ALLOWLIST_TABLE,
  RESEARCH_PRESET_ADMIN_USER_IDS,
} from '../config';
import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const staticAllowlist = new Set(
  RESEARCH_PRESET_ADMIN_USER_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

let cachedAllowlist: Set<string> | null = null;
let cachedAtMs = 0;
let lastFetchErrorAtMs = 0;

const getRowUserId = (row: Record<string, unknown>): string | null => {
  const candidates = [row.user_id, row.discord_user_id, row.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return null;
};

const mergeDynamicAllowlist = async (): Promise<Set<string>> => {
  const merged = new Set(staticAllowlist);
  if (!isSupabaseConfigured()) {
    return merged;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(ADMIN_ALLOWLIST_TABLE)
    .select('*')
    .limit(1000);

  if (error) {
    throw error;
  }

  for (const rawRow of data ?? []) {
    const row = rawRow as Record<string, unknown>;
    const rowRole = typeof row.role === 'string' ? row.role.trim().toLowerCase() : null;
    if (rowRole && rowRole !== ADMIN_ALLOWLIST_ROLE_VALUE.toLowerCase()) {
      continue;
    }

    if (row.active === false) {
      continue;
    }

    const userId = getRowUserId(row);
    if (userId) {
      merged.add(userId);
    }
  }

  return merged;
};

export async function getAdminAllowlist(): Promise<Set<string>> {
  const now = Date.now();
  const cacheTtlMs = Math.max(1_000, ADMIN_ALLOWLIST_CACHE_TTL_MS);
  if (cachedAllowlist && now - cachedAtMs < cacheTtlMs) {
    return new Set(cachedAllowlist);
  }

  try {
    cachedAllowlist = await mergeDynamicAllowlist();
    cachedAtMs = now;
    return new Set(cachedAllowlist);
  } catch (error) {
    if (now - lastFetchErrorAtMs >= 60_000) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[AUTH] Failed to refresh admin allowlist from %s: %s', ADMIN_ALLOWLIST_TABLE, message);
      lastFetchErrorAtMs = now;
    }

    if (cachedAllowlist) {
      return new Set(cachedAllowlist);
    }

    return new Set(staticAllowlist);
  }
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const allowlist = await getAdminAllowlist();
  return allowlist.has(userId);
}

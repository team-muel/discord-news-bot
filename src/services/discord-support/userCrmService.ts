/**
 * User CRM Service — global user profiles + per-guild activity tracking.
 *
 * Discord-provided data (username, avatar, roles, etc.) is NOT stored.
 * Read it via Discord API at query time. Only unique aggregated data lives here.
 *
 * Tables: user_profiles, guild_memberships
 * RPC:    track_user_activity
 */
import { isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_USER_PROFILES, T_GUILD_MEMBERSHIPS } from '../infra/tableRegistry';
import { TtlCache } from '../../utils/ttlCache';
import logger from '../../logger';
import { logCatchError } from '../../utils/errorMessage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityCounter =
  | 'message_count'
  | 'command_count'
  | 'reaction_given_count'
  | 'reaction_received_count'
  | 'session_count';

export interface UserProfile {
  userId: string;
  badges: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastActiveAt: string;
}

export interface GuildMembership {
  guildId: string;
  userId: string;
  messageCount: number;
  commandCount: number;
  reactionGivenCount: number;
  reactionReceivedCount: number;
  sessionCount: number;
  firstSeenAt: string;
  lastActiveAt: string;
}

export interface UserCrmSnapshot {
  profile: UserProfile;
  membership: GuildMembership | null;
  guilds: GuildMembership[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDiscordId = (value: unknown): value is string => {
  const text = String(value || '').trim();
  return /^\d{6,30}$/.test(text);
};

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// ---------------------------------------------------------------------------
// Write-behind buffer — batch multiple activity signals into fewer RPC calls
// ---------------------------------------------------------------------------

interface PendingActivity {
  userId: string;
  guildId: string;
  counter: ActivityCounter;
  delta: number;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 200;
const pendingBuffer = new Map<string, PendingActivity>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let isFlushing = false;

const bufferKey = (userId: string, guildId: string, counter: ActivityCounter) =>
  `${guildId}:${userId}:${counter}`;

const flushActivityBuffer = async (): Promise<void> => {
  if (pendingBuffer.size === 0) return;
  if (isFlushing) return; // backpressure: skip if already flushing
  if (!isSupabaseConfigured()) {
    pendingBuffer.clear();
    return;
  }

  isFlushing = true;
  const batch = [...pendingBuffer.values()];
  pendingBuffer.clear();

  const client = getClient();
  const results = await Promise.allSettled(
    batch.map((entry) =>
      client.rpc('track_user_activity', {
        p_user_id: entry.userId,
        p_guild_id: entry.guildId,
        p_counter: entry.counter,
        p_delta: entry.delta,
      }),
    ),
  );

  const failCount = results.filter((r) => r.status === 'rejected').length;
  if (failCount > 0) {
    logger.warn('[CRM] activity flush: %d/%d failed', failCount, batch.length);
  }
  isFlushing = false;
};

const ensureFlushTimer = (): void => {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushActivityBuffer().catch((err) =>
      logger.debug('[CRM] flush error: %s', err instanceof Error ? err.message : String(err)),
    );
  }, FLUSH_INTERVAL_MS);
  if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref();
  }
};

// ---------------------------------------------------------------------------
// Public API: Track Activity
// ---------------------------------------------------------------------------

export interface TrackActivityParams {
  userId: string;
  guildId: string;
  counter: ActivityCounter;
  delta?: number;
}

/**
 * Buffer a user activity signal. Flushed to Supabase every 5s.
 * Fire-and-forget — never throws.
 */
export const trackUserActivity = (params: TrackActivityParams): void => {
  if (!isDiscordId(params.userId) || !isDiscordId(params.guildId)) return;

  const key = bufferKey(params.userId, params.guildId, params.counter);
  const existing = pendingBuffer.get(key);

  if (existing) {
    existing.delta += params.delta ?? 1;
  } else {
    pendingBuffer.set(key, {
      userId: params.userId,
      guildId: params.guildId,
      counter: params.counter,
      delta: params.delta ?? 1,
    });
  }

  if (pendingBuffer.size >= MAX_BUFFER_SIZE) {
    void flushActivityBuffer().catch(logCatchError(logger, '[CRM] flushActivityBuffer'));
  }

  ensureFlushTimer();
};

// ---------------------------------------------------------------------------
// Public API: Read
// ---------------------------------------------------------------------------

const profileCache = new TtlCache<UserProfile | null>(5000);
const membershipCache = new TtlCache<GuildMembership | null>(5000);

const PROFILE_CACHE_TTL = 30_000;
const MEMBERSHIP_CACHE_TTL = 30_000;

const mapProfile = (row: Record<string, unknown>): UserProfile => ({
  userId: String(row.user_id ?? ''),
  badges: Array.isArray(row.badges) ? row.badges.map(String) : [],
  tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
  metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))
    ? row.metadata as Record<string, unknown>
    : {},
  firstSeenAt: String(row.first_seen_at ?? ''),
  lastActiveAt: String(row.last_active_at ?? ''),
});

const mapMembership = (row: Record<string, unknown>): GuildMembership => ({
  guildId: String(row.guild_id ?? ''),
  userId: String(row.user_id ?? ''),
  messageCount: toNumber(row.message_count),
  commandCount: toNumber(row.command_count),
  reactionGivenCount: toNumber(row.reaction_given_count),
  reactionReceivedCount: toNumber(row.reaction_received_count),
  sessionCount: toNumber(row.session_count),
  firstSeenAt: String(row.first_seen_at ?? ''),
  lastActiveAt: String(row.last_active_at ?? ''),
});

/**
 * Get the global profile for a user. Returns null if not found.
 */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  if (!isDiscordId(userId) || !isSupabaseConfigured()) return null;

  const cached = profileCache.get(userId);
  if (cached !== null) return cached;

  const qb = fromTable(T_USER_PROFILES);
  if (!qb) return null;

  try {
    const { data, error } = await qb
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      profileCache.set(userId, null, PROFILE_CACHE_TTL);
      return null;
    }

    const profile = mapProfile(data as Record<string, unknown>);
    profileCache.set(userId, profile, PROFILE_CACHE_TTL);
    return profile;
  } catch {
    return null;
  }
};

/**
 * Get the guild membership for a user in a specific guild.
 */
export const getGuildMembership = async (
  guildId: string,
  userId: string,
): Promise<GuildMembership | null> => {
  if (!isDiscordId(guildId) || !isDiscordId(userId) || !isSupabaseConfigured()) return null;

  const cacheKey = `${guildId}:${userId}`;
  const cached = membershipCache.get(cacheKey);
  if (cached !== null) return cached;

  const qb = fromTable(T_GUILD_MEMBERSHIPS);
  if (!qb) return null;

  try {
    const { data, error } = await qb
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      membershipCache.set(cacheKey, null, MEMBERSHIP_CACHE_TTL);
      return null;
    }

    const membership = mapMembership(data as Record<string, unknown>);
    membershipCache.set(cacheKey, membership, MEMBERSHIP_CACHE_TTL);
    return membership;
  } catch {
    return null;
  }
};

/**
 * List all guild memberships for a user (cross-guild).
 */
export const listUserGuildMemberships = async (
  userId: string,
  limit = 20,
): Promise<GuildMembership[]> => {
  if (!isDiscordId(userId)) return [];

  const qb = fromTable(T_GUILD_MEMBERSHIPS);
  if (!qb) return [];

  try {
    const { data, error } = await qb
      .select('*')
      .eq('user_id', userId)
      .order('last_active_at', { ascending: false })
      .limit(Math.min(limit, 50));

    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map(mapMembership);
  } catch {
    return [];
  }
};

/**
 * Get a full CRM snapshot: profile + current guild membership + all guilds.
 */
export const getUserCrmSnapshot = async (
  userId: string,
  guildId?: string,
): Promise<UserCrmSnapshot | null> => {
  const profile = await getUserProfile(userId);
  if (!profile) return null;

  const [membership, guilds] = await Promise.all([
    guildId ? getGuildMembership(guildId, userId) : Promise.resolve(null),
    listUserGuildMemberships(userId),
  ]);

  return { profile, membership, guilds };
};

/**
 * Get leaderboard for a guild by a specific counter.
 */
export const getGuildLeaderboard = async (
  guildId: string,
  counter: ActivityCounter = 'message_count',
  limit = 10,
): Promise<GuildMembership[]> => {
  if (!isDiscordId(guildId)) return [];

  const columnMap: Record<ActivityCounter, string> = {
    message_count: 'message_count',
    command_count: 'command_count',
    reaction_given_count: 'reaction_given_count',
    reaction_received_count: 'reaction_received_count',
    session_count: 'session_count',
  };
  const column = columnMap[counter] ?? 'message_count';

  const qb = fromTable(T_GUILD_MEMBERSHIPS);
  if (!qb) return [];

  try {
    const { data, error } = await qb
      .select('*')
      .eq('guild_id', guildId)
      .order(column, { ascending: false })
      .limit(Math.min(limit, 50));

    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map(mapMembership);
  } catch {
    return [];
  }
};

/**
 * Update user profile metadata (badges, tags, etc.). Admin operation.
 */
export const updateUserProfileMeta = async (
  userId: string,
  updates: {
    badges?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> => {
  if (!isDiscordId(userId)) return false;

  const qb = fromTable(T_USER_PROFILES);
  if (!qb) return false;

  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (updates.badges) payload.badges = updates.badges.map(String).slice(0, 50);
    if (updates.tags) payload.tags = updates.tags.map(String).slice(0, 50);
    if (updates.metadata && typeof updates.metadata === 'object') {
      payload.metadata = updates.metadata;
    }

    const { error } = await qb
      .update(payload)
      .eq('user_id', userId);

    if (error) {
      logger.warn('[CRM] updateUserProfileMeta failed: %s', error.message);
      return false;
    }

    profileCache.delete(userId);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Flush pending activity on shutdown. */
export const shutdownCrm = async (): Promise<void> => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushActivityBuffer();
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export const __test = {
  get pendingBuffer() {
    return pendingBuffer;
  },
  flushActivityBuffer,
  resetFlushTimer() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    pendingBuffer.clear();
    isFlushing = false;
  },
  get isFlushing() {
    return isFlushing;
  },
};

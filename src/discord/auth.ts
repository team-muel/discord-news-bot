/**
 * Login-session cache + feature-access gate.
 * Wraps Supabase-backed session persistence with an in-process TTL map.
 */
import { type ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { isUserAdmin } from '../services/adminAllowlistService';
import {
  getDiscordLoginSessionExpiryMs,
  purgeExpiredDiscordLoginSessions,
  upsertDiscordLoginSession,
} from '../services/discord-support/discordLoginSessionStore';
import { AUTH_MAX_GUILDS_IN_CACHE, AUTH_MAX_USERS_PER_GUILD } from './runtimePolicy';
import {
  DISCORD_LOGIN_SESSION_TTL_MS,
  DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS,
  DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS,
  DISCORD_LOGIN_SESSION_CLEANUP_OWNER,
  DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND,
} from '../config';
import { getErrorMessage } from './ui';
import logger from '../logger';

// ─── Config (sourced from ../config) ──────────────────────────────────────────
export const LOGIN_SESSION_TTL_MS = DISCORD_LOGIN_SESSION_TTL_MS;
export const LOGIN_SESSION_REFRESH_WINDOW_MS = DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS;
export const LOGIN_SESSION_CLEANUP_INTERVAL_MS = DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS;
export type LoginSessionCleanupOwner = 'app' | 'db';
export const LOGIN_SESSION_CLEANUP_OWNER: LoginSessionCleanupOwner = DISCORD_LOGIN_SESSION_CLEANUP_OWNER;
export const AUTO_LOGIN_ON_FIRST_COMMAND = DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND;
export const PERSISTED_SESSION_REVALIDATE_MS = Math.max(
  60_000,
  Math.min(LOGIN_SESSION_REFRESH_WINDOW_MS, 10 * 60_000),
);

// ─── In-process cache ────────────────────────────────────────────────────────
export type LoginSessionMode = 'persisted' | 'memory-only';

export type LoginSessionCacheEntry = {
  expiresAt: number;
  mode: LoginSessionMode;
  lastValidatedAt: number;
};

export const loggedInUsersByGuild = new Map<string, Map<string, LoginSessionCacheEntry>>();

const buildLoginSessionCacheEntry = (
  expiresAt: number,
  mode: LoginSessionMode,
  lastValidatedAt = Date.now(),
): LoginSessionCacheEntry => ({
  expiresAt,
  mode,
  lastValidatedAt,
});

export const cacheLoginSession = (guildId: string, userId: string, entry: LoginSessionCacheEntry): void => {
  let guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) {
    if (loggedInUsersByGuild.size >= AUTH_MAX_GUILDS_IN_CACHE) return;
    guildUsers = new Map<string, LoginSessionCacheEntry>();
    loggedInUsersByGuild.set(guildId, guildUsers);
  }
  if (!guildUsers.has(userId) && guildUsers.size >= AUTH_MAX_USERS_PER_GUILD) return;
  guildUsers.set(userId, entry);
};

export const uncacheLoginSession = (guildId: string, userId: string): void => {
  const guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) return;
  guildUsers.delete(userId);
  if (guildUsers.size === 0) loggedInUsersByGuild.delete(guildId);
};

export const purgeExpiredCachedLoginSessions = (nowMs = Date.now()): number => {
  let removed = 0;

  for (const [guildId, guildUsers] of loggedInUsersByGuild.entries()) {
    for (const [userId, entry] of guildUsers.entries()) {
      if (nowMs <= entry.expiresAt) {
        continue;
      }
      guildUsers.delete(userId);
      removed += 1;
    }
    if (guildUsers.size === 0) {
      loggedInUsersByGuild.delete(guildId);
    }
  }

  return removed;
};

const shouldRevalidatePersistedSession = (entry: LoginSessionCacheEntry): boolean => {
  if (entry.mode !== 'persisted') {
    return false;
  }
  if (LOGIN_SESSION_CLEANUP_OWNER !== 'db') {
    return false;
  }
  return (Date.now() - entry.lastValidatedAt) >= PERSISTED_SESSION_REVALIDATE_MS;
};

const loadPersistedLoginSession = async (
  guildId: string,
  userId: string,
): Promise<
  | { status: 'valid'; expiresAt: number }
  | { status: 'missing' }
  | { status: 'error' }
> => {
  try {
    const persistedExpiry = await getDiscordLoginSessionExpiryMs({ guildId, userId });
    if (!persistedExpiry) {
      return { status: 'missing' };
    }
    return { status: 'valid', expiresAt: persistedExpiry };
  } catch (error) {
    logger.warn(
      '[AUTH] Failed to load login session guild=%s user=%s: %s',
      guildId,
      userId,
      getErrorMessage(error),
    );
    return { status: 'error' };
  }
};

export const markUserLoggedIn = async (
  guildId: string,
  userId: string,
): Promise<'persisted' | 'memory-only'> => {
  if (!guildId || !userId) return 'memory-only';
  const expiresAt = Date.now() + LOGIN_SESSION_TTL_MS;
  try {
    const persisted = await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    const mode: LoginSessionMode = persisted ? 'persisted' : 'memory-only';
    cacheLoginSession(guildId, userId, buildLoginSessionCacheEntry(expiresAt, mode));
    return mode;
  } catch (error) {
    logger.warn(
      '[AUTH] Failed to persist login session guild=%s user=%s: %s',
      guildId,
      userId,
      getErrorMessage(error),
    );
    cacheLoginSession(guildId, userId, buildLoginSessionCacheEntry(expiresAt, 'memory-only'));
    return 'memory-only';
  }
};

const maybeRefreshLoginSession = async (
  guildId: string,
  userId: string,
  entry: LoginSessionCacheEntry,
): Promise<void> => {
  const remainingMs = entry.expiresAt - Date.now();
  if (remainingMs > LOGIN_SESSION_REFRESH_WINDOW_MS) return;
  const newExpiry = Date.now() + LOGIN_SESSION_TTL_MS;
  cacheLoginSession(guildId, userId, buildLoginSessionCacheEntry(newExpiry, entry.mode, entry.lastValidatedAt));
  try {
    const persisted = await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(newExpiry).toISOString(),
    });
    const nextMode: LoginSessionMode = persisted ? 'persisted' : entry.mode;
    const nextValidatedAt = persisted ? Date.now() : entry.lastValidatedAt;
    cacheLoginSession(guildId, userId, buildLoginSessionCacheEntry(newExpiry, nextMode, nextValidatedAt));
  } catch (error) {
    logger.warn(
      '[AUTH] Failed to refresh login session guild=%s user=%s: %s',
      guildId,
      userId,
      getErrorMessage(error),
    );
  }
};

export const hasValidLoginSession = async (
  guildId: string,
  userId: string,
): Promise<boolean> => {
  const guildUsers = loggedInUsersByGuild.get(guildId);
  const hydrateFromDb = async (): Promise<boolean> => {
    const persisted = await loadPersistedLoginSession(guildId, userId);
    if (persisted.status !== 'valid') {
      return false;
    }

    const entry = buildLoginSessionCacheEntry(persisted.expiresAt, 'persisted');
    cacheLoginSession(guildId, userId, entry);
    await maybeRefreshLoginSession(guildId, userId, entry);
    return true;
  };

  if (!guildUsers) return hydrateFromDb();

  const entry = guildUsers.get(userId);
  if (!entry) return hydrateFromDb();
  if (Date.now() > entry.expiresAt) {
    uncacheLoginSession(guildId, userId);
    return false;
  }

  if (shouldRevalidatePersistedSession(entry)) {
    const persisted = await loadPersistedLoginSession(guildId, userId);
    if (persisted.status === 'missing') {
      uncacheLoginSession(guildId, userId);
      return false;
    }
    if (persisted.status === 'valid') {
      const refreshedEntry = buildLoginSessionCacheEntry(persisted.expiresAt, 'persisted');
      cacheLoginSession(guildId, userId, refreshedEntry);
      await maybeRefreshLoginSession(guildId, userId, refreshedEntry);
      return true;
    }
  }

  await maybeRefreshLoginSession(guildId, userId, entry);
  return true;
};

// ─── Interaction-level permission gates ──────────────────────────────────────
export const hasAdminPermission = async (
  interaction: ChatInputCommandInteraction,
): Promise<boolean> => {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  try {
    return await isUserAdmin(interaction.user.id);
  } catch (err) {
    logger.warn('[AUTH] admin check failed userId=%s error=%s', interaction.user.id, getErrorMessage(err));
    return false;
  }
};

export const hasFeatureAccess = async (
  interaction: ChatInputCommandInteraction,
): Promise<boolean> => {
  if (await hasAdminPermission(interaction)) return true;
  if (!interaction.guildId) return false;
  return hasValidLoginSession(interaction.guildId, interaction.user.id);
};

export type FeatureAccessResult =
  | {
      ok: true;
      autoLoggedIn: boolean;
      mode?: 'persisted' | 'memory-only';
    }
  | {
      ok: false;
      reason: 'guild_only' | 'login_required';
    };

export const ensureFeatureAccess = async (
  interaction: ChatInputCommandInteraction,
): Promise<FeatureAccessResult> => {
  if (await hasAdminPermission(interaction)) {
    return { ok: true, autoLoggedIn: false };
  }

  if (!interaction.guildId) {
    return { ok: false, reason: 'guild_only' };
  }

  if (await hasValidLoginSession(interaction.guildId, interaction.user.id)) {
    return { ok: true, autoLoggedIn: false };
  }

  if (!AUTO_LOGIN_ON_FIRST_COMMAND) {
    return { ok: false, reason: 'login_required' };
  }

  try {
    const mode = await markUserLoggedIn(interaction.guildId, interaction.user.id);
    logger.info('[AUTH] Auto-bootstrapped login session guild=%s user=%s mode=%s', interaction.guildId, interaction.user.id, mode);
    return { ok: true, autoLoggedIn: true, mode };
  } catch (error) {
    logger.warn(
      '[AUTH] Failed to auto-bootstrap login session guild=%s user=%s: %s',
      interaction.guildId,
      interaction.user.id,
      getErrorMessage(error),
    );
    return { ok: false, reason: 'login_required' };
  }
};

// ─── Cleanup loop ─────────────────────────────────────────────────────────────
import { BackgroundLoop } from '../utils/backgroundLoop';

const cleanupLoop = new BackgroundLoop(
  async () => {
    const expiredCacheEntries = purgeExpiredCachedLoginSessions();
    const deleted = await purgeExpiredDiscordLoginSessions();
    if (deleted > 0 || expiredCacheEntries > 0) {
      logger.info(
        '[AUTH] Login session cleanup removed %d expired row(s), %d cached session(s)',
        deleted,
        expiredCacheEntries,
      );
    }
  },
  { name: '[AUTH]', intervalMs: LOGIN_SESSION_CLEANUP_INTERVAL_MS, runOnStart: true },
);

export const startLoginSessionCleanupLoop = (): void => {
  if (LOGIN_SESSION_CLEANUP_OWNER !== 'app') {
    logger.info('[AUTH] Login session cleanup app loop skipped (owner=%s)', LOGIN_SESSION_CLEANUP_OWNER);
    return;
  }
  cleanupLoop.start();
};

export const stopLoginSessionCleanupLoop = (): void => {
  cleanupLoop.stop();
};

export const getLoginSessionCleanupLoopStats = (): {
  owner: LoginSessionCleanupOwner;
  running: boolean;
  intervalMs: number;
} => ({
  owner: LOGIN_SESSION_CLEANUP_OWNER,
  ...cleanupLoop.getStats(),
});

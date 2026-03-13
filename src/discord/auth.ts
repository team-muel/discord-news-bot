/**
 * Login-session cache + feature-access gate.
 * Wraps Supabase-backed session persistence with an in-process TTL map.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { isUserAdmin } from '../services/adminAllowlistService';
import {
  getDiscordLoginSessionExpiryMs,
  purgeExpiredDiscordLoginSessions,
  upsertDiscordLoginSession,
} from '../services/discordLoginSessionStore';
import { getErrorMessage } from './ui';
import logger from '../logger';

// ─── Config (read once at startup) ──────────────────────────────────────────
export const LOGIN_SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_TTL_MS || 24 * 60 * 60 * 1000),
);
export const LOGIN_SESSION_REFRESH_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS || 2 * 60 * 60 * 1000),
);
export const LOGIN_SESSION_CLEANUP_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS || 30 * 60 * 1000),
);

// ─── In-process cache ────────────────────────────────────────────────────────
export const loggedInUsersByGuild = new Map<string, Map<string, number>>();
let loginSessionCleanupTimer: NodeJS.Timeout | null = null;

export const cacheLoginSession = (guildId: string, userId: string, expiresAt: number): void => {
  const guildUsers = loggedInUsersByGuild.get(guildId) || new Map<string, number>();
  guildUsers.set(userId, expiresAt);
  loggedInUsersByGuild.set(guildId, guildUsers);
};

export const uncacheLoginSession = (guildId: string, userId: string): void => {
  const guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) return;
  guildUsers.delete(userId);
  if (guildUsers.size === 0) loggedInUsersByGuild.delete(guildId);
};

export const markUserLoggedIn = async (
  guildId: string,
  userId: string,
): Promise<'persisted' | 'memory-only'> => {
  const expiresAt = Date.now() + LOGIN_SESSION_TTL_MS;
  cacheLoginSession(guildId, userId, expiresAt);
  try {
    const persisted = await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return persisted ? 'persisted' : 'memory-only';
  } catch (error) {
    logger.warn(
      '[AUTH] Failed to persist login session guild=%s user=%s: %s',
      guildId,
      userId,
      getErrorMessage(error),
    );
    return 'memory-only';
  }
};

const maybeRefreshLoginSession = async (
  guildId: string,
  userId: string,
  expiresAt: number,
): Promise<void> => {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs > LOGIN_SESSION_REFRESH_WINDOW_MS) return;
  const newExpiry = Date.now() + LOGIN_SESSION_TTL_MS;
  cacheLoginSession(guildId, userId, newExpiry);
  try {
    await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(newExpiry).toISOString(),
    });
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
  const loadFromDb = async (): Promise<boolean> => {
    try {
      const persistedExpiry = await getDiscordLoginSessionExpiryMs({ guildId, userId });
      if (!persistedExpiry) return false;
      cacheLoginSession(guildId, userId, persistedExpiry);
      await maybeRefreshLoginSession(guildId, userId, persistedExpiry);
      return true;
    } catch (error) {
      logger.warn(
        '[AUTH] Failed to load login session guild=%s user=%s: %s',
        guildId,
        userId,
        getErrorMessage(error),
      );
      return false;
    }
  };

  if (!guildUsers) return loadFromDb();

  const expiresAt = guildUsers.get(userId);
  if (!expiresAt) return loadFromDb();
  if (Date.now() > expiresAt) {
    uncacheLoginSession(guildId, userId);
    return false;
  }
  await maybeRefreshLoginSession(guildId, userId, expiresAt);
  return true;
};

// ─── Interaction-level permission gates ──────────────────────────────────────
export const hasAdminPermission = async (
  interaction: ChatInputCommandInteraction,
): Promise<boolean> => {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  try {
    return await isUserAdmin(interaction.user.id);
  } catch {
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

// ─── Cleanup loop ─────────────────────────────────────────────────────────────
export const startLoginSessionCleanupLoop = (): void => {
  if (loginSessionCleanupTimer) return;
  const runCleanup = async () => {
    try {
      const deleted = await purgeExpiredDiscordLoginSessions();
      if (deleted > 0) {
        logger.info('[AUTH] Login session cleanup removed %d expired row(s)', deleted);
      }
    } catch (error) {
      logger.warn('[AUTH] Login session cleanup failed: %s', getErrorMessage(error));
    }
  };
  void runCleanup();
  loginSessionCleanupTimer = setInterval(() => {
    void runCleanup();
  }, LOGIN_SESSION_CLEANUP_INTERVAL_MS);
  if (typeof loginSessionCleanupTimer.unref === 'function') {
    loginSessionCleanupTimer.unref();
  }
};

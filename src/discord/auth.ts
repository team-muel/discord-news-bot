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
export type LoginSessionCleanupOwner = 'app' | 'db';
export const LOGIN_SESSION_CLEANUP_OWNER: LoginSessionCleanupOwner =
  String(process.env.DISCORD_LOGIN_SESSION_CLEANUP_OWNER || 'db').trim().toLowerCase() === 'app'
    ? 'app'
    : 'db';
export const AUTO_LOGIN_ON_FIRST_COMMAND = !['0', 'false', 'no', 'off']
  .includes(String(process.env.DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND || 'true').toLowerCase());

// ─── In-process cache ────────────────────────────────────────────────────────
export const loggedInUsersByGuild = new Map<string, Map<string, number>>();
const MAX_GUILDS_IN_CACHE = 500;
const MAX_USERS_PER_GUILD = 5000;
let loginSessionCleanupTimer: NodeJS.Timeout | null = null;

export const cacheLoginSession = (guildId: string, userId: string, expiresAt: number): void => {
  let guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) {
    if (loggedInUsersByGuild.size >= MAX_GUILDS_IN_CACHE) return;
    guildUsers = new Map<string, number>();
    loggedInUsersByGuild.set(guildId, guildUsers);
  }
  if (!guildUsers.has(userId) && guildUsers.size >= MAX_USERS_PER_GUILD) return;
  guildUsers.set(userId, expiresAt);
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
  if (!guildId || !userId) return 'memory-only';
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
  } catch (err) {
    logger.warn('[AUTH] admin check failed userId=%s error=%s', interaction.user.id, err instanceof Error ? err.message : String(err));
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
export const startLoginSessionCleanupLoop = (): void => {
  if (LOGIN_SESSION_CLEANUP_OWNER !== 'app') {
    logger.info('[AUTH] Login session cleanup app loop skipped (owner=%s)', LOGIN_SESSION_CLEANUP_OWNER);
    return;
  }
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

export const getLoginSessionCleanupLoopStats = (): {
  owner: LoginSessionCleanupOwner;
  running: boolean;
  intervalMs: number;
} => ({
  owner: LOGIN_SESSION_CLEANUP_OWNER,
  running: Boolean(loginSessionCleanupTimer),
  intervalMs: LOGIN_SESSION_CLEANUP_INTERVAL_MS,
});

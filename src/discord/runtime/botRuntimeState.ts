import type { Client } from 'discord.js';
import logger from '../../logger';
import {
  BOT_MANUAL_RECONNECT_COOLDOWN_MS,
  DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS,
  DYNAMIC_WORKER_RESTORE_ON_BOOT,
} from '../../config';
import { getErrorMessage } from '../ui';
import { isSupabaseConfigured, getSupabaseClient } from '../../services/supabaseClient';
import { getAutomationRuntimeSnapshot } from '../../services/automationBot';
import { listApprovals } from '../../services/workerGeneration/workerApprovalStore';
import {
  loadDynamicWorkerFromCode,
  loadDynamicWorkerFromFile,
} from '../../services/workerGeneration/dynamicWorkerRegistry';
import {
  commandDefinitions,
  CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC,
} from '../commandDefinitions';
import {
  DISCORD_COMMAND_GUILD_ID,
} from '../../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BotRuntimeSnapshot = {
  started: boolean;
  ready: boolean;
  wsStatus: number;
  tokenPresent: boolean;
  reconnectQueued: boolean;
  reconnectAttempts: number;
  lastReadyAt: string | null;
  lastLoginAttemptAt: string | null;
  lastLoginErrorAt: string | null;
  lastLoginError: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectReason: string | null;
  lastInvalidatedAt: string | null;
  lastAlertAt: string | null;
  lastAlertReason: string | null;
  lastRecoveryAt: string | null;
  lastManualReconnectAt: string | null;
  manualReconnectCooldownRemainingSec: number;
  loginRateLimitUntil: string | null;
  loginRateLimitRemainingSec: number;
  loginRateLimitReason: string | null;
  dynamicWorkerRestoreEnabled: boolean;
  dynamicWorkerRestoreAttemptedAt: string | null;
  dynamicWorkerRestoreApprovedCount: number;
  dynamicWorkerRestoreSuccessCount: number;
  dynamicWorkerRestoreFailedCount: number;
  dynamicWorkerRestoreLastError: string | null;
};

export type ManualReconnectRequestResult = {
  ok: boolean;
  status: 'accepted' | 'rejected';
  reason: 'OK' | 'COOLDOWN' | 'RATE_LIMIT' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
};

// ─── Mutable State ────────────────────────────────────────────────────────────

export const botRuntimeState: BotRuntimeSnapshot = {
  started: false,
  ready: false,
  wsStatus: -1,
  tokenPresent: false,
  reconnectQueued: false,
  reconnectAttempts: 0,
  lastReadyAt: null,
  lastLoginAttemptAt: null,
  lastLoginErrorAt: null,
  lastLoginError: null,
  lastDisconnectAt: null,
  lastDisconnectCode: null,
  lastDisconnectReason: null,
  lastInvalidatedAt: null,
  lastAlertAt: null,
  lastAlertReason: null,
  lastRecoveryAt: null,
  lastManualReconnectAt: null,
  manualReconnectCooldownRemainingSec: 0,
  loginRateLimitUntil: null,
  loginRateLimitRemainingSec: 0,
  loginRateLimitReason: null,
  dynamicWorkerRestoreEnabled: DYNAMIC_WORKER_RESTORE_ON_BOOT,
  dynamicWorkerRestoreAttemptedAt: null,
  dynamicWorkerRestoreApprovedCount: 0,
  dynamicWorkerRestoreSuccessCount: 0,
  dynamicWorkerRestoreFailedCount: 0,
  dynamicWorkerRestoreLastError: null,
};

// ─── Connection State ─────────────────────────────────────────────────────────
// Moved from bot.ts to centralize all mutable bot state for testability.

let activeToken: string | null = null;
let reconnectInProgress = false;

export const getActiveToken = (): string | null => activeToken;
export const setActiveToken = (token: string | null): void => { activeToken = token; };
export const isReconnectInProgress = (): boolean => reconnectInProgress;
export const setReconnectInProgress = (value: boolean): void => { reconnectInProgress = value; };

// ─── Reset (for tests) ───────────────────────────────────────────────────────

const INITIAL_SNAPSHOT: BotRuntimeSnapshot = { ...botRuntimeState };

/** Reset all mutable state to initial values. Test-only. */
export const resetBotRuntimeState = (): void => {
  Object.assign(botRuntimeState, INITIAL_SNAPSHOT);
  activeToken = null;
  reconnectInProgress = false;
};

const MANUAL_RECONNECT_COOLDOWN_MS = BOT_MANUAL_RECONNECT_COOLDOWN_MS;

// ─── Cooldown & Rate-Limit Helpers ────────────────────────────────────────────

export const getManualReconnectCooldownRemainingSec = (): number => {
  if (!botRuntimeState.lastManualReconnectAt) {
    return 0;
  }

  const lastReconnectAtMs = Date.parse(botRuntimeState.lastManualReconnectAt);
  if (!Number.isFinite(lastReconnectAtMs)) {
    return 0;
  }

  const remainingMs = Math.max(0, MANUAL_RECONNECT_COOLDOWN_MS - (Date.now() - lastReconnectAtMs));
  return Math.ceil(remainingMs / 1000);
};

export const getLoginRateLimitRemainingSec = (): number => {
  if (!botRuntimeState.loginRateLimitUntil) {
    return 0;
  }

  const untilMs = Date.parse(botRuntimeState.loginRateLimitUntil);
  if (!Number.isFinite(untilMs)) {
    return 0;
  }

  return Math.ceil(Math.max(0, untilMs - Date.now()) / 1000);
};

export const clearLoginRateLimit = (): void => {
  botRuntimeState.loginRateLimitUntil = null;
  botRuntimeState.loginRateLimitRemainingSec = 0;
  botRuntimeState.loginRateLimitReason = null;
};

export const isDiscordLoginRateLimitedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Discord login rate-limited; retry after/i.test(message);
};

export const setLoginRateLimit = (cooldownMs: number, reason: string): void => {
  const safeCooldownMs = Math.max(1_000, Number(cooldownMs) || 0) + DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS;
  botRuntimeState.loginRateLimitUntil = new Date(Date.now() + safeCooldownMs).toISOString();
  botRuntimeState.loginRateLimitRemainingSec = Math.ceil(safeCooldownMs / 1000);
  botRuntimeState.loginRateLimitReason = reason;
};

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function getBotRuntimeSnapshot(client: Client): BotRuntimeSnapshot {
  const started = botRuntimeState.started;
  const liveWsStatus = Number(client.ws?.status ?? botRuntimeState.wsStatus ?? -1);
  const manualCooldown = getManualReconnectCooldownRemainingSec();
  const loginRateLimitRemainingSec = getLoginRateLimitRemainingSec();
  botRuntimeState.manualReconnectCooldownRemainingSec = manualCooldown;
  botRuntimeState.loginRateLimitRemainingSec = loginRateLimitRemainingSec;
  return {
    ...botRuntimeState,
    started,
    ready: client.isReady(),
    wsStatus: started ? liveWsStatus : -1,
    manualReconnectCooldownRemainingSec: manualCooldown,
    loginRateLimitRemainingSec,
  };
}

// ─── Usage Summary ────────────────────────────────────────────────────────────

export const getUsageSummaryLine = async (client: Client): Promise<string> => {
  const guildCount = client.guilds.cache.size;

  if (!isSupabaseConfigured()) {
    return `Usage: guilds=${guildCount} | sources=0 (supabase not configured)`;
  }

  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('sources').select('guild_id,is_active,name');
    if (error) {
      return `Usage: guilds=${guildCount} | source-stats unavailable (${error.message})`;
    }

    const rows = data || [];
    const active = rows.filter((row: any) => Boolean(row.is_active)).length;
    const youtube = rows.filter((row: any) => String(row.name || '').startsWith('youtube-')).length;
    const news = rows.filter((row: any) => String(row.name || '') === 'google-finance-news').length;
    const activeGuilds = new Set(rows.map((row: any) => String(row.guild_id || 'unknown'))).size;
    return `Usage: guilds=${guildCount} | activeGuilds=${activeGuilds} | sources=${rows.length} (active=${active}, yt=${youtube}, news=${news})`;
  } catch (error) {
    const message = getErrorMessage(error);
    return `Usage: guilds=${guildCount} | source-stats unavailable (${message})`;
  }
};

export const getGuildUsageSummaryLine = async (guildId: string | null): Promise<string | null> => {
  if (!guildId || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('sources')
      .select('is_active,name')
      .eq('guild_id', guildId);

    if (error) {
      return `Current guild: usage unavailable (${error.message})`;
    }

    const rows = data || [];
    const active = rows.filter((row: any) => Boolean(row.is_active)).length;
    const youtube = rows.filter((row: any) => String(row.name || '').startsWith('youtube-')).length;
    const news = rows.filter((row: any) => String(row.name || '') === 'google-finance-news').length;

    return `Current guild: sources=${rows.length} (active=${active}, yt=${youtube}, news=${news})`;
  } catch (error) {
    const message = getErrorMessage(error);
    return `Current guild: usage unavailable (${message})`;
  }
};

// ─── Status Lines ─────────────────────────────────────────────────────────────

export const getRuntimeStatusLines = async (guildId: string | null, client: Client): Promise<string[]> => {
  const bot = getBotRuntimeSnapshot(client);
  const automation = getAutomationRuntimeSnapshot();
  const usage = await getUsageSummaryLine(client);
  const guildUsage = await getGuildUsageSummaryLine(guildId);
  const jobStates = Object.values(automation.jobs)
    .map((job) => {
      const lastState = job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt))
        ? `error(${job.lastError || 'unknown'})`
        : job.running
          ? 'running'
          : 'idle';
      return `${job.name}: ${lastState}`;
    })
    .join(' | ');

  return [
    '[런타임 상태]',
    `Bot ready: ${String(bot.ready)} | wsStatus: ${bot.wsStatus}`,
    `Reconnect queued: ${String(bot.reconnectQueued)} | attempts: ${bot.reconnectAttempts}`,
    `Dynamic worker restore: enabled=${String(bot.dynamicWorkerRestoreEnabled)} approved=${bot.dynamicWorkerRestoreApprovedCount} restored=${bot.dynamicWorkerRestoreSuccessCount} failed=${bot.dynamicWorkerRestoreFailedCount}`,
    bot.dynamicWorkerRestoreLastError
      ? `Dynamic restore error: ${bot.dynamicWorkerRestoreLastError}`
      : null,
    '',
    '[자동화 상태]',
    `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
    '',
    '[사용량]',
    usage,
    guildUsage,
  ].filter(Boolean) as string[];
};

// ─── Slash Command Sync ───────────────────────────────────────────────────────

export const registerSlashCommands = async (client: Client): Promise<void> => {
  if (!client.application) {
    logger.warn('[BOT] Discord application context unavailable, skipping slash command sync');
    return;
  }

  try {
    let targetGuildIdForFastSync: string | null = null;
    if (DISCORD_COMMAND_GUILD_ID) {
      let guild: import('discord.js').Guild | undefined;
      try {
        guild = await client.guilds.fetch(DISCORD_COMMAND_GUILD_ID);
      } catch (fetchError) {
        logger.error('[BOT] Failed to fetch target guild %s for slash sync: %o', DISCORD_COMMAND_GUILD_ID, fetchError);
      }

      if (guild) {
        await guild.commands.set(commandDefinitions);
        logger.info('[BOT] Slash commands synced to guild=%s (%d commands)', DISCORD_COMMAND_GUILD_ID, commandDefinitions.length);
        targetGuildIdForFastSync = DISCORD_COMMAND_GUILD_ID;
      }

      if (!guild) {
        logger.warn('[BOT] Falling back to global slash command sync because target guild is unavailable');
      }
    }

    await client.application.commands.set(commandDefinitions);
    logger.info('[BOT] Slash commands synced globally (%d commands)', commandDefinitions.length);

    if (CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC) {
      let cleared = 0;
      for (const guild of client.guilds.cache.values()) {
        if (targetGuildIdForFastSync && guild.id === targetGuildIdForFastSync) continue;
        try {
          await guild.commands.set([]);
          cleared += 1;
        } catch (clearError) {
          logger.warn('[BOT] Failed to clear guild-scoped commands for guild=%s: %o', guild.id, clearError);
        }
      }
      logger.info('[BOT] Cleared stale guild-scoped commands for %d guild(s)', cleared);
    }
  } catch (error) {
    logger.error('[BOT] Failed to sync slash commands: %o', error);
  }
};

// ─── Dynamic Worker Restore ───────────────────────────────────────────────────

export const restoreApprovedDynamicWorkers = async (): Promise<void> => {
  if (!DYNAMIC_WORKER_RESTORE_ON_BOOT) {
    return;
  }

  botRuntimeState.dynamicWorkerRestoreEnabled = true;
  botRuntimeState.dynamicWorkerRestoreAttemptedAt = new Date().toISOString();
  botRuntimeState.dynamicWorkerRestoreApprovedCount = 0;
  botRuntimeState.dynamicWorkerRestoreSuccessCount = 0;
  botRuntimeState.dynamicWorkerRestoreFailedCount = 0;
  botRuntimeState.dynamicWorkerRestoreLastError = null;

  try {
    const approved = await listApprovals({ status: 'approved' });
    botRuntimeState.dynamicWorkerRestoreApprovedCount = approved.length;
    if (approved.length === 0) {
      logger.info('[DYNAMIC-WORKER] restore skipped: no approved entries');
      return;
    }

    let restored = 0;
    let failed = 0;

    for (const entry of approved) {
      if (!entry.validationPassed) {
        failed += 1;
        continue;
      }

      let loaded = entry.sandboxFilePath
        ? await loadDynamicWorkerFromFile(entry.sandboxFilePath, entry.id)
        : { ok: false, error: 'missing sandbox file path' };

      if (!loaded.ok && entry.generatedCode) {
        loaded = await loadDynamicWorkerFromCode({
          approvalId: entry.id,
          generatedCode: entry.generatedCode,
          actionNameHint: entry.actionName,
        });
      }

      if (loaded.ok) {
        restored += 1;
      } else {
        failed += 1;
        logger.warn(
          '[DYNAMIC-WORKER] restore failed approval=%s action=%s error=%s',
          entry.id,
          entry.actionName,
          loaded.error || 'unknown',
        );
      }
    }

    botRuntimeState.dynamicWorkerRestoreSuccessCount = restored;
    botRuntimeState.dynamicWorkerRestoreFailedCount = failed;

    logger.info('[DYNAMIC-WORKER] restore completed approved=%d restored=%d failed=%d', approved.length, restored, failed);
  } catch (error) {
    const message = getErrorMessage(error);
    botRuntimeState.dynamicWorkerRestoreLastError = message;
    logger.error('[DYNAMIC-WORKER] restore process failed: %s', message);
  }
};

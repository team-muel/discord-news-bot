import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import logger from './logger';
import {
  DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  DISCORD_BOT_TOKEN,
} from './config';
import { getErrorMessage } from './discord/ui';
import {
  botRuntimeState,
  getBotRuntimeSnapshot as getBotRuntimeSnapshotFromState,
  getManualReconnectCooldownRemainingSec,
  getLoginRateLimitRemainingSec,
  clearLoginRateLimit,
  isDiscordLoginRateLimitedError,
  setLoginRateLimit,
  registerSlashCommands,
  getActiveToken,
  setActiveToken,
  isReconnectInProgress,
  setReconnectInProgress,
  type BotRuntimeSnapshot,
  type ManualReconnectRequestResult,
} from './discord/runtime/botRuntimeState';
import { attachAllHandlers } from './discord/runtime/commandRouter';
import { loginDiscordClientWithTimeout } from './discord/runtime/loginAttempt';
import { probeDiscordGatewayConnectivity } from './discord/runtime/gatewayPreflight';
// --- Discord Client ---

const discordIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMembers,
  ...(DISCORD_MESSAGE_CONTENT_INTENT_ENABLED ? [GatewayIntentBits.MessageContent] : []),
];

export const client = new Client({
  intents: discordIntents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

// --- Re-exports ---

export type { BotRuntimeSnapshot, ManualReconnectRequestResult };

export function getBotRuntimeSnapshot(): BotRuntimeSnapshot {
  return getBotRuntimeSnapshotFromState(client);
}

export const forceRegisterSlashCommands = async (): Promise<void> => {
  await registerSlashCommands(client);
};

// --- Manual Reconnect ---

const runManualReconnect = async (reason: string): Promise<ManualReconnectRequestResult> => {
  if (!getActiveToken()) {
    logger.warn('[BOT] Manual reconnect skipped: token unavailable');
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  if (isReconnectInProgress()) {
    logger.warn('[BOT] Manual reconnect skipped: reconnect already in progress');
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  setReconnectInProgress(true);
  botRuntimeState.reconnectQueued = true;
  botRuntimeState.lastManualReconnectAt = new Date().toISOString();
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  logger.warn('[BOT] Manual reconnect requested: %s', reason);

  try {
    await client.destroy();
  } catch (error) {
    logger.warn('[BOT] client.destroy() during manual reconnect failed: %o', error);
  }

  try {
    const token = getActiveToken() || DISCORD_BOT_TOKEN || null;
    if (!token) {
      setReconnectInProgress(false);
      botRuntimeState.reconnectQueued = false;
      return {
        ok: false,
        status: 'rejected',
        reason: 'NO_TOKEN',
        message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
      };
    }
    await startBot(token);
    botRuntimeState.lastRecoveryAt = new Date().toISOString();
    botRuntimeState.lastAlertAt = null;
    botRuntimeState.lastAlertReason = null;
    return {
      ok: true,
      status: 'accepted',
      reason: 'OK',
      message: '봇 재연결 요청이 전송되었습니다.',
    };
  } catch (error) {
    logger.error('[BOT] Manual reconnect failed: %o', error);
    botRuntimeState.lastLoginErrorAt = new Date().toISOString();
    botRuntimeState.lastLoginError = getErrorMessage(error);
    botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
    botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
    if (/Discord login rate-limited; retry after/i.test(botRuntimeState.lastLoginError || '')) {
      if (getLoginRateLimitRemainingSec() <= 0) {
        const fallbackCooldownMs = 10 * 60_000;
        setLoginRateLimit(fallbackCooldownMs, botRuntimeState.lastLoginError || 'rate-limit fallback');
        logger.warn('[BOT] Rate-limit state missing after 429 error; applied fallback cooldown %dms', fallbackCooldownMs);
      }
      return {
        ok: false,
        status: 'rejected',
        reason: 'RATE_LIMIT',
        message: `Discord 로그인 시도가 제한됩니다. ${getLoginRateLimitRemainingSec()}초 후 다시 시도하세요.`,
      };
    }
    return {
      ok: false,
      status: 'rejected',
      reason: 'RECONNECT_FAILED',
      message: '재연결에 실패했습니다. 서버 로그를 확인하세요.',
    };
  } finally {
    setReconnectInProgress(false);
    botRuntimeState.reconnectQueued = false;
  }
};

export const requestManualReconnect = async (source: string): Promise<ManualReconnectRequestResult> => {
  const remaining = getManualReconnectCooldownRemainingSec();
  if (remaining > 0) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'COOLDOWN',
      message: `재연결 쿨다운 중입니다. ${remaining}초 후 다시 시도하세요.`,
    };
  }

  const rateLimitRemainingSec = getLoginRateLimitRemainingSec();
  if (rateLimitRemainingSec > 0) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'RATE_LIMIT',
      message: `Discord 로그인 시도가 제한됩니다. ${rateLimitRemainingSec}초 후 다시 시도하세요.`,
    };
  }

  if (isReconnectInProgress()) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  if (!getActiveToken()) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  return runManualReconnect(source);
};

// --- Start Bot ---

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');

  setActiveToken(token);

  // Attach all event handlers (idempotent — only runs once)
  attachAllHandlers(client, {
    getActiveToken,
    runManualReconnect,
    forceRegisterSlashCommands,
    onSessionInvalidated: () => { setActiveToken(null); },
  });

  botRuntimeState.tokenPresent = Boolean(token);
  const maxRetries = DISCORD_START_RETRIES;
  const readyTimeout = DISCORD_READY_TIMEOUT_MS;
  const initialRateLimitRemainingSec = getLoginRateLimitRemainingSec();

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  if (initialRateLimitRemainingSec > 0) {
    botRuntimeState.loginRateLimitRemainingSec = initialRateLimitRemainingSec;
    throw new Error(`Discord login rate-limited; retry after ${initialRateLimitRemainingSec}s`);
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    botRuntimeState.lastLoginAttemptAt = new Date().toISOString();
    botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
    botRuntimeState.reconnectQueued = attempt > 1;
    try {
      const preflightTimeoutMs = Math.max(5_000, Math.min(15_000, Math.floor(readyTimeout / 8)));
      const preflight = await probeDiscordGatewayConnectivity(token, preflightTimeoutMs);
      if (!preflight.ok) {
        const preflightLog = preflight.blocking ? logger.error.bind(logger) : logger.warn.bind(logger);
        preflightLog(
          '[BOT] Discord preflight failed restOk=%s wsOk=%s status=%s cached=%s cooldownMs=%d bot=%s gateway=%s reason=%s',
          String(preflight.restOk),
          String(preflight.wsOk),
          String(preflight.statusCode),
          String(preflight.cached),
          Number(preflight.cooldownMs || 0),
          preflight.botTag || 'unknown',
          preflight.gatewayUrl || 'unknown',
          preflight.error || 'unknown',
        );
        if (preflight.statusCode === 429 && Number(preflight.cooldownMs || 0) > 0) {
          setLoginRateLimit(preflight.cooldownMs, preflight.error || 'discord gateway/bot rate limited');
          throw new Error(`Discord login rate-limited; retry after ${getLoginRateLimitRemainingSec()}s`);
        }
        if (preflight.blocking) {
          throw new Error(`Discord preflight failed: ${preflight.error || 'unknown'}`);
        }
      } else {
        logger.info(
          '[BOT] Discord preflight ok cached=%s gateway=%s',
          String(preflight.cached),
          preflight.gatewayUrl || 'unknown',
        );
      }

      logger.info(
        '[BOT] Attempting login (attempt %d/%d, timeoutMs=%d, messageContentIntent=%s)',
        attempt,
        maxRetries,
        readyTimeout,
        String(DISCORD_MESSAGE_CONTENT_INTENT_ENABLED),
      );
      await loginDiscordClientWithTimeout(client, token, readyTimeout);

      logger.info('[BOT] Discord client logged in');
      clearLoginRateLimit();
      botRuntimeState.started = true;
      botRuntimeState.reconnectQueued = false;
      botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
      return;
    } catch (err) {
      if (isDiscordLoginRateLimitedError(err)) {
        logger.warn('[BOT] Login attempt %d deferred by Discord rate limit: %s', attempt, err instanceof Error ? err.message : String(err));
      } else {
        logger.error('[BOT] Login attempt %d failed: %o', attempt, err);
      }
      botRuntimeState.lastLoginErrorAt = new Date().toISOString();
      botRuntimeState.lastLoginError = err instanceof Error ? err.message : String(err);
      botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
      botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
      try {
        await client.destroy();
      } catch (e) {
        logger.debug('[BOT] Error during client.destroy(): %o', e);
      }

      const rateLimitRemainingSec = getLoginRateLimitRemainingSec();
      if (rateLimitRemainingSec > 0) {
        botRuntimeState.reconnectQueued = false;
        throw err;
      }

      if (attempt < maxRetries) {
        const backoffMs = Math.min(30_000, 500 * Math.pow(2, attempt));
        logger.info('[BOT] Waiting %dms before retry', backoffMs);
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        botRuntimeState.reconnectQueued = false;
        throw err;
      }
    }
  }
}

export default { client, startBot };

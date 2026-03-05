import { Client, GatewayIntentBits } from 'discord.js';
import logger from './logger';
import { DISCORD_READY_TIMEOUT_MS, DISCORD_START_RETRIES } from './config';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
};

const botRuntimeState: BotRuntimeSnapshot = {
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
};

client.on('ready', () => {
  botRuntimeState.ready = true;
  botRuntimeState.started = true;
  botRuntimeState.lastReadyAt = new Date().toISOString();
  botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
  botRuntimeState.lastAlertAt = null;
  botRuntimeState.lastAlertReason = null;
});

client.on('shardDisconnect', (event) => {
  botRuntimeState.ready = false;
  botRuntimeState.lastDisconnectAt = new Date().toISOString();
  botRuntimeState.lastDisconnectCode = Number(event.code);
  botRuntimeState.lastDisconnectReason = event.reason || null;
  botRuntimeState.lastInvalidatedAt = event.code === 4014 ? botRuntimeState.lastDisconnectAt : botRuntimeState.lastInvalidatedAt;
  botRuntimeState.lastAlertAt = botRuntimeState.lastDisconnectAt;
  botRuntimeState.lastAlertReason = event.reason || `Gateway disconnect code ${event.code}`;
});

export function getBotRuntimeSnapshot(): BotRuntimeSnapshot {
  const started = botRuntimeState.started;
  const liveWsStatus = Number(client.ws?.status ?? botRuntimeState.wsStatus ?? -1);
  return {
    ...botRuntimeState,
    started,
    ready: client.isReady(),
    wsStatus: started ? liveWsStatus : -1,
  };
}

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');
  botRuntimeState.tokenPresent = Boolean(token);
  const maxRetries = DISCORD_START_RETRIES;
  const readyTimeout = DISCORD_READY_TIMEOUT_MS;

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    botRuntimeState.lastLoginAttemptAt = new Date().toISOString();
    botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
    botRuntimeState.reconnectQueued = attempt > 1;
    try {
      logger.info('[BOT] Attempting login (attempt %d/%d)', attempt, maxRetries);
      await client.login(token);

      // Wait for ready event with configurable timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), readyTimeout);
        if (client.isReady()) {
          clearTimeout(timeout);
          return resolve();
        }
        client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      logger.info('[BOT] Discord client logged in');
      botRuntimeState.started = true;
      botRuntimeState.reconnectQueued = false;
      botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
      return;
    } catch (err) {
      logger.error('[BOT] Login attempt %d failed: %o', attempt, err);
      botRuntimeState.lastLoginErrorAt = new Date().toISOString();
      botRuntimeState.lastLoginError = err instanceof Error ? err.message : String(err);
      botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
      botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
      try {
        await Promise.resolve((client as any).destroy());
      } catch (e) {
        logger.debug('[BOT] Error during client.destroy(): %o', e);
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

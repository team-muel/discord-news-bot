import { Client, GatewayIntentBits } from 'discord.js';
import logger from './logger';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');
  const maxRetries = parseInt(process.env.DISCORD_START_RETRIES || '3', 10);
  const readyTimeout = parseInt(process.env.DISCORD_READY_TIMEOUT_MS || '15000', 10);

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
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
      return;
    } catch (err) {
      logger.error('[BOT] Login attempt %d failed: %o', attempt, err);
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
        throw err;
      }
    }
  }
}

export default { client, startBot };

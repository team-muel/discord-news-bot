import { Client, GatewayIntentBits } from 'discord.js';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  await client.login(token);

  // Wait for ready event (with timeout)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), 15000);
    if (client.isReady()) {
      clearTimeout(timeout);
      return resolve();
    }
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  console.log('[BOT] Discord client logged in');
}

export default { client, startBot };

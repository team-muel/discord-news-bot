import { Client, GatewayIntentBits } from 'discord.js';

const secondaryBotToken = (process.env.SECONDARY_DISCORD_TOKEN || '').trim();
const secondaryBotEnabled = String(process.env.ENABLE_SECONDARY_BOT || '').toLowerCase() === 'true';

let secondaryClient: Client | null = null;
let secondaryLoginInFlight = false;

const shouldStartSecondaryBot = () => {
  return secondaryBotEnabled && Boolean(secondaryBotToken);
};

export const startSecondaryBot = async () => {
  if (!shouldStartSecondaryBot()) {
    console.log('[RENDER_EVENT] SECONDARY_BOT_SKIPPED reason=disabled_or_missing_token');
    return;
  }

  if (secondaryClient || secondaryLoginInFlight) {
    return;
  }

  secondaryLoginInFlight = true;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildPresences,
    ],
  });

  client.once('ready', () => {
    console.log(`[RENDER_EVENT] SECONDARY_BOT_READY tag=${client.user?.tag || 'unknown'}`);
  });

  client.on('error', (error) => {
    console.error('[SECONDARY_BOT_ERROR]', error);
  });

  client.on('shardDisconnect', (event, shardId) => {
    console.log(`[RENDER_EVENT] SECONDARY_BOT_SHARD_DISCONNECT shard=${shardId} code=${event.code} reason=${event.reason || 'unknown'}`);
  });

  client.on('shardReconnecting', (shardId) => {
    console.log(`[RENDER_EVENT] SECONDARY_BOT_SHARD_RECONNECTING shard=${shardId}`);
  });

  try {
    await client.login(secondaryBotToken);
    secondaryClient = client;
  } catch (error) {
    console.error('[SECONDARY_BOT_LOGIN_FAILED]', error);
    try {
      client.destroy();
    } catch {
      // ignore
    }
  } finally {
    secondaryLoginInFlight = false;
  }
};

export const stopSecondaryBot = async () => {
  if (!secondaryClient) {
    return;
  }

  try {
    secondaryClient.destroy();
  } catch (error) {
    console.error('[SECONDARY_BOT_DESTROY_FAILED]', error);
  } finally {
    secondaryClient = null;
  }
};

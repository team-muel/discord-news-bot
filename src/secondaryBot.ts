import { Client, GatewayIntentBits } from 'discord.js';

const resolveSecondaryBotToken = () => {
  return (
    process.env.SECONDARY_DISCORD_TOKEN ||
    process.env.SECONDARY_DISCORD_BOT_TOKEN ||
    process.env.SECONDARY_BOT_TOKEN ||
    ''
  ).trim();
};

const secondaryBotToken = resolveSecondaryBotToken();
const primaryBotToken = (process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '').trim();
const secondaryBotEnabled = String(process.env.ENABLE_SECONDARY_BOT || '').toLowerCase() === 'true';

let secondaryClient: Client | null = null;
let secondaryLoginInFlight = false;

const shouldStartSecondaryBot = () => {
  return secondaryBotEnabled && Boolean(secondaryBotToken);
};

export const startSecondaryBot = async () => {
  console.log(
    `[RENDER_EVENT] SECONDARY_BOT_BOOT enabled=${secondaryBotEnabled} tokenPresent=${Boolean(secondaryBotToken)}`,
  );

  if (!shouldStartSecondaryBot()) {
    const reason = secondaryBotEnabled ? 'missing_token' : 'disabled';
    console.log(`[RENDER_EVENT] SECONDARY_BOT_SKIPPED reason=${reason}`);
    return;
  }

  if (primaryBotToken && primaryBotToken === secondaryBotToken) {
    console.log('[RENDER_EVENT] SECONDARY_BOT_SKIPPED reason=duplicate_token_with_primary');
    console.error('[SECONDARY_BOT_CONFIG_ERROR] SECONDARY_DISCORD_TOKEN must be different from DISCORD_TOKEN/DISCORD_BOT_TOKEN.');
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

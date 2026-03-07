import {
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type Guild,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import logger from './logger';
import {
  DISCORD_COMMAND_GUILD_ID,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  RESEARCH_PRESET_ADMIN_USER_IDS,
} from './config';
import { getAutomationRuntimeSnapshot, triggerAutomationJob } from './services/automationBot';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MANUAL_RECONNECT_COOLDOWN_MS = parseInt(
  process.env.BOT_MANUAL_RECONNECT_COOLDOWN_MS
  || process.env.DISCORD_MANUAL_RECONNECT_COOLDOWN_MS
  || '30000',
  10,
);

const adminAllowlist = new Set(
  RESEARCH_PRESET_ADMIN_USER_IDS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

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

let commandHandlersAttached = false;
let activeToken: string | null = null;
let reconnectInProgress = false;

export type ManualReconnectRequestResult = {
  ok: boolean;
  status: 'accepted' | 'rejected';
  reason: 'OK' | 'COOLDOWN' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
};

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is responsive'),
  new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Show Discord and automation runtime status'),
  new SlashCommandBuilder()
    .setName('automation-run')
    .setDescription('Run an automation job immediately (admin only)')
    .addStringOption((option) =>
      option
        .setName('job')
        .setDescription('Automation job name')
        .setRequired(true)
        .addChoices(
          { name: 'news-analysis', value: 'news-analysis' },
          { name: 'youtube-monitor', value: 'youtube-monitor' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('bot-reconnect')
    .setDescription('Reconnect the Discord client (admin only)'),
].map((definition) => definition.toJSON());

const getManualReconnectCooldownRemainingSec = () => {
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

const hasAdminPermission = (interaction: ChatInputCommandInteraction) => {
  if (adminAllowlist.has(interaction.user.id)) {
    return true;
  }

  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
};

const registerSlashCommands = async () => {
  if (!client.application) {
    logger.warn('[BOT] Discord application context unavailable, skipping slash command sync');
    return;
  }

  try {
    if (DISCORD_COMMAND_GUILD_ID) {
      let guild: Guild | undefined;
      try {
        guild = await client.guilds.fetch(DISCORD_COMMAND_GUILD_ID);
      } catch (fetchError) {
        logger.error('[BOT] Failed to fetch target guild %s for slash sync: %o', DISCORD_COMMAND_GUILD_ID, fetchError);
      }

      if (guild) {
        await guild.commands.set(commandDefinitions);
        logger.info('[BOT] Slash commands synced to guild=%s (%d commands)', DISCORD_COMMAND_GUILD_ID, commandDefinitions.length);
        return;
      }

      logger.warn('[BOT] Falling back to global slash command sync because target guild is unavailable');
    }

    await client.application.commands.set(commandDefinitions);
    logger.info('[BOT] Slash commands synced globally (%d commands)', commandDefinitions.length);
  } catch (error) {
    logger.error('[BOT] Failed to sync slash commands: %o', error);
  }
};

const handleStatusCommand = async (interaction: ChatInputCommandInteraction) => {
  const bot = getBotRuntimeSnapshot();
  const automation = getAutomationRuntimeSnapshot();
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

  await interaction.reply({
    content: [
      `Bot ready: ${String(bot.ready)} | wsStatus: ${bot.wsStatus}`,
      `Reconnect queued: ${String(bot.reconnectQueued)} | attempts: ${bot.reconnectAttempts}`,
      `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
    ].join('\n'),
    ephemeral: true,
  });
};

const runManualReconnect = async (reason: string): Promise<ManualReconnectRequestResult> => {
  if (!activeToken) {
    logger.warn('[BOT] Manual reconnect skipped: token unavailable');
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  if (reconnectInProgress) {
    logger.warn('[BOT] Manual reconnect skipped: reconnect already in progress');
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  reconnectInProgress = true;
  botRuntimeState.reconnectQueued = true;
  botRuntimeState.lastManualReconnectAt = new Date().toISOString();
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  logger.warn('[BOT] Manual reconnect requested: %s', reason);

  try {
    await Promise.resolve((client as any).destroy());
  } catch (error) {
    logger.warn('[BOT] client.destroy() during manual reconnect failed: %o', error);
  }

  try {
    await startBot(activeToken);
    botRuntimeState.lastRecoveryAt = new Date().toISOString();
    botRuntimeState.lastAlertAt = null;
    botRuntimeState.lastAlertReason = null;
    return {
      ok: true,
      status: 'accepted',
      reason: 'OK',
      message: '봇 재연결 요청을 전송했습니다.',
    };
  } catch (error) {
    logger.error('[BOT] Manual reconnect failed: %o', error);
    botRuntimeState.lastLoginErrorAt = new Date().toISOString();
    botRuntimeState.lastLoginError = error instanceof Error ? error.message : String(error);
    botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
    botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
    return {
      ok: false,
      status: 'rejected',
      reason: 'RECONNECT_FAILED',
      message: '재연결에 실패했습니다. 서버 로그를 확인하세요.',
    };
  } finally {
    reconnectInProgress = false;
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

  if (reconnectInProgress) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  if (!activeToken) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  return runManualReconnect(source);
};

const handleAutomationRunCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!hasAdminPermission(interaction)) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  const jobName = interaction.options.getString('job', true);
  if (jobName !== 'news-analysis' && jobName !== 'youtube-monitor') {
    await interaction.reply({ content: 'Invalid job name.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await triggerAutomationJob(jobName);
  await interaction.editReply(result.ok ? `Accepted: ${result.message}` : `Failed: ${result.message}`);
};

const handleReconnectCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!hasAdminPermission(interaction)) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  const remaining = getManualReconnectCooldownRemainingSec();
  if (remaining > 0) {
    await interaction.reply({
      content: `Reconnect is on cooldown. Try again in ${remaining}s.`,
      ephemeral: true,
    });
    return;
  }

  if (!activeToken) {
    await interaction.reply({ content: 'DISCORD token is not loaded.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Reconnect requested. Restarting Discord client...', ephemeral: true });

  setTimeout(() => {
    void runManualReconnect(`slash-command:${interaction.user.id}`);
  }, 300);
};

const attachCommandHandlers = () => {
  if (commandHandlersAttached) {
    return;
  }

  commandHandlersAttached = true;

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      switch (interaction.commandName) {
        case 'ping': {
          await interaction.reply({
            content: `Pong! ws=${client.ws.status} latency=${client.ws.ping}ms`,
            ephemeral: true,
          });
          return;
        }
        case 'bot-status': {
          await handleStatusCommand(interaction);
          return;
        }
        case 'automation-run': {
          await handleAutomationRunCommand(interaction);
          return;
        }
        case 'bot-reconnect': {
          await handleReconnectCommand(interaction);
          return;
        }
        default: {
          await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        }
      }
    } catch (error) {
      logger.error('[BOT] interaction handler failed: %o', error);
      const message = 'Command failed. Check server logs.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => undefined);
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      }
    }
  });
};

client.on('clientReady', () => {
  botRuntimeState.ready = true;
  botRuntimeState.started = true;
  botRuntimeState.lastReadyAt = new Date().toISOString();
  botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
  botRuntimeState.lastAlertAt = null;
  botRuntimeState.lastAlertReason = null;
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  void registerSlashCommands();
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

client.on('invalidated', () => {
  botRuntimeState.ready = false;
  botRuntimeState.lastInvalidatedAt = new Date().toISOString();
  botRuntimeState.lastAlertAt = botRuntimeState.lastInvalidatedAt;
  botRuntimeState.lastAlertReason = 'Gateway session invalidated';
});

export function getBotRuntimeSnapshot(): BotRuntimeSnapshot {
  const started = botRuntimeState.started;
  const liveWsStatus = Number(client.ws?.status ?? botRuntimeState.wsStatus ?? -1);
  const manualCooldown = getManualReconnectCooldownRemainingSec();
  botRuntimeState.manualReconnectCooldownRemainingSec = manualCooldown;
  return {
    ...botRuntimeState,
    started,
    ready: client.isReady(),
    wsStatus: started ? liveWsStatus : -1,
    manualReconnectCooldownRemainingSec: manualCooldown,
  };
}

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');

  activeToken = token;
  attachCommandHandlers();

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

      // Wait for clientReady event with configurable timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), readyTimeout);
        if (client.isReady()) {
          clearTimeout(timeout);
          return resolve();
        }
        client.once('clientReady', () => {
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

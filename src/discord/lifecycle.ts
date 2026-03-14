import { ChannelType, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import logger from '../logger';
import { onGuildJoined, startAgentDailyLearningLoop } from '../services/agentOpsService';
import { isAutomationEnabled, startAutomationModules } from '../services/automationBot';
import { forgetGuildRagData } from '../services/privacyForgetService';
import { DISCORD_MESSAGES } from './messages';

const resolveWelcomeChannel = (guild: Guild) => {
  const me = guild.members.me;
  const system = guild.systemChannel;
  if (system && me?.permissionsIn(system).has(PermissionFlagsBits.SendMessages)) {
    return system;
  }

  for (const channel of guild.channels.cache.values()) {
    const isTextLike = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
    if (!isTextLike) {
      continue;
    }
    if (me?.permissionsIn(channel).has(PermissionFlagsBits.SendMessages)) {
      return channel;
    }
  }

  return null;
};

const notifyGuildOnboarding = async (guild: Guild, sessionId: string | null) => {
  try {
    const channel = resolveWelcomeChannel(guild);
    if (!channel || !(channel as any).send) {
      return;
    }
    await (channel as any).send({
      content: DISCORD_MESSAGES.bot.onboardingWelcomeLines(sessionId).join('\n'),
    });
  } catch (error) {
    logger.debug('[AGENT-OPS] onboarding welcome skipped guild=%s reason=%s', guild.id, error instanceof Error ? error.message : String(error));
  }
};

export const registerSlashCommands = async (params: {
  client: Client;
  commandDefinitions: any[];
  discordCommandGuildId: string;
  clearGuildScopedCommandsOnGlobalSync: boolean;
}) => {
  const { client, commandDefinitions, discordCommandGuildId, clearGuildScopedCommandsOnGlobalSync } = params;
  if (!client.application) {
    logger.warn('[BOT] Discord application context unavailable, skipping slash command sync');
    return;
  }

  try {
    let targetGuildIdForFastSync: string | null = null;
    if (discordCommandGuildId) {
      let guild: Guild | undefined;
      try {
        guild = await client.guilds.fetch(discordCommandGuildId);
      } catch (fetchError) {
        logger.error('[BOT] Failed to fetch target guild %s for slash sync: %o', discordCommandGuildId, fetchError);
      }

      if (guild) {
        await guild.commands.set(commandDefinitions);
        logger.info('[BOT] Slash commands synced to guild=%s (%d commands)', discordCommandGuildId, commandDefinitions.length);
        targetGuildIdForFastSync = discordCommandGuildId;
      }

      if (!guild) {
        logger.warn('[BOT] Falling back to global slash command sync because target guild is unavailable');
      }
    }

    await client.application.commands.set(commandDefinitions);
    logger.info('[BOT] Slash commands synced globally (%d commands)', commandDefinitions.length);

    if (clearGuildScopedCommandsOnGlobalSync) {
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

export const attachBaseLifecycleHandlers = (params: {
  client: Client;
  setReadyState: () => void;
  getManualReconnectCooldownRemainingSec: () => number;
  onRegisterSlashCommands: () => Promise<void>;
  startLoginSessionCleanupLoop: () => void;
}) => {
  const { client } = params;

  client.on('clientReady', () => {
    params.setReadyState();
    void params.onRegisterSlashCommands();
    if (isAutomationEnabled()) {
      startAutomationModules(client);
    }
    startAgentDailyLearningLoop(client);
    params.startLoginSessionCleanupLoop();
  });

  client.on('guildCreate', (guild) => {
    const result = onGuildJoined(guild);
    logger.info('[AGENT-OPS] guildCreate onboarding guild=%s ok=%s message=%s', guild.id, String(result.ok), result.message);
    void notifyGuildOnboarding(guild, result.ok ? String(result.sessionId || '') : null);
  });

  client.on('guildDelete', (guild) => {
    const autoPurgeEnabled = String(process.env.FORGET_ON_GUILD_DELETE || 'true').trim().toLowerCase() !== 'false';
    if (!autoPurgeEnabled) {
      return;
    }

    void (async () => {
      try {
        const result = await forgetGuildRagData({
          guildId: guild.id,
          requestedBy: 'system:guildDelete',
          reason: 'discord guildDelete event',
          deleteObsidian: true,
        });
        logger.warn('[PRIVACY-FORGET] guildDelete purge completed guild=%s deleted=%d obsidianPaths=%d', guild.id, result.supabase.totalDeleted, result.obsidian.removedPaths.length);
      } catch (error) {
        logger.error('[PRIVACY-FORGET] guildDelete purge failed guild=%s error=%s', guild.id, error instanceof Error ? error.message : String(error));
      }
    })();
  });
};

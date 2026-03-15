import type { Guild } from 'discord.js';
import logger from '../../logger';
import { onGuildJoined } from '../../services/agentOpsService';
import { forgetGuildRagData } from '../../services/privacyForgetService';

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const handleGuildCreateLifecycle = (guild: Guild): void => {
  const result = onGuildJoined(guild);
  logger.info(
    '[AGENT-OPS] guildCreate onboarding guild=%s ok=%s message=%s',
    guild.id,
    String(result.ok),
    result.message,
  );
};

export const handleGuildDeleteLifecycle = (guild: Guild): void => {
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
      logger.warn(
        '[PRIVACY-FORGET] guildDelete purge completed guild=%s deleted=%d obsidianPaths=%d',
        guild.id,
        result.supabase.totalDeleted,
        result.obsidian.removedPaths.length,
      );
    } catch (error) {
      logger.error('[PRIVACY-FORGET] guildDelete purge failed guild=%s error=%s', guild.id, toErrorMessage(error));
    }
  })();
};

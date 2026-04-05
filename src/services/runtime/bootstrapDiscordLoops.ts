import type { Client } from 'discord.js';
import { startObsidianLoreSyncLoop } from '../obsidian/obsidianLoreSyncService';
import { startRetrievalEvalLoop } from '../eval/retrievalEvalLoopService';
import { startRewardSignalLoop } from '../eval/rewardSignalLoopService';
import { startEvalAutoPromoteLoop } from '../eval/evalAutoPromoteLoopService';
import { startAgentSloAlertLoop } from '../agent/agentSloService';
import { startAgentDailyLearningLoop, startGotCutoverAutopilotLoop } from '../agent/agentOpsService';
import { autoSyncGuildTopologiesOnReady } from '../discord-support/discordTopologySyncService';
import { startLoginSessionCleanupLoop } from '../../discord/auth';
import { getErrorMessage } from '../../utils/errorMessage';
import logger from '../../logger';

/**
 * Bootstrap Discord-dependent background loops: eval, agent ops,
 * obsidian sync, auth cleanup, and topology sync.
 */
export const bootstrapDiscordLoops = (
  client: Client,
  isPgCronOwned: (name: string) => boolean,
): void => {
  startAgentDailyLearningLoop(client);
  startGotCutoverAutopilotLoop(client);

  if (isPgCronOwned('loginSessionCleanupLoop')) {
    logger.info('[RUNTIME] loginSessionCleanupLoop skipped — pg_cron owns it');
  } else {
    startLoginSessionCleanupLoop();
  }

  if (isPgCronOwned('obsidianLoreSyncLoop')) {
    logger.info('[RUNTIME] obsidianLoreSyncLoop skipped — pg_cron owns it');
  } else {
    startObsidianLoreSyncLoop();
  }

  if (isPgCronOwned('retrievalEvalLoop')) {
    logger.info('[RUNTIME] retrievalEvalLoop skipped — pg_cron owns it');
  } else {
    startRetrievalEvalLoop(client);
  }

  if (isPgCronOwned('rewardSignalLoop')) {
    logger.info('[RUNTIME] rewardSignalLoop skipped — pg_cron owns it');
  } else {
    startRewardSignalLoop(client);
  }

  if (isPgCronOwned('evalAutoPromoteLoop')) {
    logger.info('[RUNTIME] evalAutoPromoteLoop skipped — pg_cron owns it');
  } else {
    startEvalAutoPromoteLoop(client);
  }

  if (isPgCronOwned('agentSloAlertLoop')) {
    logger.info('[RUNTIME] agentSloAlertLoop skipped — pg_cron owns it');
  } else {
    startAgentSloAlertLoop();
  }

  void autoSyncGuildTopologiesOnReady(client.guilds.cache.values()).catch((error) => {
    logger.debug('[DISCORD-TOPOLOGY] ready sweep skipped reason=%s', getErrorMessage(error));
  });
};

import type { Client } from 'discord.js';
import logger from '../../logger';
import { isAutomationEnabled, startAutomationModules } from '../../services/automationBot';
import { startAgentDailyLearningLoop } from '../../services/agentOpsService';
import { autoSyncGuildTopologiesOnReady } from '../../services/discordTopologySyncService';
import { startMemoryJobRunner } from '../../services/memoryJobRunner';
import { startObsidianLoreSyncLoop } from '../../services/obsidianLoreSyncService';
import { startRetrievalEvalLoop } from '../../services/retrievalEvalLoopService';
import { startLoginSessionCleanupLoop } from '../auth';

const getErrorMessage = (error: unknown): string => {
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

export const startDiscordReadyWorkloads = (client: Client): void => {
  if (isAutomationEnabled()) {
    startAutomationModules(client);
  }

  startAgentDailyLearningLoop(client);
  startLoginSessionCleanupLoop();
  startMemoryJobRunner();
  startObsidianLoreSyncLoop();
  startRetrievalEvalLoop(client);

  void autoSyncGuildTopologiesOnReady(client.guilds.cache.values()).catch((error) => {
    logger.debug('[DISCORD-TOPOLOGY] ready sweep skipped reason=%s', getErrorMessage(error));
  });
};

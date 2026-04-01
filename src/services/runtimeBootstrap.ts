import type { Client } from 'discord.js';
import { isAutomationEnabled, startAutomationJobs, startAutomationModules } from './automationBot';
import { startMemoryJobRunner } from './memoryJobRunner';
import { startObsidianLoreSyncLoop } from './obsidianLoreSyncService';
import { startRetrievalEvalLoop } from './retrievalEvalLoopService';
import { startAgentSloAlertLoop } from './agent/agentSloService';
import { startAgentDailyLearningLoop, startGotCutoverAutopilotLoop } from './agent/agentOpsService';
import { autoSyncGuildTopologiesOnReady } from './discordTopologySyncService';
import { startRewardSignalLoop } from './rewardSignalLoopService';
import { startEvalAutoPromoteLoop } from './evalAutoPromoteLoopService';
import { startRuntimeAlerts } from './runtimeAlertService';
import { startTradingEngine } from './tradingEngine';
import { startOpencodePublishWorker } from './opencodePublishWorker';
import { startBotAutoRecovery } from './botAutoRecoveryService';
import { startLoginSessionCleanupLoop } from '../discord/auth';
import { rehydrateActivePipelines } from './sprint/sprintOrchestrator';
import { startSprintScheduledTriggers } from './sprint/sprintTriggers';
import { checkGitConfigHealth } from './sprint/autonomousGit';
import { initMcpSkillRouter } from './mcpSkillRouter';
import logger from '../logger';

const runtimeState = {
  serverStarted: false,
  discordReadyStarted: false,
  sharedLoopsStarted: false,
  sharedLoopsSource: null as 'server-process' | 'discord-ready' | null,
};

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

const startSharedLoops = (source: 'server-process' | 'discord-ready') => {
  if (runtimeState.sharedLoopsStarted) {
    return;
  }

  startMemoryJobRunner();
  runtimeState.sharedLoopsStarted = true;
  runtimeState.sharedLoopsSource = source;
};

export const startServerProcessRuntime = (): void => {
  if (runtimeState.serverStarted) {
    return;
  }

  startAutomationJobs();
  startSharedLoops('server-process');
  startOpencodePublishWorker();
  startTradingEngine();
  startRuntimeAlerts();
  startBotAutoRecovery();

  // Restore in-progress sprint pipelines from Supabase
  void rehydrateActivePipelines().catch((error) => {
    logger.debug('[SPRINT] rehydration skipped: %s', getErrorMessage(error));
  });

  // Start scheduled sprint triggers (security audit, improvement)
  startSprintScheduledTriggers();

  // Initialize MCP skill router with health-aware worker discovery
  void initMcpSkillRouter().catch((error) => {
    logger.debug('[MCP-ROUTER] init skipped: %s', getErrorMessage(error));
  });

  // Validate sprint git config at startup
  checkGitConfigHealth();

  runtimeState.serverStarted = true;
};

export const startDiscordReadyRuntime = (client: Client): void => {
  if (runtimeState.discordReadyStarted) {
    return;
  }

  if (isAutomationEnabled()) {
    startAutomationModules(client);
  }

  startAgentDailyLearningLoop(client);
  startGotCutoverAutopilotLoop(client);
  startLoginSessionCleanupLoop();
  startSharedLoops('discord-ready');
  startObsidianLoreSyncLoop();
  startRetrievalEvalLoop(client);
  startRewardSignalLoop(client);
  startEvalAutoPromoteLoop(client);
  startAgentSloAlertLoop();

  void autoSyncGuildTopologiesOnReady(client.guilds.cache.values()).catch((error) => {
    logger.debug('[DISCORD-TOPOLOGY] ready sweep skipped reason=%s', getErrorMessage(error));
  });

  runtimeState.discordReadyStarted = true;
};

export const getRuntimeBootstrapState = () => ({ ...runtimeState });

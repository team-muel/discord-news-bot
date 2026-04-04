import type { Client } from 'discord.js';
import { isAutomationEnabled, startAutomationJobs, startAutomationModules } from '../automationBot';
import { startMemoryJobRunner } from '../memory/memoryJobRunner';
import { startConsolidationLoop } from '../memory/memoryConsolidationService';
import { startUserEmbeddingLoop } from '../memory/userEmbeddingService';
import { startObsidianLoreSyncLoop } from '../obsidian/obsidianLoreSyncService';
import { startRetrievalEvalLoop } from '../eval/retrievalEvalLoopService';
import { startAgentSloAlertLoop } from '../agent/agentSloService';
import { startAgentDailyLearningLoop, startGotCutoverAutopilotLoop } from '../agent/agentOpsService';
import { autoSyncGuildTopologiesOnReady } from '../discord-support/discordTopologySyncService';
import { startRewardSignalLoop } from '../eval/rewardSignalLoopService';
import { startEvalAutoPromoteLoop } from '../eval/evalAutoPromoteLoopService';
import { getErrorMessage } from '../../utils/errorMessage';
import { startRuntimeAlerts } from './runtimeAlertService';
import { startOpencodePublishWorker } from '../opencode/opencodePublishWorker';
import { startBotAutoRecovery } from './botAutoRecoveryService';
import { startLoginSessionCleanupLoop } from '../../discord/auth';
import { rehydrateActivePipelines, listSprintPipelines } from '../sprint/sprintOrchestrator';
import { rehydrateEventSourcingEntities } from '../sprint/eventSourcing/bridge';
import { startSprintScheduledTriggers } from '../sprint/sprintTriggers';
import { checkGitConfigHealth } from '../sprint/autonomousGit';
import { initMcpSkillRouter } from '../mcpSkillRouter';
import { syncHighRiskActionsToSandboxPolicy } from '../skills/actionRunner';
import { autoLoadAdapters } from '../tools/adapterAutoLoader';
import { wireSignalBusConsumers } from './signalBusWiring';
import { bootstrapPgCronJobs, getPgCronReplacedLoops } from '../infra/pgCronBootstrapService';
import { PG_CRON_REPLACES_APP_LOOPS } from '../../config';
import logger from '../../logger';

const runtimeState = {
  serverStarted: false,
  discordReadyStarted: false,
  sharedLoopsStarted: false,
  sharedLoopsSource: null as 'server-process' | 'discord-ready' | null,
  pgCronReplacedLoops: new Set<string>(),
};

/** Check whether a Node.js loop should be skipped because pg_cron owns it. */
const isPgCronOwned = (loopName: string): boolean =>
  PG_CRON_REPLACES_APP_LOOPS && runtimeState.pgCronReplacedLoops.has(loopName);



const startSharedLoops = (source: 'server-process' | 'discord-ready') => {
  if (runtimeState.sharedLoopsStarted) {
    return;
  }

  startMemoryJobRunner();

  if (isPgCronOwned('consolidationLoop')) {
    logger.info('[RUNTIME] consolidationLoop skipped — pg_cron owns it');
  } else {
    startConsolidationLoop();
  }

  // User embedding refresh loop (Daangn-inspired offline user encoder, 24h batch)
  if (isPgCronOwned('userEmbeddingLoop')) {
    logger.info('[RUNTIME] userEmbeddingLoop skipped — pg_cron owns it');
  } else {
    startUserEmbeddingLoop();
  }

  runtimeState.sharedLoopsStarted = true;
  runtimeState.sharedLoopsSource = source;
};

export const startServerProcessRuntime = (): void => {
  if (runtimeState.serverStarted) {
    return;
  }

  // Bootstrap pg_cron jobs before starting loops so we know which ones to skip
  runtimeState.pgCronReplacedLoops = getPgCronReplacedLoops();
  void bootstrapPgCronJobs().catch((error) => {
    logger.debug('[PG-CRON] bootstrap skipped: %s', getErrorMessage(error));
  });

  startAutomationJobs();
  startSharedLoops('server-process');
  startOpencodePublishWorker();
  startRuntimeAlerts();
  startBotAutoRecovery();

  // Restore in-progress sprint pipelines from Supabase
  void rehydrateActivePipelines()
    .then(() => {
      // After legacy rehydration, populate Ventyd entityMap so shadow calls work
      const activeIds = listSprintPipelines(undefined, 50).map((p) => p.sprintId);
      if (activeIds.length > 0) {
        return rehydrateEventSourcingEntities(activeIds);
      }
    })
    .catch((error) => {
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

  // D-06: Sync high-risk actions to OpenShell sandbox policy at startup
  void syncHighRiskActionsToSandboxPolicy().catch((error) => {
    logger.debug('[SANDBOX-POLICY] startup sync skipped: %s', getErrorMessage(error));
  });

  // D-06: Periodic re-sync every 6 hours to catch env changes without restart
  const SANDBOX_POLICY_RESYNC_MS = 6 * 60 * 60_000;
  setInterval(() => {
    void syncHighRiskActionsToSandboxPolicy().catch((error) => {
      logger.debug('[SANDBOX-POLICY] periodic sync skipped: %s', getErrorMessage(error));
    });
  }, SANDBOX_POLICY_RESYNC_MS);

  // M-15 / F-02: Auto-load dynamic adapters from adapters/ directory
  void autoLoadAdapters().catch((error) => {
    logger.debug('[ADAPTER-LOADER] startup auto-load skipped: %s', getErrorMessage(error));
  });

  // Wire cross-cutting signal bus consumers (Layer 1 integration)
  wireSignalBusConsumers();

  // Phase F: Observer Layer — autonomous environment scanning
  if (isPgCronOwned('observerLoop')) {
    logger.info('[RUNTIME] observerLoop skipped — pg_cron owns it');
  } else {
    void import('../observer/observerOrchestrator').then(({ startObserverLoop }) => {
      startObserverLoop();
    }).catch((error) => {
      logger.debug('[OBSERVER] startup skipped: %s', getErrorMessage(error));
    });
  }

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

  if (isPgCronOwned('loginSessionCleanupLoop')) {
    logger.info('[RUNTIME] loginSessionCleanupLoop skipped — pg_cron owns it');
  } else {
    startLoginSessionCleanupLoop();
  }

  startSharedLoops('discord-ready');

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

  runtimeState.discordReadyStarted = true;
};

export const getRuntimeBootstrapState = () => ({
  ...runtimeState,
  pgCronReplacedLoops: [...runtimeState.pgCronReplacedLoops],
});

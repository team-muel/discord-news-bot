import type { Client } from 'discord.js';
import { ChannelType } from 'discord.js';
import { isAutomationEnabled, startAutomationJobs, startAutomationModules } from '../automationBot';
import type { ChannelSink, ChannelSinkSendOptions } from '../automation/types';
import { startMemoryJobRunner } from '../memory/memoryJobRunner';
import { startConsolidationLoop } from '../memory/memoryConsolidationService';
import { startUserEmbeddingLoop } from '../memory/userEmbeddingService';
import { getErrorMessage } from '../../utils/errorMessage';
import { startRuntimeAlerts } from './runtimeAlertService';
import { startOpencodePublishWorker } from '../opencode/opencodePublishWorker';
import { startBotAutoRecovery } from './botAutoRecoveryService';
import { bootstrapPgCronJobs, getPgCronReplacedLoops } from '../infra/pgCronBootstrapService';
import { PG_CRON_REPLACES_APP_LOOPS } from '../../config';
import { bootstrapServerInfrastructure } from './bootstrapServerInfra';
import { bootstrapDiscordLoops } from './bootstrapDiscordLoops';
import { runAndCacheMigrationValidation } from '../../utils/migrationRegistry';
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

  // Check schema migration status (non-blocking, logs warnings for pending)
  void runAndCacheMigrationValidation();

  startAutomationJobs();
  startSharedLoops('server-process');
  startOpencodePublishWorker();
  startRuntimeAlerts();
  startBotAutoRecovery();

  // Delegate sprint, MCP, sandbox, adapters, signal bus, observer
  bootstrapServerInfrastructure(isPgCronOwned);

  runtimeState.serverStarted = true;
};

/** Wrap a discord.js Client into a platform-agnostic ChannelSink (ADR-007). */
const createDiscordChannelSink = (client: Client): ChannelSink => ({
  sendToChannel: async (channelId: string, options: ChannelSinkSendOptions): Promise<boolean> => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;

      const msg = await channel.send({
        content: options.content ?? undefined,
        embeds: options.embeds?.map((e) => ({
          title: e.title,
          description: e.description,
          color: e.color,
          footer: e.footer,
        })),
      });

      if (options.thread && msg) {
        const canThread =
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement;
        if (canThread && typeof msg.startThread === 'function') {
          await msg.startThread({
            name: options.thread.name,
            autoArchiveDuration: options.thread.autoArchiveDuration,
            reason: options.thread.reason,
          });
        }
      }

      return true;
    } catch {
      return false;
    }
  },
});

export const startDiscordReadyRuntime = (client: Client): void => {
  if (runtimeState.discordReadyStarted) {
    return;
  }

  if (isAutomationEnabled()) {
    startAutomationModules(createDiscordChannelSink(client));
  }

  startSharedLoops('discord-ready');

  // Delegate eval, agent ops, obsidian, auth, topology loops
  bootstrapDiscordLoops(client, isPgCronOwned);

  runtimeState.discordReadyStarted = true;
};

export const getRuntimeBootstrapState = () => ({
  ...runtimeState,
  pgCronReplacedLoops: [...runtimeState.pgCronReplacedLoops],
});

/** Reset all mutable state to initial values. Test-only. */
export const resetRuntimeBootstrapState = (): void => {
  runtimeState.serverStarted = false;
  runtimeState.discordReadyStarted = false;
  runtimeState.sharedLoopsStarted = false;
  runtimeState.sharedLoopsSource = null;
  runtimeState.pgCronReplacedLoops = new Set<string>();
};

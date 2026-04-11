import { type Client, ChannelType } from 'discord.js';
import { isAutomationEnabled, startAutomationJobs, startAutomationModules } from '../automationBot';
import type { ChannelSink, ChannelSinkSendOptions } from '../automation/types';
import { startMemoryJobRunner } from '../memory/memoryJobRunner';
import { startConsolidationLoop } from '../memory/memoryConsolidationService';
import { startUserEmbeddingLoop } from '../memory/userEmbeddingService';
import { startObsidianInboxChatLoop } from '../obsidian/obsidianInboxChatLoopService';
import { getErrorMessage } from '../../utils/errorMessage';
import { startRuntimeAlerts } from './runtimeAlertService';
import { startOpencodePublishWorker } from '../opencode/opencodePublishWorker';
import { startBotAutoRecovery } from './botAutoRecoveryService';
import {
  bootstrapPgCronJobs,
  getPgCronReplacedLoopsFromBootstrap,
  type BootstrapResult,
} from '../infra/pgCronBootstrapService';
import { PG_CRON_REPLACES_APP_LOOPS } from '../../config';
import { bootstrapServerInfrastructure } from './bootstrapServerInfra';
import { bootstrapDiscordLoops } from './bootstrapDiscordLoops';
import { runAndCacheMigrationValidation } from '../../utils/migrationRegistry';
import logger from '../../logger';

type PgCronBootstrapStatus = 'not-required' | 'pending' | 'ready' | 'partial' | 'failed';

type PgCronBootstrapSummary = {
  totalJobs: number;
  created: number;
  existing: number;
  error: number;
  confirmedLoopCount: number;
};

type DeferredStartupTask = () => void;

const makeEmptyPgCronSummary = (): PgCronBootstrapSummary => ({
  totalJobs: 0,
  created: 0,
  existing: 0,
  error: 0,
  confirmedLoopCount: 0,
});

const runtimeState = {
  serverStarted: false,
  discordReadyStarted: false,
  sharedLoopsStarted: false,
  sharedLoopsSource: null as 'server-process' | 'discord-ready' | null,
  pgCronReplacedLoops: new Set<string>(),
  pgCronBootstrapStatus: 'not-required' as PgCronBootstrapStatus,
  pgCronBootstrapStartedAt: null as string | null,
  pgCronBootstrapCompletedAt: null as string | null,
  pgCronBootstrapLastError: null as string | null,
  pgCronBootstrapSummary: null as PgCronBootstrapSummary | null,
  deferredStartupTasks: [] as DeferredStartupTask[],
};

/** Check whether a Node.js loop should be skipped because pg_cron owns it. */
const isPgCronOwned = (loopName: string): boolean =>
  PG_CRON_REPLACES_APP_LOOPS && runtimeState.pgCronReplacedLoops.has(loopName);

const isPgCronBootstrapPending = (): boolean =>
  PG_CRON_REPLACES_APP_LOOPS && runtimeState.pgCronBootstrapStatus === 'pending';

const runAfterPgCronBootstrap = (task: DeferredStartupTask): void => {
  if (isPgCronBootstrapPending()) {
    runtimeState.deferredStartupTasks.push(task);
    return;
  }
  task();
};

const flushDeferredStartupTasks = (): void => {
  const tasks = runtimeState.deferredStartupTasks.splice(0, runtimeState.deferredStartupTasks.length);
  for (const task of tasks) task();
};

const summarizePgCronBootstrapResult = (
  result: BootstrapResult,
  confirmedLoopCount: number,
): PgCronBootstrapSummary => {
  const summary = makeEmptyPgCronSummary();
  summary.totalJobs = result.jobs.length;
  summary.confirmedLoopCount = confirmedLoopCount;

  for (const job of result.jobs) {
    if (job.status === 'created') summary.created += 1;
    else if (job.status === 'exists') summary.existing += 1;
    else summary.error += 1;
  }
  return summary;
};

const finalizePgCronBootstrap = (
  status: PgCronBootstrapStatus,
  summary: PgCronBootstrapSummary,
  lastError: string | null,
): void => {
  runtimeState.pgCronBootstrapStatus = status;
  runtimeState.pgCronBootstrapCompletedAt = new Date().toISOString();
  runtimeState.pgCronBootstrapSummary = summary;
  runtimeState.pgCronBootstrapLastError = lastError;
  flushDeferredStartupTasks();
};

const resolvePgCronBootstrap = (result: BootstrapResult): void => {
  const ownedLoops = PG_CRON_REPLACES_APP_LOOPS
    ? getPgCronReplacedLoopsFromBootstrap(result)
    : new Set<string>();
  runtimeState.pgCronReplacedLoops = ownedLoops;

  const summary = summarizePgCronBootstrapResult(result, ownedLoops.size);
  const hasConfirmedOwnership = ownedLoops.size > 0;

  if (!PG_CRON_REPLACES_APP_LOOPS) {
    finalizePgCronBootstrap('not-required', summary, null);
    return;
  }

  if (!hasConfirmedOwnership) {
    const message = summary.error > 0
      ? `${summary.error}/${summary.totalJobs} pg_cron job(s) failed during bootstrap; app loops will stay active`
      : 'No pg_cron jobs were confirmed as installed; app loops will stay active';
    logger.warn('[PG-CRON] %s', message);
    finalizePgCronBootstrap('failed', summary, message);
    return;
  }

  if (summary.error > 0) {
    const message = `${summary.error}/${summary.totalJobs} pg_cron job(s) failed; only confirmed loops will be treated as db-owned`;
    logger.warn('[PG-CRON] %s', message);
    finalizePgCronBootstrap('partial', summary, message);
    return;
  }

  finalizePgCronBootstrap('ready', summary, null);
};

const failPgCronBootstrap = (error: unknown): void => {
  const message = getErrorMessage(error);
  runtimeState.pgCronReplacedLoops = new Set<string>();
  logger.warn('[PG-CRON] bootstrap failed, falling back to app-owned loops: %s', message);
  finalizePgCronBootstrap('failed', makeEmptyPgCronSummary(), message);
};

const startPgCronBootstrap = (): void => {
  if (!PG_CRON_REPLACES_APP_LOOPS) {
    const now = new Date().toISOString();
    runtimeState.pgCronReplacedLoops = new Set<string>();
    runtimeState.pgCronBootstrapStatus = 'not-required';
    runtimeState.pgCronBootstrapStartedAt = now;
    runtimeState.pgCronBootstrapCompletedAt = now;
    runtimeState.pgCronBootstrapSummary = makeEmptyPgCronSummary();
    runtimeState.pgCronBootstrapLastError = null;
    return;
  }

  runtimeState.pgCronReplacedLoops = new Set<string>();
  runtimeState.pgCronBootstrapStatus = 'pending';
  runtimeState.pgCronBootstrapStartedAt = new Date().toISOString();
  runtimeState.pgCronBootstrapCompletedAt = null;
  runtimeState.pgCronBootstrapSummary = null;
  runtimeState.pgCronBootstrapLastError = null;

  void bootstrapPgCronJobs().then(resolvePgCronBootstrap).catch(failPgCronBootstrap);
};

const startSharedLoops = (source: 'server-process' | 'discord-ready') => {
  if (runtimeState.sharedLoopsStarted) {
    return;
  }

  runAfterPgCronBootstrap(() => {
    if (runtimeState.sharedLoopsStarted) return;

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

    startObsidianInboxChatLoop();

    runtimeState.sharedLoopsStarted = true;
    runtimeState.sharedLoopsSource = source;
  });
};

export const startServerProcessRuntime = (): void => {
  if (runtimeState.serverStarted) {
    return;
  }

  runtimeState.serverStarted = true;

  // Bootstrap pg_cron jobs before starting replaceable loops so ownership is confirmed,
  // not assumed from configuration alone.
  startPgCronBootstrap();

  // Check schema migration status (non-blocking, logs warnings for pending)
  void runAndCacheMigrationValidation();

  startAutomationJobs();
  startSharedLoops('server-process');
  startOpencodePublishWorker();
  startRuntimeAlerts();
  startBotAutoRecovery();

  // Delegate sprint, MCP, sandbox, adapters, signal bus, observer
  bootstrapServerInfrastructure(isPgCronOwned);
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

  runtimeState.discordReadyStarted = true;

  if (isAutomationEnabled()) {
    startAutomationModules(createDiscordChannelSink(client));
  }

  startSharedLoops('discord-ready');

  // Delegate eval, agent ops, obsidian, auth, topology loops
  runAfterPgCronBootstrap(() => {
    bootstrapDiscordLoops(client, isPgCronOwned);
  });
};

export const getRuntimeBootstrapState = () => ({
  serverStarted: runtimeState.serverStarted,
  discordReadyStarted: runtimeState.discordReadyStarted,
  sharedLoopsStarted: runtimeState.sharedLoopsStarted,
  sharedLoopsSource: runtimeState.sharedLoopsSource,
  pgCronReplacedLoops: [...runtimeState.pgCronReplacedLoops],
  pgCron: {
    status: runtimeState.pgCronBootstrapStatus,
    startedAt: runtimeState.pgCronBootstrapStartedAt,
    completedAt: runtimeState.pgCronBootstrapCompletedAt,
    lastError: runtimeState.pgCronBootstrapLastError,
    summary: runtimeState.pgCronBootstrapSummary,
    deferredTaskCount: runtimeState.deferredStartupTasks.length,
  },
});

/** Reset all mutable state to initial values. Test-only. */
export const resetRuntimeBootstrapState = (): void => {
  runtimeState.serverStarted = false;
  runtimeState.discordReadyStarted = false;
  runtimeState.sharedLoopsStarted = false;
  runtimeState.sharedLoopsSource = null;
  runtimeState.pgCronReplacedLoops = new Set<string>();
  runtimeState.pgCronBootstrapStatus = 'not-required';
  runtimeState.pgCronBootstrapStartedAt = null;
  runtimeState.pgCronBootstrapCompletedAt = null;
  runtimeState.pgCronBootstrapLastError = null;
  runtimeState.pgCronBootstrapSummary = null;
  runtimeState.deferredStartupTasks = [];
};

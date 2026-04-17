import 'dotenv/config';
import logger from './src/logger';
import initMonitoring from './src/init';
import { BOT_START_FAILURE_EXIT_ENABLED, PORT, START_BOT } from './src/config';
import { startServerProcessRuntime } from './src/services/runtime/runtimeBootstrap';
import { stopAutomationModules } from './src/services/automationBot';
import { stopMcpSkillRouter } from './src/services/mcpSkillRouter';
import { isDiscordLoginRateLimitedError } from './src/discord/runtime/botRuntimeState';
import { stopLoginSessionCleanupLoop } from './src/discord/auth';
import { stopUserEmbeddingLoop } from './src/services/memory/userEmbeddingService';
import { stopConsolidationLoop } from './src/services/memory/memoryConsolidationService';
import { stopMemoryJobRunner } from './src/services/memory/memoryJobRunner';
import { stopObsidianInboxChatLoop } from './src/services/obsidian/obsidianInboxChatLoopService';
import { stopObsidianLoreSyncLoop } from './src/services/obsidian/obsidianLoreSyncService';
import { stopRetrievalEvalLoop } from './src/services/eval/retrievalEvalLoopService';
import { stopEvalAutoPromoteLoop } from './src/services/eval/evalAutoPromoteLoopService';
import { stopRewardSignalLoop } from './src/services/eval/rewardSignalLoopService';
import { stopObserverLoop } from './src/services/observer/observerOrchestrator';
import { stopOpencodePublishWorker } from './src/services/opencode/opencodePublishWorker';
import { stopAutoWorkerProposalBackgroundLoop } from './src/services/workerGeneration/backgroundProposalSweep';
import { stopRuntimeAlerts } from './src/services/runtime/runtimeAlertService';
import { stopAgentSloAlertLoop } from './src/services/agent/agentSloService';
import { stopGotCutoverAutopilotLoop, stopAgentDailyLearningLoop } from './src/services/agent/agentOpsService';
import { stopBotAutoRecovery } from './src/services/runtime/botAutoRecoveryService';
import { stopSprintScheduledTriggers } from './src/services/sprint/sprintTriggers';
import { shutdownCrm } from './src/services/discord-support/userCrmService';
import { stopDiscordChatSdkRuntime } from './src/discord/runtime/chatSdkRuntime';

// Initialize monitoring (Sentry) if configured
initMonitoring();

import { createApp } from './src/app';

const app = createApp();
const HTTP_KEEP_ALIVE_TIMEOUT_MS = Math.max(5_000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 65_000));
const HTTP_HEADERS_TIMEOUT_MS = Math.max(10_000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 66_000));
const HTTP_REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 120_000));
const HTTP_SHUTDOWN_TIMEOUT_MS = Math.max(5_000, Number(process.env.HTTP_SHUTDOWN_TIMEOUT_MS || 15_000));

const exitForRequiredBotFailure = (message: string, error?: unknown) => {
  if (error && isDiscordLoginRateLimitedError(error)) {
    logger.warn('[BOT] %s: %s', message, error instanceof Error ? error.message : String(error));
  } else if (error) {
    logger.error('[BOT] %s: %o', message, error);
  } else {
    logger.error('[BOT] %s', message);
  }

  if (!BOT_START_FAILURE_EXIT_ENABLED) {
    if (error && isDiscordLoginRateLimitedError(error)) {
      logger.warn('[BOT] Startup failure exit is disabled; auto-recovery will retry after rate-limit expires');
    } else {
      logger.warn('[BOT] Startup failure exit is disabled; keeping API process alive for manual/auto recovery');
    }
    return;
  }

  setTimeout(() => {
    process.exit(1);
  }, 25).unref();
};

startServerProcessRuntime();

logger.info('[BOOT] START_BOT=%s START_AUTOMATION_JOBS=%s DISCORD_TOKEN_PRESENT=%s',
  String(START_BOT),
  String(process.env.START_AUTOMATION_JOBS ?? process.env.START_AUTOMATION_BOT ?? 'undefined'),
  String(Boolean(process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN)),
);

if (START_BOT) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    exitForRequiredBotFailure('START_BOT=true but DISCORD token not provided. Bot and automation jobs cannot start without a token.');
  }

  if (token) {
    import('./src/bot')
      .then(({ startBot }) => startBot(token))
      .then(() => {
        logger.info('[BOT] START_BOT enabled and bot started');
      })
      .catch((err) => {
        exitForRequiredBotFailure('Failed to start while START_BOT=true', err);
      });
  }
} else {
  logger.info('[BOT] START_BOT disabled; server-only mode');
}

// 라우터 등록 및 미들웨어 조립은 createApp 내부 또는 별도 파일에서 수행

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`[RENDER_EVENT] SERVER_READY port=${PORT}`);
  logger.info(`Server running on http://localhost:${PORT}`);
});

server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

let shuttingDown = false;

const shutdownServer = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('[PROCESS] Received %s, shutting down HTTP server...', signal);

  // Stop all background services (sync, best-effort)
  const syncStops: Array<[string, () => void]> = [
    ['automationModules', stopAutomationModules],
    ['mcpSkillRouter', stopMcpSkillRouter],
    ['loginSessionCleanup', stopLoginSessionCleanupLoop],
    ['userEmbedding', stopUserEmbeddingLoop],
    ['memoryConsolidation', stopConsolidationLoop],
    ['memoryJobRunner', stopMemoryJobRunner],
    ['obsidianInboxChat', stopObsidianInboxChatLoop],
    ['obsidianLoreSync', stopObsidianLoreSyncLoop],
    ['retrievalEval', stopRetrievalEvalLoop],
    ['evalAutoPromote', stopEvalAutoPromoteLoop],
    ['rewardSignal', stopRewardSignalLoop],
    ['observer', stopObserverLoop],
    ['opencodePublish', stopOpencodePublishWorker],
    ['autoWorkerProposal', stopAutoWorkerProposalBackgroundLoop],
    ['runtimeAlerts', stopRuntimeAlerts],
    ['agentSloAlert', stopAgentSloAlertLoop],
    ['gotCutoverAutopilot', stopGotCutoverAutopilotLoop],
    ['agentDailyLearning', stopAgentDailyLearningLoop],
    ['botAutoRecovery', stopBotAutoRecovery],
    ['sprintScheduledTriggers', stopSprintScheduledTriggers],
  ];

  for (const [name, stop] of syncStops) {
    try { stop(); } catch (err) {
      logger.warn('[PROCESS] stop %s failed: %s', name, err instanceof Error ? err.message : String(err));
    }
  }

  // Flush async resources (CRM activity buffer) before closing
  Promise.allSettled([
    shutdownCrm().catch((err) => {
      logger.warn('[PROCESS] shutdownCrm failed: %s', err instanceof Error ? err.message : String(err));
    }),
    stopDiscordChatSdkRuntime(),
  ]).finally(() => {
    closeHttpServer();
  });
};

const closeHttpServer = () => {
  const forceExitTimer = setTimeout(() => {
    logger.error('[PROCESS] Graceful shutdown timed out after %dms; forcing exit', HTTP_SHUTDOWN_TIMEOUT_MS);
    process.exit(1);
  }, HTTP_SHUTDOWN_TIMEOUT_MS);

  server.close((error) => {
    clearTimeout(forceExitTimer);
    if (error) {
      logger.error('[PROCESS] HTTP server shutdown failed: %o', error);
      process.exit(1);
      return;
    }
    logger.info('[PROCESS] HTTP server shutdown completed');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdownServer('SIGINT'));
process.on('SIGTERM', () => shutdownServer('SIGTERM'));

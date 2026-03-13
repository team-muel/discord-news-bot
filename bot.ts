import 'dotenv/config';
import { client, startBot } from './src/bot';
import { setDefaultResultOrder } from 'dns';
import logger from './src/logger';
import initMonitoring from './src/init';
import { initObsidianRAG } from './src/services/obsidianRagService';

// Initialize monitoring (Sentry) if configured
initMonitoring();

setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (reason) => {
  logger.error('[PROCESS] Unhandled rejection: %o', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[PROCESS] Uncaught exception: %o', error);
});

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;

// 개발환경에서만 간단히 존재 여부를 남깁니다(길이 등 민감정보는 노출하지 않음).
if (process.env.NODE_ENV !== 'production') {
  logger.debug('DEBUG: DISCORD token present? %s', !!token);
}

if (!token) {
  logger.error('DISCORD token not provided. Set DISCORD_TOKEN or DISCORD_BOT_TOKEN.');
  process.exit(1);
}

// 안전한 비동기 시작: startBot이 Promise를 반환하더라도 정상 동작하도록 await 처리합니다.
(async () => {
  try {
    await startBot(token);
    // Initialize Obsidian RAG after bot is ready (non-blocking)
    initObsidianRAG().catch((err) => logger.warn('[BOOT] Obsidian RAG init failed (non-fatal): %o', err));
    logger.info('Muel bot is initiating...');
  } catch (err) {
    logger.error('Failed to start bot: %o', err);
    process.exit(1);
  }
})();

const handleShutdownSignal = async (signal: NodeJS.Signals) => {
  logger.info(`[PROCESS] Received ${signal}, shutting down Discord client...`);
  try {
    if (client && typeof (client as any).isReady === 'function' && (client as any).isReady()) {
      // client.destroy() may be synchronous or return a Promise; wrap with Promise.resolve to await both cases.
      await Promise.resolve((client as any).destroy());
    }
  } catch (error) {
    logger.error('[PROCESS] Failed during Discord client shutdown: %o', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => { handleShutdownSignal('SIGINT').catch(e => logger.error(e)); });
process.on('SIGTERM', () => { handleShutdownSignal('SIGTERM').catch(e => logger.error(e)); });
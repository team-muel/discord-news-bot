import 'dotenv/config';
import logger from './src/logger';
import initMonitoring from './src/init';
import { PORT, START_BOT } from './src/config';
import { startAutomationJobs } from './src/services/automationBot';
import { startMemoryJobRunner } from './src/services/memoryJobRunner';
import { startOpencodePublishWorker } from './src/services/opencodePublishWorker';
import { startRuntimeAlerts } from './src/services/runtimeAlertService';
import { startTradingEngine } from './src/services/tradingEngine';

// Initialize monitoring (Sentry) if configured
initMonitoring();

import { createApp } from './src/app';

const app = createApp();

startAutomationJobs();
startMemoryJobRunner();
startOpencodePublishWorker();
startTradingEngine();
startRuntimeAlerts();

logger.info('[BOOT] START_BOT=%s START_AUTOMATION_JOBS=%s DISCORD_TOKEN_PRESENT=%s',
  String(START_BOT),
  String(process.env.START_AUTOMATION_JOBS ?? process.env.START_AUTOMATION_BOT ?? 'undefined'),
  String(Boolean(process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN)),
);

if (START_BOT) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.error('START_BOT=true but DISCORD token not provided. Bot and automation jobs cannot start without a token.');
  }

  if (token) {
    import('./src/bot')
      .then(({ startBot }) => startBot(token))
      .then(() => {
        logger.info('[BOT] START_BOT enabled and bot started');
      })
      .catch((err) => {
        logger.error('[BOT] Failed to start while START_BOT=true: %o', err);
      });
  }
} else {
  logger.info('[BOT] START_BOT disabled; server-only mode');
}

// 라우터 등록 및 미들웨어 조립은 createApp 내부 또는 별도 파일에서 수행

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`[RENDER_EVENT] SERVER_READY port=${PORT}`);
  logger.info(`Server running on http://localhost:${PORT}`);
});

import { Router } from 'express';
import type { HealthResponse } from '../contracts/bot';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT } from '../config';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../services/automationBot';

export function createHealthRouter(): Router {
  const router = Router();

  const buildBotSnapshot = () => {
    const bot = getBotRuntimeSnapshot();
    return {
      ...bot,
      dynamicWorkerRestore: {
        enabled: Boolean(bot.dynamicWorkerRestoreEnabled),
        attemptedAt: bot.dynamicWorkerRestoreAttemptedAt,
        approvedCount: Number(bot.dynamicWorkerRestoreApprovedCount || 0),
        restoredCount: Number(bot.dynamicWorkerRestoreSuccessCount || 0),
        failedCount: Number(bot.dynamicWorkerRestoreFailedCount || 0),
        lastError: bot.dynamicWorkerRestoreLastError || null,
      },
    };
  };

  router.get('/health', (_req, res) => {
    const bot = buildBotSnapshot();
    const automation = getAutomationRuntimeSnapshot();

    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const botHealthy = botEnabled && bot.ready;
    const automationHealthy = automationEnabled && automation.healthy;
    const healthy = botHealthy || automationHealthy;
    const allEnabledHealthy = (!botEnabled || botHealthy) && (!automationEnabled || automationHealthy);
    const anyEnabled = botEnabled || automationEnabled;
    const status = allEnabledHealthy ? 'ok' : 'degraded';
    const botStatusGrade = !anyEnabled ? 'offline' : allEnabledHealthy ? 'healthy' : healthy ? 'degraded' : 'offline';

    const payload: HealthResponse = {
      status,
      botStatusGrade,
      uptimeSec: Math.floor(process.uptime()),
      bot,
      automation,
    };

    return res.status(200).json(payload);
  });

  router.get('/ready', (_req, res) => {
    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const botReady = botEnabled && getBotRuntimeSnapshot().ready;
    const automationReady = automationEnabled && getAutomationRuntimeSnapshot().healthy;

    if (!botEnabled && !automationEnabled) {
      return res.status(503).json({ status: 'starting', bot: 'all_disabled' });
    }

    if (botReady || automationReady) {
      const mode = botReady && automationReady ? 'all_ready' : 'partial_ready';
      return res.json({ status: 'ok', bot: mode });
    }

    return res.status(503).json({ status: 'starting', bot: 'not_ready' });
  });

  router.get('/api/status', (_req, res) => {
    return res.json({ status: 'ok', now: new Date().toISOString() });
  });

  router.get('/', (_req, res) => {
    res.send('Muel backend is running');
  });

  return router;
}

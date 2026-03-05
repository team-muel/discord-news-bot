import { Router } from 'express';
import type { HealthResponse } from '../contracts/bot';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT } from '../config';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../services/automationBot';

export function createHealthRouter(): Router {
  const router = Router();

  const buildBotSnapshot = () => getBotRuntimeSnapshot();

  router.get('/health', (_req, res) => {
    const bot = buildBotSnapshot();
    const automation = getAutomationRuntimeSnapshot();

    const botDegraded = START_BOT && !bot.ready;
    const automationDegraded = isAutomationEnabled() && !automation.healthy;
    const degraded = botDegraded || automationDegraded;
    const status = degraded ? 'degraded' : 'ok';
    const botStatusGrade = !START_BOT ? 'offline' : degraded ? 'degraded' : 'healthy';

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
    if (isAutomationEnabled() && !getAutomationRuntimeSnapshot().healthy) {
      return res.status(503).json({ status: 'starting', bot: 'automation_not_ready' });
    }

    if (!START_BOT) {
      return res.json({ status: 'ok', bot: 'disabled' });
    }

    if (getBotRuntimeSnapshot().ready) {
      return res.json({ status: 'ok', bot: 'ready' });
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

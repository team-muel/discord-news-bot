import crypto from 'crypto';
import { Router } from 'express';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT } from '../config';
import type { BotStatusApiResponse } from '../contracts/bot';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { appendBenchmarkEvents } from '../services/benchmarkStore';
import { getAutomationRuntimeSnapshot, isAutomationEnabled, triggerAutomationJob } from '../services/automationBot';

export function createBotRouter(): Router {
  const router = Router();

  router.get('/status', requireAuth, (_req, res) => {
    const bot = getBotRuntimeSnapshot();
    const automation = getAutomationRuntimeSnapshot();

    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const primaryHealthy = botEnabled && bot.ready;
    const automationHealthy = automationEnabled && automation.healthy;
    const healthy = primaryHealthy || automationHealthy;
    const allEnabledHealthy = (!botEnabled || primaryHealthy) && (!automationEnabled || automationHealthy);
    const anyEnabled = botEnabled || automationEnabled;

    const statusGrade = !anyEnabled ? 'offline' : allEnabledHealthy ? 'healthy' : healthy ? 'degraded' : 'offline';
    const nextCheckInSec = healthy ? 15 : 45;

    let outageDurationMs = 0;
    if (!healthy) {
      const outageCandidates: string[] = [];
      const botOutageStart = bot.lastDisconnectAt || bot.lastLoginErrorAt || bot.lastLoginAttemptAt;
      if (botOutageStart) {
        outageCandidates.push(botOutageStart);
      }

      for (const job of Object.values(automation.jobs)) {
        const lastErrorAt = job.lastErrorAt;
        const jobUnhealthy = lastErrorAt && (!job.lastSuccessAt || Date.parse(lastErrorAt) >= Date.parse(job.lastSuccessAt));
        if (jobUnhealthy) {
          outageCandidates.push(lastErrorAt);
        }
      }

      const parsed = outageCandidates
        .map((value) => Date.parse(value))
        .filter((value) => Number.isFinite(value));
      const outageStartMs = parsed.length ? Math.min(...parsed) : NaN;
      outageDurationMs = Number.isFinite(outageStartMs) ? Math.max(0, Date.now() - outageStartMs) : 0;
    }

    appendBenchmarkEvents([
      {
        id: crypto.randomUUID(),
        name: 'bot_status_view',
        ts: new Date().toISOString(),
        path: '/api/bot/status',
        payload: { status: statusGrade },
      },
    ]);

    const payload: BotStatusApiResponse = {
      healthy,
      statusGrade,
      statusSummary: statusGrade === 'healthy'
        ? 'Bots are healthy'
        : statusGrade === 'degraded'
          ? 'One or more bot services are degraded'
          : 'Bot services are offline',
      recommendations: healthy ? [] : ['Check Discord bot and automation worker logs'],
      nextCheckInSec,
      outageDurationMs,
      bot,
      automation,
    };

    return res.json(payload);
  });

  router.post('/automation/:jobName/run', requireAdmin, async (req, res) => {
    const jobName = String(req.params.jobName || '');
    if (jobName !== 'news-analysis' && jobName !== 'youtube-monitor') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const result = await triggerAutomationJob(jobName);
    if (!result.ok) {
      return res.status(409).json({ ok: false, message: result.message });
    }

    return res.status(202).json({ ok: true, message: `${jobName} execution started` });
  });

  router.post('/reconnect', requireAdmin, (_req, res) => {
    appendBenchmarkEvents([
      {
        id: crypto.randomUUID(),
        name: 'bot_reconnect_manual',
        ts: new Date().toISOString(),
        path: '/api/bot/reconnect',
        payload: { source: 'api', status: START_BOT ? 'accepted' : 'rejected', reason: START_BOT ? 'OK' : 'BOT_DISABLED' },
      },
    ]);

    if (!START_BOT) {
      return res.status(409).json({ error: 'BOT_DISABLED' });
    }

    return res.status(202).json({ ok: true, message: 'Reconnect request accepted' });
  });

  return router;
}

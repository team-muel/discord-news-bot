import crypto from 'crypto';
import { Router } from 'express';
import { client, getBotRuntimeSnapshot, requestManualReconnect } from '../bot';
import { BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, START_BOT } from '../config';
import type { BotStatusApiResponse } from '../contracts/bot';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { appendBenchmarkEvents } from '../services/benchmarkStore';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import { getAutomationRuntimeSnapshot, isAutomationEnabled, triggerAutomationJob } from '../services/automationBot';
import { createRateLimiter } from '../middleware/rateLimit';
import { toStringParam } from '../utils/validation';

let lastBotStatusBenchmarkAt = 0;

export function createBotRouter(): Router {
  const router = Router();
  const adminActionRateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: 'bot-admin-action',
    store: 'supabase',
  });

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

    const now = Date.now();
    if (now - lastBotStatusBenchmarkAt >= BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS) {
      lastBotStatusBenchmarkAt = now;
      appendBenchmarkEvents([
        {
          id: crypto.randomUUID(),
          name: 'bot_status_view',
          ts: new Date().toISOString(),
          path: '/api/bot/status',
          payload: { status: statusGrade },
        },
      ]);
    }

    const payload: BotStatusApiResponse = {
      healthy,
      statusGrade,
      statusSummary: statusGrade === 'healthy'
        ? 'Discord and automation services are healthy'
        : statusGrade === 'degraded'
          ? 'One or more runtime services are degraded'
          : 'Runtime services are offline',
      recommendations: healthy ? [] : ['Check Discord bot and automation job logs'],
      nextCheckInSec,
      outageDurationMs,
      bot,
      automation,
    };

    return res.json(payload);
  });

  router.post('/automation/:jobName/run', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const jobName = String(req.params.jobName || '');
    if (jobName !== 'youtube-monitor' && jobName !== 'news-monitor') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const guildId = toStringParam(req.body?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, message: 'guildId is required for scoped manual run' });
    }

    const result = await triggerAutomationJob(jobName, { guildId });
    if (!result.ok) {
      return res.status(409).json({ ok: false, message: result.message });
    }

    return res.status(202).json({ ok: true, message: `${jobName} execution started`, guildId });
  });

  router.post('/reconnect', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const requestedSource = toStringParam(req.body?.reason);
    const source = requestedSource || 'api';

    if (!START_BOT) {
      appendBenchmarkEvents([
        {
          id: crypto.randomUUID(),
          name: 'bot_reconnect_manual',
          ts: new Date().toISOString(),
          path: '/api/bot/reconnect',
          payload: { source, status: 'rejected', reason: 'BOT_DISABLED' },
        },
      ]);
      return res.status(409).json({ ok: false, message: '봇이 비활성화되어 있습니다.' });
    }

    const result = await requestManualReconnect(`api:${source}`);

    appendBenchmarkEvents([
      {
        id: crypto.randomUUID(),
        name: 'bot_reconnect_manual',
        ts: new Date().toISOString(),
        path: '/api/bot/reconnect',
        payload: { source, status: result.status, reason: result.reason },
      },
    ]);

    if (!result.ok) {
      return res.status(409).json({ ok: false, message: result.message });
    }

    return res.status(202).json({ ok: true, message: result.message });
  });

  router.get('/usage', requireAdmin, async (_req, res) => {
    const discordGuildCount = client.guilds.cache.size;

    if (!isSupabaseConfigured()) {
      return res.json({
        discordGuildCount,
        sources: {
          total: 0,
          active: 0,
          youtube: 0,
          news: 0,
        },
        byGuild: [],
        note: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const db = getSupabaseClient();
    const { data, error } = await db
      .from('sources')
      .select('guild_id, is_active, name, created_at');

    if (error) {
      return res.status(500).json({ error: error.message || 'USAGE_QUERY_FAILED' });
    }

    const rows = data || [];
    const byGuildMap = new Map<string, {
      guildId: string;
      total: number;
      active: number;
      youtube: number;
      news: number;
      newestCreatedAt: string | null;
    }>();

    for (const row of rows as Array<{ guild_id: string | null; is_active: boolean | null; name: string | null; created_at: string | null }>) {
      const guildId = row.guild_id || 'unknown';
      const stat = byGuildMap.get(guildId) || {
        guildId,
        total: 0,
        active: 0,
        youtube: 0,
        news: 0,
        newestCreatedAt: null,
      };

      stat.total += 1;
      if (row.is_active) {
        stat.active += 1;
      }

      if ((row.name || '').startsWith('youtube-')) {
        stat.youtube += 1;
      } else if (row.name === 'google-finance-news') {
        stat.news += 1;
      }

      if (row.created_at && (!stat.newestCreatedAt || Date.parse(row.created_at) > Date.parse(stat.newestCreatedAt))) {
        stat.newestCreatedAt = row.created_at;
      }

      byGuildMap.set(guildId, stat);
    }

    const byGuild = [...byGuildMap.values()].sort((a, b) => b.active - a.active || b.total - a.total);
    const sourceTotal = rows.length;
    const sourceActive = rows.filter((row: any) => Boolean(row.is_active)).length;
    const youtubeTotal = rows.filter((row: any) => String(row.name || '').startsWith('youtube-')).length;
    const newsTotal = rows.filter((row: any) => String(row.name || '') === 'google-finance-news').length;

    return res.json({
      discordGuildCount,
      sources: {
        total: sourceTotal,
        active: sourceActive,
        youtube: youtubeTotal,
        news: newsTotal,
      },
      byGuild,
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}

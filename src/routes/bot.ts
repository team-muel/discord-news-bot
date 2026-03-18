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
import { createIdempotencyGuard } from '../middleware/idempotency';
import { toStringParam } from '../utils/validation';
import { parseIntegerEnv } from '../utils/env';
import { getMultiAgentRuntimeSnapshot } from '../services/multiAgentService';
import { getActionRunnerDiagnosticsSnapshot } from '../services/skills/actionRunner';
import { getWorkerApprovalStoreSnapshot } from '../services/workerGeneration/workerApprovalStore';
import { getWorkerProposalMetricsSnapshot } from '../services/workerGeneration/workerProposalMetrics';
import { registerBotAgentRoutes } from './botAgentRoutes';

let lastBotStatusBenchmarkAt = 0;
const BOT_STATUS_CACHE_TTL_MS = Math.max(1_000, parseIntegerEnv(process.env.BOT_STATUS_CACHE_TTL_MS, 5_000));
const BOT_STATUS_RATE_WINDOW_MS = Math.max(1_000, parseIntegerEnv(process.env.BOT_STATUS_RATE_WINDOW_MS, 60_000));
const BOT_STATUS_RATE_MAX = Math.max(1, parseIntegerEnv(process.env.BOT_STATUS_RATE_MAX, 60));
const BOT_ADMIN_ACTION_RATE_WINDOW_MS = Math.max(1_000, parseIntegerEnv(process.env.BOT_ADMIN_ACTION_RATE_WINDOW_MS, 60_000));
const BOT_ADMIN_ACTION_RATE_MAX = Math.max(1, parseIntegerEnv(process.env.BOT_ADMIN_ACTION_RATE_MAX, 20));

let botStatusCache: {
  payload: BotStatusApiResponse | null;
  expiresAt: number;
  inFlight: Promise<BotStatusApiResponse> | null;
} = {
  payload: null,
  expiresAt: 0,
  inFlight: null,
};

const buildBotStatusPayload = async (): Promise<BotStatusApiResponse> => {
  const bot = getBotRuntimeSnapshot();
  const automation = getAutomationRuntimeSnapshot();
  const approvalStore = await getWorkerApprovalStoreSnapshot();
  const actionRunnerDiagnostics = getActionRunnerDiagnosticsSnapshot();
  const workerProposalMetrics = getWorkerProposalMetricsSnapshot();
  const topFailureCodeRecommendations = actionRunnerDiagnostics.topFailureCodes
    .flatMap((item) => {
      if (item.code === 'ACTION_NOT_IMPLEMENTED' || item.code === 'DYNAMIC_WORKER_NOT_FOUND') {
        return ['Top failure: missing implementation; prioritize worker proposal and approval for uncovered actions'];
      }
      if (item.code === 'ACTION_POLICY_UNAVAILABLE') {
        return ['Top failure: governance policy unavailable; verify policy store connectivity and fallback mode'];
      }
      if (item.code === 'ACTION_NOT_ALLOWED' || item.code === 'ACTION_DISABLED_BY_POLICY' || item.code === 'ACTION_APPROVAL_REQUIRED') {
        return ['Top failure: policy blocked actions; review allowlist/run-mode and admin approval backlog'];
      }
      if (item.code.includes('FINOPS') || item.code.includes('BUDGET')) {
        return ['Top failure: FinOps budget guardrail blocks execution; tune budget limits or degraded policy'];
      }
      if (item.code.includes('WORKER') || item.code.includes('MCP_') || item.code === 'ACTION_TIMEOUT') {
        return ['Top failure: external/runtime dependency unstable; inspect worker runtime and upstream latency'];
      }
      return [] as string[];
    })
    .slice(0, 2);

  const botEnabled = START_BOT;
  const automationEnabled = isAutomationEnabled();
  const primaryHealthy = botEnabled && bot.ready;
  const automationHealthy = automationEnabled && automation.healthy;
  const healthy = primaryHealthy || automationHealthy;
  const allEnabledHealthy = (!botEnabled || primaryHealthy) && (!automationEnabled || automationHealthy);
  const anyEnabled = botEnabled || automationEnabled;

  const statusGrade = !anyEnabled ? 'offline' : allEnabledHealthy ? 'healthy' : healthy ? 'degraded' : 'offline';
  const nextCheckInSec = healthy ? 15 : 45;
  const dynamicRestoreFailed = Number(bot.dynamicWorkerRestoreFailedCount || 0);

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

  return {
    healthy,
    statusGrade,
    statusSummary: statusGrade === 'healthy'
      ? 'Discord and automation services are healthy'
      : statusGrade === 'degraded'
        ? 'One or more runtime services are degraded'
        : 'Runtime services are offline',
    recommendations: [
      ...(healthy ? [] : ['Check Discord bot and automation job logs']),
      ...(dynamicRestoreFailed > 0
        ? ['Dynamic worker restore failures detected; inspect runtime logs and approval artifacts']
        : []),
      ...((approvalStore.configuredMode === 'supabase' && approvalStore.activeBackend !== 'supabase')
        ? ['Worker approval store is not using Supabase backend; verify schema/env and fallback condition']
        : []),
      ...(approvalStore.lastError
        ? [`Worker approval store error: ${approvalStore.lastError}`]
        : []),
      ...(Number(actionRunnerDiagnostics.failureTotals.missingAction || 0) > 0
        ? ['Missing action failures detected; consider worker generation proposal for uncovered capabilities']
        : []),
      ...((actionRunnerDiagnostics.trend.direction === 'up' && actionRunnerDiagnostics.trend.comparedRuns > 0)
        ? ['Action runner failure trend is rising; inspect latest policy/action changes and external dependencies']
        : []),
      ...(actionRunnerDiagnostics.topFailureCodes.length > 0
        ? [`Top failure codes: ${actionRunnerDiagnostics.topFailureCodes.map((item) => `${item.code}(${item.count})`).join(', ')}`]
        : []),
      ...topFailureCodeRecommendations,
      ...((workerProposalMetrics.generationRequested >= 5 && workerProposalMetrics.generationSuccessRate < 0.5)
        ? ['Worker generation success rate is low; tighten prompts and validator constraints']
        : []),
      ...(workerProposalMetrics.topGenerationFailureReasons.length > 0
        ? [`Top worker generation failures: ${workerProposalMetrics.topGenerationFailureReasons.map((item) => `${item.reason}(${item.count})`).join(', ')}`]
        : []),
      ...((workerProposalMetrics.approvalsApproved + workerProposalMetrics.approvalsRejected >= 5 && workerProposalMetrics.approvalPassRate < 0.4)
        ? ['Worker approval pass rate is low; improve proposal quality or adjust approval criteria']
        : []),
    ],
    nextCheckInSec,
    outageDurationMs,
    bot: {
      ...bot,
      dynamicWorkerRestore: {
        enabled: Boolean(bot.dynamicWorkerRestoreEnabled),
        attemptedAt: bot.dynamicWorkerRestoreAttemptedAt,
        approvedCount: Number(bot.dynamicWorkerRestoreApprovedCount || 0),
        restoredCount: Number(bot.dynamicWorkerRestoreSuccessCount || 0),
        failedCount: Number(bot.dynamicWorkerRestoreFailedCount || 0),
        lastError: bot.dynamicWorkerRestoreLastError || null,
      },
      workerApprovalStore: approvalStore,
    },
    automation,
    actionRunnerDiagnostics,
    workerProposalMetrics,
    agents: getMultiAgentRuntimeSnapshot(),
  };
};

export function createBotRouter(): Router {
  const router = Router();
  const botStatusRateLimiter = createRateLimiter({
    windowMs: BOT_STATUS_RATE_WINDOW_MS,
    max: BOT_STATUS_RATE_MAX,
    keyPrefix: 'bot-status-read',
    store: 'supabase',
    onStoreError: 'allow',
  });
  const adminActionRateLimiter = createRateLimiter({
    windowMs: BOT_ADMIN_ACTION_RATE_WINDOW_MS,
    max: BOT_ADMIN_ACTION_RATE_MAX,
    keyPrefix: 'bot-admin-action',
    store: 'supabase',
    onStoreError: 'reject',
  });
  const adminIdempotency = createIdempotencyGuard({ scope: 'bot-admin', ttlSec: 86_400, requireHeader: false });
  const opencodeIdempotency = createIdempotencyGuard({ scope: 'bot-opencode', ttlSec: 86_400, requireHeader: false });

  router.get('/status', requireAuth, botStatusRateLimiter, (_req, res) => {
    return (async () => {
    const now = Date.now();
    if (botStatusCache.payload && now < botStatusCache.expiresAt) {
      return res.json(botStatusCache.payload);
    }

    if (!botStatusCache.inFlight) {
      botStatusCache.inFlight = buildBotStatusPayload()
        .then((payload) => {
          botStatusCache = {
            payload,
            expiresAt: Date.now() + BOT_STATUS_CACHE_TTL_MS,
            inFlight: null,
          };
          return payload;
        })
        .catch((error) => {
          botStatusCache = {
            ...botStatusCache,
            inFlight: null,
          };
          throw error;
        });
    }

    const payload = await botStatusCache.inFlight;
    return res.json(payload);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: 'STATUS_BUILD_FAILED', message });
    });
  });

  router.post('/automation/:jobName/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

  router.post('/reconnect', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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


  registerBotAgentRoutes({
    router,
    adminActionRateLimiter,
    adminIdempotency,
    opencodeIdempotency,
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

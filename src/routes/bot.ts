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
import { isOneOf, toBoundedInt, toStringParam } from '../utils/validation';
import {
  cancelAgentSession,
  getAgentSession,
  getAgentPolicy,
  listAgentDeadletters,
  getMultiAgentRuntimeSnapshot,
  listAgentSkills,
  listGuildAgentSessions,
  startAgentSession,
} from '../services/multiAgentService';
import { listActions } from '../services/skills/actions/registry';
import {
  decideActionApprovalRequest,
  isActionRunMode,
  listActionApprovalRequests,
  listGuildActionPolicies,
  upsertGuildActionPolicy,
} from '../services/skills/actionGovernanceStore';
import { getActionRunnerDiagnosticsSnapshot } from '../services/skills/actionRunner';
import {
  getAgentOpsSnapshot,
  triggerDailyLearningRun,
  triggerGuildOnboardingSession,
} from '../services/agentOpsService';
import {
  addMemoryFeedback,
  createMemoryItem,
  isConflictStatus,
  isFeedbackAction,
  isMemoryJobType,
  isMemoryType,
  listMemoryConflicts,
  queueMemoryJob,
  resolveMemoryConflict,
  searchGuildMemory,
} from '../services/agentMemoryStore';
import type { MemoryType } from '../services/agentMemoryStore';
import {
  cancelMemoryJob,
  getMemoryJobQueueStats,
  getMemoryJobRunnerStats,
  listMemoryJobDeadletters,
  requeueDeadletterJob,
} from '../services/memoryJobRunner';
import { getMemoryQualityMetrics } from '../services/memoryQualityMetricsService';
import { buildGoNoGoReport } from '../services/goNoGoService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../services/finopsService';
import { isUserAdmin } from '../services/adminAllowlistService';
import {
  forgetGuildRagData,
  forgetUserRagData,
  previewForgetGuildRagData,
  previewForgetUserRagData,
} from '../services/privacyForgetService';
import { getWorkerApprovalStoreSnapshot } from '../services/workerGeneration/workerApprovalStore';
import { getWorkerProposalMetricsSnapshot } from '../services/workerGeneration/workerProposalMetrics';

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
    return (async () => {
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

    const payload: BotStatusApiResponse = {
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

    return res.json(payload);
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: 'STATUS_BUILD_FAILED', message });
    });
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

  router.get('/agent/sessions', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    const limit = Number(req.query?.limit || 10);
    const sessions = listGuildAgentSessions(guildId, Number.isFinite(limit) ? limit : 10);
    return res.json({
      runtime: getMultiAgentRuntimeSnapshot(),
      skills: listAgentSkills(),
      sessions,
    });
  });

  router.get('/agent/deadletters', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });
    const deadletters = listAgentDeadletters({ guildId, limit });
    return res.json({
      runtime: getMultiAgentRuntimeSnapshot(),
      deadletters,
      guildScope: guildId || 'all',
    });
  });

  router.get('/agent/skills', requireAdmin, async (_req, res) => {
    return res.json({ skills: listAgentSkills() });
  });

  router.get('/agent/policy', requireAdmin, async (_req, res) => {
    return res.json({ policy: getAgentPolicy(), ops: getAgentOpsSnapshot() });
  });

  router.post('/agent/privacy/forget-user', requireAuth, adminActionRateLimiter, async (req, res) => {
    const requester = toStringParam(req.user?.id) || '';
    const targetUserId = toStringParam(req.body?.userId) || requester;
    const guildId = toStringParam(req.body?.guildId) || undefined;
    const confirm = toStringParam(req.body?.confirm);
    const deleteObsidian = req.body?.deleteObsidian !== false;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }
    if (!targetUserId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'userId is required' });
    }

    const admin = await isUserAdmin(requester);
    if (targetUserId !== requester && !admin) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can erase other users' });
    }

    const expectedConfirm = targetUserId === requester ? 'FORGET_USER' : 'FORGET_USER_ADMIN';
    if (confirm !== expectedConfirm) {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION',
        message: `confirm must be ${expectedConfirm}`,
      });
    }

    try {
      const result = await forgetUserRagData({
        userId: targetUserId,
        guildId,
        requestedBy: requester,
        reason: toStringParam(req.body?.reason) || 'api:forget-user',
        deleteObsidian,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'USER_ID_REQUIRED') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_USER_FAILED', message });
    }
  });

  router.post('/agent/privacy/forget-guild', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const confirm = toStringParam(req.body?.confirm);
    const requester = toStringParam(req.user?.id) || 'api';
    const deleteObsidian = req.body?.deleteObsidian !== false;

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (confirm !== 'FORGET_GUILD') {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'confirm must be FORGET_GUILD' });
    }

    try {
      const result = await forgetGuildRagData({
        guildId,
        requestedBy: requester,
        reason: toStringParam(req.body?.reason) || 'api:forget-guild',
        deleteObsidian,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'GUILD_ID_REQUIRED') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_GUILD_FAILED', message });
    }
  });

  router.get('/agent/privacy/forget-preview', requireAuth, async (req, res) => {
    const scope = toStringParam(req.query?.scope) || 'user';
    const requester = toStringParam(req.user?.id) || '';
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const userId = toStringParam(req.query?.userId) || requester;

    if (!requester) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    try {
      if (scope === 'guild') {
        if (!guildId) {
          return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required for guild scope' });
        }
        const admin = await isUserAdmin(requester);
        if (!admin) {
          return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'admin required for guild scope preview' });
        }
        const preview = await previewForgetGuildRagData(guildId);
        return res.json({ ok: true, preview });
      }

      const admin = await isUserAdmin(requester);
      if (userId !== requester && !admin) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'only admin can preview other users' });
      }
      const preview = await previewForgetUserRagData({ userId, guildId });
      return res.json({ ok: true, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'FORGET_PREVIEW_FAILED', message });
    }
  });

  router.get('/agent/actions/policies', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    const [savedPolicies, actionCatalog] = await Promise.all([
      listGuildActionPolicies(guildId),
      Promise.resolve(listActions()),
    ]);

    return res.json({
      guildId,
      actions: actionCatalog.map((action) => action.name),
      policies: savedPolicies,
    });
  });

  router.put('/agent/actions/policies', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const actionName = toStringParam(req.body?.actionName);
    const runMode = toStringParam(req.body?.runMode) || 'auto';
    const enabledRaw = req.body?.enabled;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : String(enabledRaw || '').trim() !== 'false';

    if (!guildId || !actionName) {
      return res.status(400).json({ error: 'guildId and actionName are required' });
    }

    if (!listActions().some((action) => action.name === actionName)) {
      return res.status(400).json({ error: 'unknown actionName' });
    }

    if (!isActionRunMode(runMode)) {
      return res.status(400).json({ error: 'invalid runMode (auto|approval_required|disabled)' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName,
        enabled,
        runMode,
        actorId,
      });
      return res.json({ ok: true, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'ACTION_POLICY_UPDATE_FAILED', message });
    }
  });

  router.get('/agent/actions/approvals', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusValue = toStringParam(req.query?.status) as 'pending' | 'approved' | 'rejected' | 'expired' | '';
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });

    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    if (statusValue && !isOneOf(statusValue, ['pending', 'approved', 'rejected', 'expired'])) {
      return res.status(400).json({ error: 'invalid status' });
    }

    const items = await listActionApprovalRequests({
      guildId,
      status: statusValue || undefined,
      limit,
    });

    return res.json({ ok: true, items });
  });

  router.post('/agent/actions/approvals/:requestId/decision', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const requestId = toStringParam(req.params.requestId);
    const decision = toStringParam(req.body?.decision);
    const reason = toStringParam(req.body?.reason);

    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required' });
    }

    if (!isOneOf(decision, ['approve', 'reject'])) {
      return res.status(400).json({ error: 'decision must be approve|reject' });
    }

    const actorId = toStringParam(req.user?.id) || 'api';
    const updated = await decideActionApprovalRequest({
      requestId,
      decision: decision as 'approve' | 'reject',
      actorId,
      reason: reason || undefined,
    });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'REQUEST_NOT_FOUND' });
    }

    return res.json({ ok: true, request: updated });
  });

  router.post('/agent/onboarding/run', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    if (!guildId) {
      return res.status(400).json({ error: 'guildId is required' });
    }

    const guildName = toStringParam(req.body?.guildName) || undefined;
    const requestedBy = toStringParam(req.user?.id) || 'api';
    const result = triggerGuildOnboardingSession({
      guildId,
      guildName,
      requestedBy,
      reason: 'api-onboarding-run',
    });

    return res.status(result.ok ? 202 : 409).json(result);
  });

  router.post('/agent/learning/run', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const result = triggerDailyLearningRun(client, guildId || undefined);
    return res.status(result.ok ? 202 : 409).json(result);
  });

  router.get('/agent/sessions/:sessionId', requireAdmin, async (req, res) => {
    const sessionId = toStringParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = getAgentSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }

    return res.json({ session });
  });

  router.post('/agent/sessions', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const goal = toStringParam(req.body?.goal);
    const skillId = toStringParam(req.body?.skillId);
    const priority = req.body?.priority ? String(req.body.priority).trim() : undefined;
    if (!guildId || !goal) {
      return res.status(400).json({ error: 'guildId and goal are required' });
    }

    const requester = toStringParam(req.user?.id) || 'api';
    let session;
    try {
      session = startAgentSession({
        guildId,
        requestedBy: requester,
        goal,
        skillId: skillId || null,
        priority,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(409).json({ ok: false, message });
    }

    return res.status(202).json({ ok: true, session });
  });

  router.post('/agent/sessions/:sessionId/cancel', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const sessionId = toStringParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = cancelAgentSession(sessionId);
    if (!result.ok) {
      return res.status(409).json({ ok: false, message: result.message });
    }

    return res.status(202).json({ ok: true, message: result.message });
  });

  router.get('/agent/memory/search', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const q = toStringParam(req.query?.q);
    const typeValue = toStringParam(req.query?.type);
    const limit = toBoundedInt(req.query?.limit, 8, { min: 1, max: 20 });

    if (!guildId || !q) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and q are required' });
    }

    if (typeValue && !isMemoryType(typeValue)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid type' });
    }

    const memoryType: MemoryType | undefined = typeValue ? (typeValue as MemoryType) : undefined;

    try {
      const result = await searchGuildMemory({
        guildId,
        query: q,
        type: memoryType,
        limit,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_SEARCH_FAILED', message });
    }
  });

  router.post('/agent/memory/items', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const channelId = toStringParam(req.body?.channelId);
    const ownerUserId = toStringParam(req.body?.ownerUserId);
    const typeValue = toStringParam(req.body?.type);
    const title = toStringParam(req.body?.title);
    const content = toStringParam(req.body?.content);
    const confidenceRaw = req.body?.confidence;
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.map((tag: unknown) => toStringParam(tag)).filter(Boolean)
      : [];

    if (!guildId || !typeValue || !content) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId, type, content are required' });
    }

    if (!isMemoryType(typeValue)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid type' });
    }

    const sourceKind = toStringParam(req.body?.source?.sourceKind);
    const allowedSourceKinds = ['discord_message', 'summary_job', 'admin_edit', 'system'] as const;
    if (sourceKind && !isOneOf(sourceKind, allowedSourceKinds)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid sourceKind' });
    }

    const sourceKindTyped = (sourceKind || 'admin_edit') as (typeof allowedSourceKinds)[number];

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const item = await createMemoryItem({
        guildId,
        channelId: channelId || undefined,
        type: typeValue as MemoryType,
        title: title || undefined,
        content,
        ownerUserId: ownerUserId || undefined,
        tags,
        confidence: Number.isFinite(Number(confidenceRaw)) ? Number(confidenceRaw) : undefined,
        actorId,
        source: req.body?.source
          ? {
            sourceKind: sourceKindTyped,
            sourceMessageId: toStringParam(req.body.source.sourceMessageId) || undefined,
            sourceAuthorId: toStringParam(req.body.source.sourceAuthorId) || undefined,
            sourceRef: toStringParam(req.body.source.sourceRef) || undefined,
            excerpt: toStringParam(req.body.source.excerpt) || undefined,
          }
          : undefined,
      });

      return res.status(201).json({ ok: true, item });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message.startsWith('OBSIDIAN_SANITIZER_BLOCKED:')) {
        return res.status(422).json({ ok: false, error: 'SANITIZER', message });
      }
      if (message === 'MEMORY_CONTENT_BLOCKED_BY_POISON_GUARD') {
        return res.status(422).json({ ok: false, error: 'POISON_GUARD', message: 'content blocked by poison guard' });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_CREATE_FAILED', message });
    }
  });

  router.post('/agent/memory/items/:memoryId/feedback', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const memoryId = toStringParam(req.params.memoryId);
    const guildId = toStringParam(req.body?.guildId);
    const action = toStringParam(req.body?.action);

    if (!memoryId || !guildId || !action) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'memoryId, guildId, action are required' });
    }

    if (!isFeedbackAction(action)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid action' });
    }

    const patch = req.body?.patch;
    const patchObject = patch && typeof patch === 'object' && !Array.isArray(patch)
      ? patch as Record<string, unknown>
      : undefined;

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      await addMemoryFeedback({
        memoryId,
        guildId,
        action,
        actorId,
        reason: toStringParam(req.body?.reason) || undefined,
        patch: patchObject,
      });

      return res.status(202).json({ ok: true, message: 'feedback accepted', memoryId, action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'MEMORY_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_FEEDBACK_FAILED', message });
    }
  });

  router.get('/agent/memory/conflicts', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusValue = toStringParam(req.query?.status) || 'open';
    const limit = toBoundedInt(req.query?.limit, 20, { min: 1, max: 100 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!isConflictStatus(statusValue)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid status' });
    }

    try {
      const conflicts = await listMemoryConflicts({ guildId, status: statusValue, limit });
      return res.json({ ok: true, conflicts });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_CONFLICTS_FAILED', message });
    }
  });

  router.post('/agent/memory/conflicts/:conflictId/resolve', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const conflictId = toBoundedInt(req.params.conflictId, -1, { min: 1 });
    const status = toStringParam(req.body?.status) || 'resolved';
    const resolution = toStringParam(req.body?.resolution) || undefined;
    const keepItemId = toStringParam(req.body?.keepItemId) || undefined;

    if (!guildId || conflictId <= 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and valid conflictId are required' });
    }
    if (!isOneOf(status, ['resolved', 'ignored'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'status must be resolved|ignored' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const result = await resolveMemoryConflict({
        conflictId,
        guildId,
        actorId,
        status: status as 'resolved' | 'ignored',
        resolution,
        keepItemId,
      });
      return res.status(202).json({ ok: true, conflict: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'MEMORY_CONFLICT_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'INVALID_KEEP_ITEM_ID') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_CONFLICT_RESOLVE_FAILED', message });
    }
  });

  router.post('/agent/memory/jobs/run', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const jobType = toStringParam(req.body?.jobType);
    const windowStartedAt = toStringParam(req.body?.windowStartedAt);
    const windowEndedAt = toStringParam(req.body?.windowEndedAt);

    if (!guildId || !jobType) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and jobType are required' });
    }
    if (!isMemoryJobType(jobType)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid jobType' });
    }

    const input = req.body?.input;
    const inputObject = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : undefined;

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const job = await queueMemoryJob({
        guildId,
        jobType,
        actorId,
        windowStartedAt: windowStartedAt || undefined,
        windowEndedAt: windowEndedAt || undefined,
        input: inputObject,
      });
      return res.status(202).json({ ok: true, job });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_JOB_QUEUE_FAILED', message });
    }
  });

  router.get('/agent/memory/jobs/stats', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;

    try {
      const runner = getMemoryJobRunnerStats();
      const queue = await getMemoryJobQueueStats(guildId);
      return res.json({
        ok: true,
        runner,
        queue,
        guildScope: guildId || 'all',
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_JOB_STATS_FAILED', message });
    }
  });

  router.get('/agent/memory/jobs/deadletters', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });

    try {
      const deadletters = await listMemoryJobDeadletters({ guildId, limit });
      return res.json({ ok: true, deadletters, guildScope: guildId || 'all' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_JOB_DEADLETTERS_FAILED', message });
    }
  });

  router.post('/agent/memory/jobs/deadletters/:deadletterId/requeue', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const deadletterId = toBoundedInt(req.params.deadletterId, -1, { min: -1 });
    if (deadletterId < 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid deadletterId' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const result = await requeueDeadletterJob({ deadletterId, actorId });
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'DEADLETTER_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_JOB_REQUEUE_FAILED', message });
    }
  });

  router.post('/agent/memory/jobs/:jobId/cancel', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const jobId = toStringParam(req.params.jobId);
    if (!jobId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'jobId is required' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const result = await cancelMemoryJob({ jobId, actorId });
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'JOB_NOT_CANCELABLE') {
        return res.status(409).json({ ok: false, error: 'CONFLICT', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_JOB_CANCEL_FAILED', message });
    }
  });

  router.get('/agent/memory/quality/metrics', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const metrics = await getMemoryQualityMetrics({ guildId, days });
      return res.json({ ok: true, ...metrics });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'MEMORY_QUALITY_METRICS_FAILED', message });
    }
  });

  router.get('/agent/memory/beta/go-no-go', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const report = await buildGoNoGoReport({ guildId, days });
      return res.json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'GO_NO_GO_REPORT_FAILED', message });
    }
  });

  router.get('/agent/finops/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const summary = await getFinopsSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'FINOPS_SUMMARY_FAILED', message });
    }
  });

  router.get('/agent/finops/showback', requireAdmin, async (req, res) => {
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const summary = await getFinopsSummary({ days });
      return res.json({
        ok: true,
        days,
        byGuild: summary.byGuild,
        generatedAt: summary.generatedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'FINOPS_SHOWBACK_FAILED', message });
    }
  });

  router.get('/agent/finops/budget', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const budget = await getFinopsBudgetStatus(guildId);
      return res.json({ ok: true, budget });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'FINOPS_BUDGET_FAILED', message });
    }
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

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
import { isOneOf, toBoundedInt, toStringParam } from '../utils/validation';
import {
  cancelAgentSession,
  getAgentSession,
  getAgentPolicy,
  listAgentDeadletters,
  getMultiAgentRuntimeSnapshot,
  listAgentSkills,
  listGuildAgentSessions,
  serializeAgentSessionForApi,
  startAgentSession,
} from '../services/multiAgentService';
import { getAgentPrivacyPolicySnapshot, upsertAgentPrivacyPolicy } from '../services/agentPrivacyPolicyService';
import {
  buildPrivacyTuningRecommendation,
  listPrivacyGateSamples,
  reviewPrivacyGateSample,
} from '../services/agentPrivacyTuningService';
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
  triggerGotCutoverAutopilotRun,
  triggerGuildOnboardingSession,
} from '../services/agentOpsService';
import { getAgentGotPolicySnapshot } from '../services/agentGotPolicyService';
import {
  getGotRunById,
  listGotNodes,
  listGotRuns,
  listGotSelectionEvents,
} from '../services/agentGotStore';
import { buildGotPerformanceDashboard } from '../services/agentGotAnalyticsService';
import { getAgentGotCutoverDecision } from '../services/agentGotCutoverService';
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
import { getObsidianLoreSyncLoopStats } from '../services/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../services/retrievalEvalLoopService';
import { getMemoryQualityMetrics } from '../services/memoryQualityMetricsService';
import {
  createRetrievalEvalSet,
  getRetrievalEvalRun,
  listRetrievalEvalCases,
  runRetrievalAutoTuning,
  runRetrievalEval,
  upsertRetrievalEvalCase,
} from '../services/retrievalEvalService';
import { buildGoNoGoReport } from '../services/goNoGoService';
import { buildAgentRuntimeReadinessReport } from '../services/agentRuntimeReadinessService';
import {
  evaluateGuildSloAndPersistAlerts,
  evaluateGuildSloReport,
  listGuildSloAlertEvents,
} from '../services/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../services/finopsService';
import { getLlmExperimentSummary } from '../services/llmExperimentAnalyticsService';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
  listSupabaseCronJobs,
} from '../services/supabaseExtensionOpsService';
import { getPlatformLightweightingReport } from '../services/platformLightweightingService';
import { getRuntimeSchedulerPolicySnapshot } from '../services/runtimeSchedulerPolicyService';
import { getEfficiencySnapshot, runEfficiencyQuickWins } from '../services/efficiencyOptimizationService';
import { isUserAdmin } from '../services/adminAllowlistService';
import {
  forgetGuildRagData,
  forgetUserRagData,
  previewForgetGuildRagData,
  previewForgetUserRagData,
} from '../services/privacyForgetService';
import { getWorkerApprovalStoreSnapshot } from '../services/workerGeneration/workerApprovalStore';
import { getWorkerProposalMetricsSnapshot } from '../services/workerGeneration/workerProposalMetrics';
import { getObsidianAdapterRuntimeStatus } from '../services/obsidian/router';
import { getLatestObsidianGraphAuditSnapshot } from '../services/obsidianQualityService';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { getAgentTelemetryQueueSnapshot } from '../services/agentTelemetryQueue';
import { buildTaskRoutingPolicyHints, getTaskRoutingSummary } from '../services/taskRoutingAnalyticsService';
import { recordTaskRoutingFeedbackMetric } from '../services/taskRoutingMetricsService';
import {
  getAgentAnswerQualityReviewSummary,
  listAgentAnswerQualityReviews,
  recordAgentAnswerQualityReview,
} from '../services/agentQualityReviewService';
import {
  buildToolLearningWeeklyReport,
  decideToolLearningCandidate,
  generateTaskRoutingLearningCandidates,
  listToolLearningCandidates,
  listToolLearningRules,
  recordToolLearningLog,
} from '../services/toolLearningService';
import { getOpencodeExecutionSummary } from '../services/opencodeOpsService';
import {
  createOpencodeChangeRequest,
  decideOpencodeChangeRequest,
  enqueueOpencodePublishJob,
  isOpencodeChangeRequestStatus,
  isOpencodePublishJobStatus,
  listOpencodeChangeRequests,
  listOpencodePublishJobs,
  type OpencodeRiskTier,
  summarizeOpencodeQueueReadiness,
} from '../services/opencodeGitHubQueueService';
import {
  getConversationThreadBySession,
  listConversationThreads,
  listConversationTurns,
} from '../services/conversationTurnService';

let lastBotStatusBenchmarkAt = 0;

export function createBotRouter(): Router {
  const router = Router();
  const adminActionRateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: 'bot-admin-action',
    store: 'supabase',
    onStoreError: 'reject',
  });
  const adminIdempotency = createIdempotencyGuard({ scope: 'bot-admin', ttlSec: 86_400, requireHeader: false });
  const opencodeIdempotency = createIdempotencyGuard({ scope: 'bot-opencode', ttlSec: 86_400, requireHeader: false });

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
    const includeShadowGraph = String(req.query?.includeShadowGraph || '').trim().toLowerCase() === 'true';
    const traceTailLimit = toBoundedInt(req.query?.traceTailLimit, 5, { min: 0, max: 20 });
    return res.json({
      runtime: getMultiAgentRuntimeSnapshot(),
      skills: listAgentSkills(),
      sessions: sessions.map((session) => serializeAgentSessionForApi(session, { includeShadowGraph, traceTailLimit })),
    });
  });

  router.get('/agent/conversations/threads', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const requestedBy = toStringParam(req.query?.requestedBy) || undefined;
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const items = await listConversationThreads({ guildId, requestedBy, limit });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'CONVERSATION_THREAD_LIST_FAILED', message });
    }
  });

  router.get('/agent/conversations/threads/:threadId/turns', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const threadId = toBoundedInt(req.params.threadId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 500 });
    if (!guildId || threadId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and threadId are required' });
    }

    try {
      const turns = await listConversationTurns({ guildId, threadId, limit });
      return res.json({ ok: true, threadId, turns, count: turns.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'CONVERSATION_TURN_LIST_FAILED', message });
    }
  });

  router.get('/agent/conversations/by-session/:sessionId', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const sessionId = toStringParam(req.params.sessionId);
    if (!guildId || !sessionId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and sessionId are required' });
    }

    try {
      const item = await getConversationThreadBySession({ guildId, sessionId });
      if (!item) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'conversation thread not found for session' });
      }
      return res.json({ ok: true, ...item, count: item.turns.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'CONVERSATION_BY_SESSION_FAILED', message });
    }
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

  router.get('/agent/runtime/telemetry-queue', requireAdmin, async (_req, res) => {
    return res.json({ ok: true, queue: getAgentTelemetryQueueSnapshot() });
  });

  router.get('/agent/runtime/unattended-health', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    try {
      const telemetry = getAgentTelemetryQueueSnapshot();
      const readiness = guildId
        ? await summarizeOpencodeQueueReadiness({ guildId })
        : null;
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        telemetry,
        opencodeReadiness: readiness,
        notes: {
          guildScoped: Boolean(guildId),
          publishLock: {
            enabled: String(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED || 'true').trim(),
            failOpen: String(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN || 'false').trim(),
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'UNATTENDED_HEALTH_FAILED', message });
    }
  });

  router.get('/agent/runtime/supabase/extensions', requireAdmin, async (req, res) => {
    const includeTopQueries = String(req.query?.includeTopQueries || 'true').trim().toLowerCase() !== 'false';
    const topLimit = toBoundedInt(req.query?.topLimit, 10, { min: 1, max: 50 });
    try {
      const snapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries, topLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'SUPABASE_EXTENSION_RUNTIME_FAILED', message });
    }
  });

  router.get('/agent/runtime/supabase/cron-jobs', requireAdmin, async (_req, res) => {
    try {
      const jobs = await listSupabaseCronJobs();
      return res.json({ ok: true, jobs, count: jobs.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'SUPABASE_CRON_JOBS_LIST_FAILED', message });
    }
  });

  router.post('/agent/runtime/supabase/cron-jobs/ensure-maintenance', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });
    try {
      const installed = await ensureSupabaseMaintenanceCronJobs({ llmRetentionDays });
      return res.status(202).json({ ok: true, llmRetentionDays, installed, count: installed.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'SUPABASE_CRON_ENSURE_FAILED', message });
    }
  });

  router.get('/agent/runtime/supabase/hypopg/candidates', requireAdmin, async (_req, res) => {
    try {
      const candidates = await getHypoPgCandidates();
      return res.json({ ok: true, candidates, count: candidates.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'HYPOPG_CANDIDATES_FAILED', message });
    }
  });

  router.post('/agent/runtime/supabase/hypopg/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const ddls = Array.isArray(req.body?.ddls)
      ? req.body.ddls.map((item: unknown) => toStringParam(item)).filter(Boolean)
      : [];
    if (ddls.length === 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'ddls array is required' });
    }

    try {
      const evaluations = await evaluateHypoPgIndexes(ddls);
      return res.status(202).json({ ok: true, evaluations, count: evaluations.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'HYPOPG_EVALUATION_FAILED', message });
    }
  });

  router.get('/agent/runtime/lightweighting-plan', requireAdmin, async (_req, res) => {
    try {
      const report = await getPlatformLightweightingReport();
      return res.json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'LIGHTWEIGHTING_PLAN_FAILED', message });
    }
  });

  router.get('/agent/runtime/scheduler-policy', requireAdmin, async (_req, res) => {
    try {
      const snapshot = await getRuntimeSchedulerPolicySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'SCHEDULER_POLICY_FAILED', message });
    }
  });

  router.get('/agent/runtime/efficiency', requireAdmin, async (_req, res) => {
    try {
      const snapshot = await getEfficiencySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'EFFICIENCY_SNAPSHOT_FAILED', message });
    }
  });

  router.post('/agent/runtime/efficiency/quick-wins', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const dryRun = String(req.body?.dryRun ?? 'true').trim().toLowerCase() !== 'false';
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });
    const evaluateHypopgTop = toBoundedInt(req.body?.evaluateHypopgTop, 2, { min: 1, max: 10 });

    try {
      const result = await runEfficiencyQuickWins({
        dryRun,
        llmRetentionDays,
        evaluateHypopgTop,
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'EFFICIENCY_QUICK_WINS_FAILED', message });
    }
  });

  router.get('/agent/got/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    return res.json({ ok: true, guildId: guildId || '*', policy: getAgentGotPolicySnapshot(guildId) });
  });

  router.get('/agent/got/runs', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const runs = await listGotRuns({ guildId, limit });
      return res.json({ ok: true, runs, count: runs.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_RUN_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const run = await getGotRunById({ guildId, runId });
      return res.json({ ok: true, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'AGENT_GOT_RUN_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_RUN_READ_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId/nodes', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 500 });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const nodes = await listGotNodes({ guildId, runId, limit });
      return res.json({ ok: true, nodes, count: nodes.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_NODE_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId/selection-events', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 500 });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const events = await listGotSelectionEvents({ guildId, runId, limit });
      return res.json({ ok: true, events, count: events.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_SELECTION_EVENT_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/dashboard/performance', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const dashboard = await buildGotPerformanceDashboard({ guildId, days });
      return res.json({ ok: true, dashboard });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_DASHBOARD_FAILED', message });
    }
  });

  router.get('/agent/got/cutover-decision', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const sessionId = toStringParam(req.query?.sessionId) || undefined;
    const forceRefresh = String(req.query?.forceRefresh || '').trim().toLowerCase() === 'true';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const decision = await getAgentGotCutoverDecision({ guildId, sessionId, forceRefresh });
      return res.json({ ok: true, decision });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_CUTOVER_DECISION_FAILED', message });
    }
  });

  router.post('/agent/quality/reviews', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const reviewerId = toStringParam(req.body?.reviewerId);
    const strategyRaw = String(req.body?.strategy || '').trim().toLowerCase();
    const strategy = strategyRaw === 'got' || strategyRaw === 'tot' ? strategyRaw : 'baseline';
    const isHallucination = req.body?.isHallucination === true;
    if (!guildId || !reviewerId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and reviewerId are required' });
    }

    try {
      await recordAgentAnswerQualityReview({
        guildId,
        reviewerId,
        strategy,
        isHallucination,
        sessionId: toStringParam(req.body?.sessionId) || undefined,
        question: toStringParam(req.body?.question) || undefined,
        answerExcerpt: toStringParam(req.body?.answerExcerpt) || undefined,
        labelConfidence: Number(req.body?.labelConfidence),
        reviewNote: toStringParam(req.body?.reviewNote) || undefined,
      });
      return res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_INSERT_FAILED', message });
    }
  });

  router.get('/agent/quality/reviews', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const rows = await listAgentAnswerQualityReviews({ guildId, days, limit });
      return res.json({ ok: true, rows, count: rows.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_LIST_FAILED', message });
    }
  });

  router.get('/agent/quality/reviews/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const summary = await getAgentAnswerQualityReviewSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_QUALITY_REVIEW_SUMMARY_FAILED', message });
    }
  });

  router.get('/agent/privacy/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || '*';
    const policy = getAgentPrivacyPolicySnapshot(guildId);
    return res.json({ guildId, policy });
  });

  router.put('/agent/privacy/policy', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId) || '*';
    const modeDefault = toStringParam(req.body?.modeDefault) as 'direct' | 'plan_act' | 'deliberate' | 'guarded';
    const reviewScore = toBoundedInt(req.body?.reviewScore, 60, { min: 0, max: 100 });
    const blockScore = toBoundedInt(req.body?.blockScore, 80, { min: 0, max: 100 });
    const reviewPatterns = Array.isArray(req.body?.reviewPatterns) ? req.body.reviewPatterns : [];
    const blockPatterns = Array.isArray(req.body?.blockPatterns) ? req.body.blockPatterns : [];

    if (!isOneOf(modeDefault, ['direct', 'plan_act', 'deliberate', 'guarded'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'modeDefault invalid' });
    }
    if (blockScore <= reviewScore) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'blockScore must be greater than reviewScore' });
    }

    try {
      const updatedBy = toStringParam(req.user?.id) || 'api';
      const row = await upsertAgentPrivacyPolicy({
        guildId,
        modeDefault,
        reviewScore,
        blockScore,
        reviewPatterns,
        blockPatterns,
        enabled: req.body?.enabled !== false,
        updatedBy,
      });
      return res.json({ ok: true, policy: row });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_POLICY_UPSERT_FAILED', message });
    }
  });

  router.get('/agent/privacy/tuning/samples', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    const status = toStringParam(req.query?.status) as 'reviewed' | 'unreviewed' | '';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (status && !isOneOf(status, ['reviewed', 'unreviewed'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'status must be reviewed|unreviewed' });
    }

    try {
      const items = await listPrivacyGateSamples({ guildId, limit, status: status || undefined });
      return res.json({ ok: true, items });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_SAMPLES_FAILED', message });
    }
  });

  router.post('/agent/privacy/tuning/samples/:sampleId/review', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const sampleId = toBoundedInt(req.params.sampleId, 0, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const expectedDecision = toStringParam(req.body?.expectedDecision) as 'allow' | 'review' | 'block';
    if (!isOneOf(expectedDecision, ['allow', 'review', 'block'])) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'expectedDecision must be allow|review|block' });
    }

    try {
      const reviewedBy = toStringParam(req.user?.id) || 'api';
      const row = await reviewPrivacyGateSample({
        sampleId,
        expectedDecision,
        reviewedBy,
        note: toStringParam(req.body?.note) || undefined,
      });
      return res.json({ ok: true, sample: row });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_REVIEW_FAILED', message });
    }
  });

  router.get('/agent/privacy/tuning/recommendation', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const lookbackDays = toBoundedInt(req.query?.lookbackDays, 7, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const recommendation = await buildPrivacyTuningRecommendation({ guildId, lookbackDays });
      return res.json({ ok: true, recommendation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'PRIVACY_TUNING_RECOMMENDATION_FAILED', message });
    }
  });

  router.get('/agent/obsidian/runtime', requireAdmin, async (_req, res) => {
    return res.json({
      vaultPathConfigured: Boolean(getObsidianVaultRoot()),
      adapterRuntime: getObsidianAdapterRuntimeStatus(),
    });
  });

  router.get('/agent/obsidian/quality', requireAdmin, async (_req, res) => {
    const snapshot = await getLatestObsidianGraphAuditSnapshot();
    return res.json({
      vaultPathConfigured: Boolean(getObsidianVaultRoot()),
      snapshot,
    });
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

  router.post('/agent/opencode/bootstrap-policy', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const runMode = toStringParam(req.body?.runMode) || 'approval_required';
    const enabledRaw = req.body?.enabled;
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : String(enabledRaw || '').trim() !== 'false';

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!isActionRunMode(runMode)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'runMode must be auto|approval_required|disabled' });
    }
    if (!listActions().some((action) => action.name === 'opencode.execute')) {
      return res.status(500).json({ ok: false, error: 'CONFIG', message: 'opencode.execute action is not registered' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName: 'opencode.execute',
        enabled,
        runMode,
        actorId,
      });
      return res.status(202).json({ ok: true, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'OPENCODE_POLICY_BOOTSTRAP_FAILED', message });
    }
  });

  router.get('/agent/self-growth/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    const policies = await listGuildActionPolicies(guildId);
    const opencodePolicy = policies.find((item) => item.actionName === 'opencode.execute') || null;
    const effectiveRunMode = opencodePolicy?.runMode || 'approval_required';
    const profile = effectiveRunMode === 'auto'
      ? 'conditional_auto'
      : effectiveRunMode === 'disabled'
        ? 'disabled'
        : 'human_gate';

    return res.json({
      ok: true,
      guildId,
      profile,
      effective: {
        actionName: 'opencode.execute',
        runMode: effectiveRunMode,
        enabled: opencodePolicy?.enabled ?? true,
      },
      note: 'self-growth profile currently controls opencode.execute governance mode',
    });
  });

  router.post('/agent/self-growth/policy/apply', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const profile = toStringParam(req.body?.profile || req.query?.profile).toLowerCase();
    if (!guildId || !isOneOf(profile, ['human_gate', 'conditional_auto', 'disabled'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and profile(human_gate|conditional_auto|disabled) are required' });
    }

    const runMode = profile === 'conditional_auto'
      ? 'auto'
      : profile === 'disabled'
        ? 'disabled'
        : 'approval_required';

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const policy = await upsertGuildActionPolicy({
        guildId,
        actionName: 'opencode.execute',
        enabled: profile !== 'disabled',
        runMode,
        actorId,
      });
      return res.status(202).json({ ok: true, guildId, profile, policy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'SELF_GROWTH_POLICY_APPLY_FAILED', message });
    }
  });

  router.get('/agent/opencode/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 7, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const summary = await getOpencodeExecutionSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_SUMMARY_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const title = toStringParam(req.body?.title);
    const riskTierRaw = toStringParam(req.body?.riskTier).toLowerCase();
    if (!guildId || !title) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and title are required' });
    }
    if (riskTierRaw && !isOneOf(riskTierRaw, ['low', 'medium', 'high', 'critical'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'riskTier must be low|medium|high|critical' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const created = await createOpencodeChangeRequest({
        guildId,
        requestedBy,
        title,
        summary: toStringParam(req.body?.summary) || undefined,
        targetBaseBranch: toStringParam(req.body?.targetBaseBranch) || undefined,
        proposedBranch: toStringParam(req.body?.proposedBranch) || undefined,
        sourceActionLogId: Number(req.body?.sourceActionLogId),
        riskTier: (riskTierRaw || undefined) as OpencodeRiskTier | undefined,
        scoreCard: req.body?.scoreCard && typeof req.body.scoreCard === 'object' && !Array.isArray(req.body.scoreCard)
          ? req.body.scoreCard as Record<string, unknown>
          : undefined,
        evidenceBundleId: toStringParam(req.body?.evidenceBundleId) || undefined,
        files: Array.isArray(req.body?.files)
          ? req.body.files.map((item: unknown) => toStringParam(item)).filter(Boolean)
          : undefined,
        diffPatch: toStringParam(req.body?.diffPatch) || undefined,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata as Record<string, unknown>
          : undefined,
      });
      return res.status(201).json({ ok: true, item: created });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid payload' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_CREATE_FAILED', message });
    }
  });

  router.get('/agent/opencode/change-requests', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusRaw = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (statusRaw && !isOpencodeChangeRequestStatus(statusRaw)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid status' });
    }

    try {
      const items = await listOpencodeChangeRequests({
        guildId,
        status: statusRaw ? (statusRaw as 'draft' | 'review_pending' | 'approved' | 'rejected' | 'queued_for_publish' | 'published' | 'failed') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_LIST_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests/:changeRequestId/decision', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const changeRequestId = toBoundedInt(req.params.changeRequestId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const decision = toStringParam(req.body?.decision).toLowerCase();

    if (!guildId || changeRequestId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and changeRequestId are required' });
    }
    if (!isOneOf(decision, ['approve', 'reject', 'published', 'failed'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'decision must be approve|reject|published|failed' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const updated = await decideOpencodeChangeRequest({
        guildId,
        changeRequestId,
        decision: decision as 'approve' | 'reject' | 'published' | 'failed',
        actorId,
        note: toStringParam(req.body?.note) || undefined,
        publishUrl: toStringParam(req.body?.publishUrl) || undefined,
      });
      return res.json({ ok: true, item: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_CHANGE_REQUEST_DECIDE_FAILED', message });
    }
  });

  router.post('/agent/opencode/change-requests/:changeRequestId/queue-publish', requireAdmin, adminActionRateLimiter, opencodeIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const changeRequestId = toBoundedInt(req.params.changeRequestId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (!guildId || changeRequestId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and changeRequestId are required' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const payload = req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload)
        ? req.body.payload as Record<string, unknown>
        : undefined;
      const job = await enqueueOpencodePublishJob({
        guildId,
        changeRequestId,
        requestedBy,
        provider: toStringParam(req.body?.provider) || undefined,
        payload,
      });
      const deduplicated = Boolean((job as Record<string, unknown>).deduplicated);
      return res.status(202).json({ ok: true, job, deduplicated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'OPENCODE_CHANGE_REQUEST_NOT_APPROVED') {
        return res.status(409).json({ ok: false, error: 'CONFLICT', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_PUBLISH_QUEUE_ENQUEUE_FAILED', message });
    }
  });

  router.get('/agent/opencode/publish-queue', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const statusRaw = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (statusRaw && !isOpencodePublishJobStatus(statusRaw)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid status' });
    }

    try {
      const items = await listOpencodePublishJobs({
        guildId,
        status: statusRaw ? (statusRaw as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_PUBLISH_QUEUE_LIST_FAILED', message });
    }
  });

  router.get('/agent/opencode/readiness', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const readiness = await summarizeOpencodeQueueReadiness({ guildId });
      return res.json({ ok: true, readiness });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'OPENCODE_READINESS_FAILED', message });
    }
  });

  router.post('/agent/onboarding/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

  router.post('/agent/learning/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const result = triggerDailyLearningRun(client, guildId || undefined);
    return res.status(result.ok ? 202 : 409).json(result);
  });

  router.post('/agent/got/cutover/autopilot/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const result = await triggerGotCutoverAutopilotRun(client, guildId || undefined);
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

    const includeShadowGraph = String(req.query?.includeShadowGraph || '').trim().toLowerCase() === 'true';
    const traceTailLimit = toBoundedInt(req.query?.traceTailLimit, 5, { min: 0, max: 20 });

    return res.json({ session: serializeAgentSessionForApi(session, { includeShadowGraph, traceTailLimit }) });
  });

  router.post('/agent/sessions', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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
        isAdmin: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(409).json({ ok: false, message });
    }

    return res.status(202).json({ ok: true, session: serializeAgentSessionForApi(session) });
  });

  router.post('/agent/sessions/:sessionId/cancel', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

  router.get('/agent/runtime/loops', requireAdmin, async (_req, res) => {
    return res.json({
      ok: true,
      memoryJobRunner: getMemoryJobRunnerStats(),
      obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
      retrievalEvalLoop: getRetrievalEvalLoopStats(),
      generatedAt: new Date().toISOString(),
    });
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

  router.post('/agent/memory/retrieval-eval/sets', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const name = toStringParam(req.body?.name);
    const description = toStringParam(req.body?.description);
    if (!guildId || !name) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and name are required' });
    }

    try {
      const createdBy = toStringParam(req.user?.id) || 'api';
      const evalSet = await createRetrievalEvalSet({ guildId, name, description, createdBy });
      return res.status(201).json({ ok: true, evalSet });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid payload' });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_EVAL_SET_CREATE_FAILED', message });
    }
  });

  router.post('/agent/memory/retrieval-eval/cases', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const evalSetId = toBoundedInt(req.body?.evalSetId, -1, { min: -1 });
    const query = toStringParam(req.body?.query);
    const intent = toStringParam(req.body?.intent);
    const difficulty = toStringParam(req.body?.difficulty);
    const enabled = req.body?.enabled !== false;
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];

    if (!guildId || evalSetId < 0 || !query) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId, evalSetId, query are required' });
    }

    try {
      const evalCase = await upsertRetrievalEvalCase({
        guildId,
        evalSetId,
        query,
        intent,
        difficulty,
        enabled,
        targets: targets.map((target: Record<string, unknown>) => ({
          filePath: toStringParam(target?.filePath),
          gain: Number(target?.gain || 1),
        })),
      });
      return res.status(201).json({ ok: true, evalCase });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid payload' });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_EVAL_CASE_UPSERT_FAILED', message });
    }
  });

  router.get('/agent/memory/retrieval-eval/cases', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const evalSetId = toBoundedInt(req.query?.evalSetId, -1, { min: -1 });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 1000 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const cases = await listRetrievalEvalCases({
        guildId,
        evalSetId: evalSetId >= 0 ? evalSetId : undefined,
        limit,
      });
      return res.json({ ok: true, cases, count: cases.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_EVAL_CASE_LIST_FAILED', message });
    }
  });

  router.post('/agent/memory/retrieval-eval/runs', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const evalSetId = toBoundedInt(req.body?.evalSetId, -1, { min: -1 });
    const topK = toBoundedInt(req.body?.topK, 5, { min: 1, max: 20 });
    const variants = Array.isArray(req.body?.variants)
      ? req.body.variants.map((v: unknown) => toStringParam(v)).filter(Boolean)
      : undefined;

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const result = await runRetrievalEval({
        guildId,
        evalSetId: evalSetId >= 0 ? evalSetId : undefined,
        requestedBy,
        topK,
        variants,
      });
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      if (message === 'OBSIDIAN_VAULT_PATH_MISSING') {
        return res.status(400).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_EVAL_RUN_FAILED', message });
    }
  });

  router.get('/agent/memory/retrieval-eval/runs/:runId', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: -1 });
    if (!guildId || runId < 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const run = await getRetrievalEvalRun({ runId, guildId });
      return res.json({ ok: true, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'RETRIEVAL_EVAL_RUN_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_EVAL_RUN_READ_FAILED', message });
    }
  });

  router.post('/agent/memory/retrieval-eval/runs/:runId/tune', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: -1 });
    const applyIfBetter = Boolean(req.body?.applyIfBetter);
    if (!guildId || runId < 0) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const requestedBy = toStringParam(req.user?.id) || 'api';
      const result = await runRetrievalAutoTuning({
        guildId,
        runId,
        requestedBy,
        applyIfBetter,
      });
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'RETRIEVAL_AUTO_TUNING_FAILED', message });
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

  router.get('/agent/runtime/readiness', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const windowDays = toBoundedInt(req.query?.windowDays, 30, { min: 1, max: 180 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await buildAgentRuntimeReadinessReport({ guildId, windowDays });
      return res.json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_READINESS_REPORT_FAILED', message });
    }
  });

  router.get('/agent/runtime/slo/report', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await evaluateGuildSloReport({ guildId });
      return res.json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_SLO_REPORT_FAILED', message });
    }
  });

  router.get('/agent/runtime/slo/alerts', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 100, { min: 1, max: 500 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const alerts = await listGuildSloAlertEvents({ guildId, limit });
      return res.json({ ok: true, guildId, alerts, count: alerts.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_SLO_ALERT_LIST_FAILED', message });
    }
  });

  router.post('/agent/runtime/slo/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const force = String(req.body?.force || req.query?.force || '').trim().toLowerCase() === 'true';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const actorId = toStringParam(req.user?.id) || 'api';
      const report = await evaluateGuildSloAndPersistAlerts({ guildId, actorId, force });
      return res.status(202).json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_SLO_EVALUATION_FAILED', message });
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

  router.get('/agent/llm/experiments/summary', requireAdmin, async (req, res) => {
    const experimentName = toStringParam(req.query?.experimentName || req.query?.name || process.env.LLM_EXPERIMENT_NAME || 'hf_ab_v1');
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 180 });
    if (!experimentName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'experimentName is required' });
    }

    try {
      const summary = await getLlmExperimentSummary({ experimentName, guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'LLM_EXPERIMENT_SUMMARY_FAILED', message });
    }
  });

  router.get('/agent/task-routing/summary', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 7, { min: 1, max: 90 });

    try {
      const summary = await getTaskRoutingSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TASK_ROUTING_SUMMARY_FAILED', message });
    }
  });

  router.post('/agent/task-routing/feedback', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const route = toStringParam(req.body?.route).toLowerCase();
    const channel = toStringParam(req.body?.channel).toLowerCase();
    const outcomeScore = Number(req.body?.outcomeScore);
    const reason = toStringParam(req.body?.reason || '');
    const relatedGoal = toStringParam(req.body?.relatedGoal || '');

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!isOneOf(route, ['knowledge', 'execution', 'mixed', 'casual'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'route must be one of knowledge|execution|mixed|casual' });
    }
    if (!isOneOf(channel, ['docs', 'vibe'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'channel must be one of docs|vibe' });
    }
    if (!Number.isFinite(outcomeScore) || outcomeScore < 0 || outcomeScore > 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'outcomeScore must be in [0,1]' });
    }

    await recordTaskRoutingFeedbackMetric({
      guildId,
      requestedBy: toStringParam(req.user?.id) || 'api',
      route,
      channel,
      outcomeScore,
      reason,
      relatedGoal,
    });

    void recordToolLearningLog({
      guildId,
      requestedBy: toStringParam(req.user?.id) || 'api',
      scope: 'task_routing',
      toolName: `task_routing_${channel}`,
      inputText: relatedGoal,
      outputSummary: `route=${route} channel=${channel}`,
      outcomeScore,
      reason,
      metadata: {
        route,
        channel,
      },
    });

    return res.status(202).json({ ok: true });
  });

  router.get('/agent/task-routing/policy-hints', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });

    try {
      const summary = await getTaskRoutingSummary({ guildId, days });
      const hints = buildTaskRoutingPolicyHints(summary);
      return res.json({ ok: true, hints });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TASK_ROUTING_POLICY_HINTS_FAILED', message });
    }
  });

  router.post('/agent/learning/task-routing/candidates/generate', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const days = toBoundedInt(req.body?.days, 14, { min: 1, max: 90 });
    const minSamples = toBoundedInt(req.body?.minSamples, 4, { min: 2, max: 100 });
    const minOutcomeScoreRaw = Number(req.body?.minOutcomeScore);
    const minOutcomeScore = Number.isFinite(minOutcomeScoreRaw)
      ? Math.max(0, Math.min(1, minOutcomeScoreRaw))
      : 0.65;

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const result = await generateTaskRoutingLearningCandidates({
        guildId,
        days,
        minSamples,
        minOutcomeScore,
        actorId: toStringParam(req.user?.id) || 'api',
      });
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TOOL_LEARNING_CANDIDATE_GENERATE_FAILED', message });
    }
  });

  router.get('/agent/learning/task-routing/candidates', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const status = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (status && !isOneOf(status, ['pending', 'approved', 'rejected', 'applied'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'status must be one of pending|approved|rejected|applied' });
    }

    try {
      const items = await listToolLearningCandidates({
        guildId,
        status: status ? (status as 'pending' | 'approved' | 'rejected' | 'applied') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TOOL_LEARNING_CANDIDATE_LIST_FAILED', message });
    }
  });

  router.post('/agent/learning/task-routing/candidates/:candidateId/decision', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    const candidateId = toBoundedInt(req.params.candidateId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const decision = toStringParam(req.body?.decision).toLowerCase();
    const applyNow = req.body?.applyNow === true;

    if (!guildId || candidateId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and candidateId are required' });
    }
    if (!isOneOf(decision, ['approved', 'rejected', 'applied'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'decision must be one of approved|rejected|applied' });
    }

    try {
      const result = await decideToolLearningCandidate({
        guildId,
        candidateId,
        decision: decision as 'approved' | 'rejected' | 'applied',
        actorId: toStringParam(req.user?.id) || 'api',
        applyNow,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'invalid parameters' });
      }
      if (message === 'TOOL_LEARNING_CANDIDATE_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: message, message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TOOL_LEARNING_CANDIDATE_DECISION_FAILED', message });
    }
  });

  router.get('/agent/learning/task-routing/rules', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const status = toStringParam(req.query?.status).toLowerCase();
    const limit = toBoundedInt(req.query?.limit, 50, { min: 1, max: 200 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (status && !isOneOf(status, ['active', 'inactive'] as const)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'status must be one of active|inactive' });
    }

    try {
      const items = await listToolLearningRules({
        guildId,
        status: status ? (status as 'active' | 'inactive') : undefined,
        limit,
      });
      return res.json({ ok: true, items, count: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TOOL_LEARNING_RULE_LIST_FAILED', message });
    }
  });

  router.get('/agent/learning/task-routing/weekly-report', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 7, { min: 1, max: 90 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await buildToolLearningWeeklyReport({ guildId, days });
      return res.json({ ok: true, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is invalid' });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'TOOL_LEARNING_WEEKLY_REPORT_FAILED', message });
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

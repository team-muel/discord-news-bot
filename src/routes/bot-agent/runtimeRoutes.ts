import { requireAdmin } from '../../middleware/auth';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
  listSupabaseCronJobs,
} from '../../services/infra/supabaseExtensionOpsService';
import { getPlatformLightweightingReport } from '../../services/runtime/platformLightweightingService';
import { getAgentRoleWorkersHealthSnapshot, listAgentRoleWorkerSpecs, probeHttpWorkerHealth } from '../../services/agent/agentRoleWorkerService';
import { getRuntimeSchedulerPolicySnapshot } from '../../services/runtime/runtimeSchedulerPolicyService';
import { getEfficiencySnapshot, runEfficiencyQuickWins } from '../../services/runtime/efficiencyOptimizationService';
import { getAgentTelemetryQueueSnapshot } from '../../services/agent/agentTelemetryQueue';
import { summarizeOpencodeQueueReadiness } from '../../services/opencode/opencodeGitHubQueueService';
import { getMemoryJobRunnerStats, getMemoryQueueHealthSnapshot } from '../../services/memory/memoryJobRunner';
import { getObsidianInboxChatLoopStats } from '../../services/obsidian/obsidianInboxChatLoopService';
import { getObsidianLoreSyncLoopStats } from '../../services/obsidian/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../../services/eval/retrievalEvalLoopService';
import { buildAgentRuntimeReadinessReport } from '../../services/agent/agentRuntimeReadinessService';
import { evaluateGuildSloAndPersistAlerts, evaluateGuildSloReport, listGuildSloAlertEvents } from '../../services/agent/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../../services/finopsService';
import { getLlmExperimentSummary } from '../../services/llmExperimentAnalyticsService';
import { getLlmRuntimeSnapshot } from '../../services/llmClient';
import { buildSocialQualityOperationalSnapshot } from '../../services/agent/agentSocialQualitySnapshotService';
import { buildWorkerApprovalGateSnapshot } from '../../services/agent/agentWorkerApprovalGateSnapshotService';
import { buildGoNoGoReport } from '../../services/goNoGoService';
import { buildToolLearningWeeklyReport } from '../../services/toolLearningService';
import { getObsidianKnowledgeCompilationStats } from '../../services/obsidian/knowledgeCompilerService';
import { getLatestObsidianGraphAuditSnapshot } from '../../services/obsidian/obsidianQualityService';
import { getObsidianRetrievalBoundarySnapshot } from '../../services/obsidian/obsidianRagService';
import { getObsidianAdapterRuntimeStatus, getObsidianVaultLiveHealthStatus } from '../../services/obsidian/router';
import { toBoundedInt, toStringParam } from '../../utils/validation';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import {
  computeSystemGradient,
  computeConvergenceReport,
  getCrossLoopOriginsSnapshot,
  evaluateCrossLoopOutcomes,
} from '../../services/sprint/selfImprovementLoop';
import { syncHighRiskActionsToSandboxPolicy } from '../../services/skills/actionRunner';
import { getSupabaseClient, isSupabaseConfigured } from '../../services/supabaseClient';

import { BotAgentRouteDeps } from './types';
import {
  MCP_IMPLEMENT_WORKER_URL,
  OPENJARVIS_REQUIRE_OPENCODE_WORKER,
  MCP_OPENCODE_WORKER_URL,
  UNATTENDED_WORKER_HEALTH_TIMEOUT_MS,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN,
  LLM_EXPERIMENT_NAME,
} from '../../config';

const EXECUTOR_ACTION_CANONICAL_NAME = 'implement.execute';
const EXECUTOR_ACTION_LEGACY_NAME = 'opencode.execute';
const EXECUTOR_WORKER_ENV_CANONICAL_KEY = 'MCP_IMPLEMENT_WORKER_URL';
const EXECUTOR_WORKER_ENV_LEGACY_KEY = 'MCP_OPENCODE_WORKER_URL';

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const probeOpencodeWorkerHealth = async () => {
  const required = OPENJARVIS_REQUIRE_OPENCODE_WORKER;
  const workerUrl = MCP_IMPLEMENT_WORKER_URL || MCP_OPENCODE_WORKER_URL;
  const timeoutMs = UNATTENDED_WORKER_HEALTH_TIMEOUT_MS;
  if (!required && !workerUrl) {
    return {
      required: false,
      configured: false,
      reachable: null,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_not_required',
      label: 'implement',
      contract: {
        canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
        persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
        legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
        canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
        legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
      },
    };
  }

  if (!workerUrl) {
    return {
      required,
      configured: false,
      reachable: false,
      latencyMs: null,
      status: null,
      endpoint: null,
      checkedAt: new Date().toISOString(),
      reason: 'worker_url_missing',
      label: 'implement',
      contract: {
        canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
        persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
        legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
        canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
        legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
      },
    };
  }

  const health = await probeHttpWorkerHealth(workerUrl, timeoutMs);

  return {
    required,
    configured: true,
    reachable: health.ok,
    latencyMs: health.latencyMs,
    status: health.status,
    endpoint: health.endpoint,
    checkedAt: new Date().toISOString(),
    reason: health.ok ? undefined : health.error || 'probe_failed',
    label: 'implement',
    contract: {
      canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
      persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
      legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
      canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
      legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
    },
  };
};

export function registerBotAgentRuntimeRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
  router.get('/agent/runtime/worker-approval-gates', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const recentLimit = toBoundedInt(req.query?.recentLimit, 5, { min: 1, max: 20 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildWorkerApprovalGateSnapshot({ guildId, recentLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/social-quality-snapshot', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildSocialQualityOperationalSnapshot({ guildId, days });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/telemetry-queue', requireAdmin, async (_req, res, next) => {
    return res.json({ ok: true, queue: getAgentTelemetryQueueSnapshot() });
  });

  router.get('/agent/runtime/role-workers', requireAdmin, async (_req, res, next) => {
    try {
      const specs = listAgentRoleWorkerSpecs();
      const health = await getAgentRoleWorkersHealthSnapshot();
      return res.json({ ok: true, workers: specs, health });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/unattended-health', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const actionName = toStringParam(req.query?.actionName) || undefined;
    try {
      const telemetry = getAgentTelemetryQueueSnapshot();
      const readiness = guildId
        ? await summarizeOpencodeQueueReadiness({ guildId })
        : null;
      const workerHealth = await probeOpencodeWorkerHealth();
      const advisoryWorkersHealth = await getAgentRoleWorkersHealthSnapshot();
      const llmRuntime = await getLlmRuntimeSnapshot({ guildId: guildId || undefined, actionName });
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        telemetry,
        executorReadiness: readiness,
        opencodeReadiness: readiness,
        workerHealth,
        advisoryWorkersHealth,
        llmRuntime,
        notes: {
          guildScoped: Boolean(guildId),
          actionName: actionName || null,
          executorContract: {
            canonicalActionName: EXECUTOR_ACTION_CANONICAL_NAME,
            persistedActionName: EXECUTOR_ACTION_LEGACY_NAME,
            legacyActionName: EXECUTOR_ACTION_LEGACY_NAME,
            canonicalWorkerEnvKey: EXECUTOR_WORKER_ENV_CANONICAL_KEY,
            legacyWorkerEnvKey: EXECUTOR_WORKER_ENV_LEGACY_KEY,
          },
          publishLock: {
            enabled: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED),
            failOpen: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/extensions', requireAdmin, async (req, res, next) => {
    const includeTopQueries = String(req.query?.includeTopQueries || 'true').trim().toLowerCase() !== 'false';
    const topLimit = toBoundedInt(req.query?.topLimit, 10, { min: 1, max: 50 });
    try {
      const snapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries, topLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/cron-jobs', requireAdmin, async (_req, res, next) => {
    try {
      const jobs = await listSupabaseCronJobs();
      return res.json({ ok: true, jobs, count: jobs.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/cron-jobs/ensure-maintenance', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });
    try {
      const installed = await ensureSupabaseMaintenanceCronJobs({ llmRetentionDays });
      return res.status(202).json({ ok: true, llmRetentionDays, installed, count: installed.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/hypopg/candidates', requireAdmin, async (_req, res, next) => {
    try {
      const candidates = await getHypoPgCandidates();
      return res.json({ ok: true, candidates, count: candidates.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/hypopg/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/runtime/lightweighting-plan', requireAdmin, async (_req, res, next) => {
    try {
      const report = await getPlatformLightweightingReport();
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/scheduler-policy', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getRuntimeSchedulerPolicySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/efficiency', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getEfficiencySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/efficiency/quick-wins', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/runtime/loops', requireAdmin, async (_req, res, next) => {
    return res.json({
      ok: true,
      memoryJobRunner: getMemoryJobRunnerStats(),
      obsidianInboxChatLoop: getObsidianInboxChatLoopStats(),
      obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
      retrievalEvalLoop: getRetrievalEvalLoopStats(),
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/agent/runtime/knowledge-control-plane', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const [goNoGo, queueHealth, learning, vaultHealth, graphAudit, retrievalBoundary] = await Promise.all([
        buildGoNoGoReport({ guildId, days }),
        getMemoryQueueHealthSnapshot(guildId),
        buildToolLearningWeeklyReport({ guildId, days }),
        getObsidianVaultLiveHealthStatus(),
        getLatestObsidianGraphAuditSnapshot(),
        getObsidianRetrievalBoundarySnapshot(),
      ]);

      return res.json({
        ok: true,
        snapshot: {
          guildId,
          windowDays: days,
          generatedAt: new Date().toISOString(),
          releaseGate: {
            decision: goNoGo.decision,
            failedChecks: goNoGo.failedChecks,
            checks: goNoGo.checks,
          },
          memory: {
            scope: goNoGo.scope,
            quality: goNoGo.metrics,
            queue: goNoGo.queue,
            queueHealth,
          },
          learning,
          obsidian: {
            vaultPathConfigured: Boolean(getObsidianVaultRoot()),
            adapterRuntime: getObsidianAdapterRuntimeStatus(),
            vaultHealth,
            cacheStats: retrievalBoundary.supabaseBacked.cacheStats,
            compiler: getObsidianKnowledgeCompilationStats(),
            graphAudit,
            retrievalBoundary,
          },
          loops: {
            memoryJobRunner: getMemoryJobRunnerStats(),
            obsidianInboxChatLoop: getObsidianInboxChatLoopStats(),
            obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
            retrievalEvalLoop: getRetrievalEvalLoopStats(),
          },
          telemetryQueue: goNoGo.telemetryQueue,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/readiness', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const windowDays = toBoundedInt(req.query?.windowDays, 30, { min: 1, max: 180 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await buildAgentRuntimeReadinessReport({ guildId, windowDays });
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/slo/report', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const report = await evaluateGuildSloReport({ guildId });
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/slo/alerts', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 100, { min: 1, max: 500 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const alerts = await listGuildSloAlertEvents({ guildId, limit });
      return res.json({ ok: true, guildId, alerts, count: alerts.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/slo/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/finops/summary', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 30, { min: 1, max: 180 });

    try {
      const summary = await getFinopsSummary({ guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/finops/showback', requireAdmin, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/finops/budget', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const budget = await getFinopsBudgetStatus(guildId);
      return res.json({ ok: true, budget });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/llm/experiments/summary', requireAdmin, async (req, res, next) => {
    const experimentName = toStringParam(req.query?.experimentName || req.query?.name || LLM_EXPERIMENT_NAME || 'hf_ab_v1');
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 180 });
    if (!experimentName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'experimentName is required' });
    }

    try {
      const summary = await getLlmExperimentSummary({ experimentName, guildId, days });
      return res.json({ ok: true, summary });
    } catch (error) {
      next(error);
    }
  });

  // ── E-02: Channel routing configuration (guild → channel → provider mapping) ──

  const VALID_CHANNEL_PROVIDERS = new Set(['native', 'openclaw', 'openshell', 'disabled']);
  const channelRoutingCache = new Map<string, Record<string, string>>();
  const DEFAULT_CHANNEL_ROUTING: Record<string, string> = { discord: 'native', whatsapp: 'openclaw', telegram: 'openclaw' };

  const loadChannelRouting = async (guildId: string): Promise<Record<string, string>> => {
    const cached = channelRoutingCache.get(guildId);
    if (cached) return cached;
    if (!isSupabaseConfigured()) return DEFAULT_CHANNEL_ROUTING;
    try {
      const db = getSupabaseClient();
      const { data } = await db
        .from('guild_channel_routing')
        .select('channels')
        .eq('guild_id', guildId)
        .maybeSingle();
      if (data?.channels && typeof data.channels === 'object') {
        const channels = data.channels as Record<string, string>;
        channelRoutingCache.set(guildId, channels);
        return channels;
      }
    } catch { /* fall through to default */ }
    return DEFAULT_CHANNEL_ROUTING;
  };

  const saveChannelRouting = async (guildId: string, channels: Record<string, string>): Promise<void> => {
    channelRoutingCache.set(guildId, channels);
    if (!isSupabaseConfigured()) return;
    try {
      const db = getSupabaseClient();
      await db
        .from('guild_channel_routing')
        .upsert({ guild_id: guildId, channels, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
    } catch { /* non-blocking: cache is authoritative during outage */ }
  };

  router.get('/agent/runtime/channel-routing', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const channels = await loadChannelRouting(guildId);
    return res.json({ ok: true, guildId, channels });
  });

  router.put('/agent/runtime/channel-routing', requireAdmin, adminActionRateLimiter, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const channels = req.body?.channels as Record<string, string> | undefined;
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'channels object is required (must be key-value map, not array)' });
    }
    // Validate channel provider values
    for (const [channel, provider] of Object.entries(channels)) {
      if (typeof provider !== 'string' || !VALID_CHANNEL_PROVIDERS.has(provider)) {
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION',
          message: `Invalid provider "${String(provider)}" for channel "${channel}". Valid: ${[...VALID_CHANNEL_PROVIDERS].join(', ')}`,
        });
      }
    }
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(channels)) {
      const key = String(k).slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
      if (key) sanitized[key] = String(v);
    }
    await saveChannelRouting(guildId, sanitized);
    return res.json({ ok: true, guildId, channels: sanitized, updatedAt: new Date().toISOString() });
  });

  // ── D-06: Sync HIGH_RISK_APPROVAL_ACTIONS to OpenShell network policy ──

  router.post('/agent/runtime/sandbox-policy-sync', requireAdmin, adminActionRateLimiter, async (_req, res, next) => {
    try {
      const result = await syncHighRiskActionsToSandboxPolicy();
      return res.json({ ok: result.synced, ...result });
    } catch (error) {
      next(error);
    }
  });

  // ──── Self-Improvement Loop Endpoints ───────────────────────────────────────

  router.get('/agent/runtime/self-improvement/gradient', requireAdmin, async (_req, res, next) => {
    try {
      const gradient = await computeSystemGradient();
      return res.json({ ok: true, gradient });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/convergence', requireAdmin, async (_req, res, next) => {
    try {
      const report = await computeConvergenceReport();
      return res.json({ ok: true, convergence: report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/cross-loop', requireAdmin, async (_req, res, next) => {
    try {
      const origins = getCrossLoopOriginsSnapshot();
      const outcomes = await evaluateCrossLoopOutcomes();
      return res.json({ ok: true, origins: origins.slice(0, 50), outcomes });
    } catch (error) {
      next(error);
    }
  });

}

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
import { getMemoryJobRunnerStats } from '../../services/memory/memoryJobRunner';
import { getObsidianLoreSyncLoopStats } from '../../services/obsidian/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../../services/eval/retrievalEvalLoopService';
import { buildAgentRuntimeReadinessReport } from '../../services/agent/agentRuntimeReadinessService';
import { evaluateGuildSloAndPersistAlerts, evaluateGuildSloReport, listGuildSloAlertEvents } from '../../services/agent/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../../services/finopsService';
import { getLlmExperimentSummary } from '../../services/llmExperimentAnalyticsService';
import { buildSocialQualityOperationalSnapshot } from '../../services/agent/agentSocialQualitySnapshotService';
import { buildWorkerApprovalGateSnapshot } from '../../services/agent/agentWorkerApprovalGateSnapshotService';
import { toBoundedInt, toStringParam } from '../../utils/validation';
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
  OPENJARVIS_REQUIRE_OPENCODE_WORKER,
  MCP_OPENCODE_WORKER_URL,
  UNATTENDED_WORKER_HEALTH_TIMEOUT_MS,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED,
  OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN,
  LLM_EXPERIMENT_NAME,
} from '../../config';

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
  const workerUrl = MCP_OPENCODE_WORKER_URL;
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
      label: 'opencode',
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
      label: 'opencode',
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
    label: 'opencode',
  };
};

export function registerBotAgentRuntimeRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
  router.get('/agent/runtime/worker-approval-gates', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const recentLimit = toBoundedInt(req.query?.recentLimit, 5, { min: 1, max: 20 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildWorkerApprovalGateSnapshot({ guildId, recentLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      return res.status(500).json({ ok: false, error: 'WORKER_APPROVAL_GATES_FAILED', message });
    }
  });

  router.get('/agent/runtime/social-quality-snapshot', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildSocialQualityOperationalSnapshot({ guildId, days });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'SOCIAL_QUALITY_SNAPSHOT_FAILED', message });
    }
  });

  router.get('/agent/runtime/telemetry-queue', requireAdmin, async (_req, res) => {
    return res.json({ ok: true, queue: getAgentTelemetryQueueSnapshot() });
  });

  router.get('/agent/runtime/role-workers', requireAdmin, async (_req, res) => {
    try {
      const specs = listAgentRoleWorkerSpecs();
      const health = await getAgentRoleWorkersHealthSnapshot();
      return res.json({ ok: true, workers: specs, health });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'ROLE_WORKERS_RUNTIME_FAILED', message });
    }
  });

  router.get('/agent/runtime/unattended-health', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    try {
      const telemetry = getAgentTelemetryQueueSnapshot();
      const readiness = guildId
        ? await summarizeOpencodeQueueReadiness({ guildId })
        : null;
      const workerHealth = await probeOpencodeWorkerHealth();
      const advisoryWorkersHealth = await getAgentRoleWorkersHealthSnapshot();
      return res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        telemetry,
        opencodeReadiness: readiness,
        workerHealth,
        advisoryWorkersHealth,
        notes: {
          guildScoped: Boolean(guildId),
          publishLock: {
            enabled: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED),
            failOpen: String(OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN),
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


  router.get('/agent/runtime/loops', requireAdmin, async (_req, res) => {
    return res.json({
      ok: true,
      memoryJobRunner: getMemoryJobRunnerStats(),
      obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
      retrievalEvalLoop: getRetrievalEvalLoopStats(),
      generatedAt: new Date().toISOString(),
    });
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

  router.get('/agent/runtime/channel-routing', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const channels = await loadChannelRouting(guildId);
    return res.json({ ok: true, guildId, channels });
  });

  router.put('/agent/runtime/channel-routing', requireAdmin, adminActionRateLimiter, async (req, res) => {
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

  router.post('/agent/runtime/sandbox-policy-sync', requireAdmin, adminActionRateLimiter, async (_req, res) => {
    try {
      const result = await syncHighRiskActionsToSandboxPolicy();
      return res.json({ ok: result.synced, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'SANDBOX_POLICY_SYNC_FAILED', message });
    }
  });

  // ──── Self-Improvement Loop Endpoints ───────────────────────────────────────

  router.get('/agent/runtime/self-improvement/gradient', requireAdmin, async (_req, res) => {
    try {
      const gradient = await computeSystemGradient();
      return res.json({ ok: true, gradient });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'GRADIENT_FAILED', message });
    }
  });

  router.get('/agent/runtime/self-improvement/convergence', requireAdmin, async (_req, res) => {
    try {
      const report = await computeConvergenceReport();
      return res.json({ ok: true, convergence: report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'CONVERGENCE_FAILED', message });
    }
  });

  router.get('/agent/runtime/self-improvement/cross-loop', requireAdmin, async (_req, res) => {
    try {
      const origins = getCrossLoopOriginsSnapshot();
      const outcomes = await evaluateCrossLoopOutcomes();
      return res.json({ ok: true, origins: origins.slice(0, 50), outcomes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'CROSS_LOOP_FAILED', message });
    }
  });


}

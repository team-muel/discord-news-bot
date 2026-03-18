import { requireAdmin } from '../../middleware/auth';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
  listSupabaseCronJobs,
} from '../../services/supabaseExtensionOpsService';
import { getPlatformLightweightingReport } from '../../services/platformLightweightingService';
import { getRuntimeSchedulerPolicySnapshot } from '../../services/runtimeSchedulerPolicyService';
import { getEfficiencySnapshot, runEfficiencyQuickWins } from '../../services/efficiencyOptimizationService';
import { getAgentTelemetryQueueSnapshot } from '../../services/agentTelemetryQueue';
import { summarizeOpencodeQueueReadiness } from '../../services/opencodeGitHubQueueService';
import { getMemoryJobRunnerStats } from '../../services/memoryJobRunner';
import { getObsidianLoreSyncLoopStats } from '../../services/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../../services/retrievalEvalLoopService';
import { buildAgentRuntimeReadinessReport } from '../../services/agentRuntimeReadinessService';
import { evaluateGuildSloAndPersistAlerts, evaluateGuildSloReport, listGuildSloAlertEvents } from '../../services/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../../services/finopsService';
import { getLlmExperimentSummary } from '../../services/llmExperimentAnalyticsService';
import { toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentRuntimeRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
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


}

import { requireAdmin } from '../../../middleware/auth';
import { buildAgentRuntimeReadinessReport } from '../../../services/agent/agentRuntimeReadinessService';
import { evaluateGuildSloAndPersistAlerts, evaluateGuildSloReport, listGuildSloAlertEvents } from '../../../services/agent/agentSloService';
import { getFinopsBudgetStatus, getFinopsSummary } from '../../../services/finopsService';
import { getLlmExperimentSummary } from '../../../services/llmExperimentAnalyticsService';
import { getMemoryJobRunnerStats } from '../../../services/memory/memoryJobRunner';
import { getObsidianInboxChatLoopStats } from '../../../services/obsidian/obsidianInboxChatLoopService';
import { getObsidianLoreSyncLoopStats } from '../../../services/obsidian/obsidianLoreSyncService';
import { getObsidianMaintenanceControlSurface } from '../../../services/obsidian/obsidianMaintenanceControlService';
import { getObsidianGraphAuditLoopStats } from '../../../services/obsidian/obsidianQualityService';
import { getRetrievalEvalLoopStats } from '../../../services/eval/retrievalEvalLoopService';
import { getRewardSignalLoopStatus } from '../../../services/eval/rewardSignalLoopService';
import { getEvalAutoPromoteLoopStatus } from '../../../services/eval/evalAutoPromoteLoopService';
import { getEvalMaintenanceControlSurface } from '../../../services/eval/evalMaintenanceControlService';
import { getLocalAutonomySupervisorLoopStats } from '../../../services/runtime/localAutonomySupervisorService';
import { LLM_EXPERIMENT_NAME } from '../../../config';
import { toBoundedInt, toStringParam } from '../../../utils/validation';

import { parseBool } from '../runtime-builders/paramValidation';
import { buildActiveWorkset, buildOperatorSnapshot } from '../runtime-builders/snapshotReports';
import { type BotAgentRouteDeps } from '../types';

export function registerBotAgentSnapshotRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency } = deps;

  router.get('/agent/runtime/loops', requireAdmin, (_req, res) => {
    return res.json({
      ok: true,
      memoryJobRunner: getMemoryJobRunnerStats(),
      obsidianInboxChatLoop: getObsidianInboxChatLoopStats(),
      obsidianLoreSyncLoop: getObsidianLoreSyncLoopStats(),
      obsidianGraphAuditLoop: getObsidianGraphAuditLoopStats(),
      retrievalEvalLoop: getRetrievalEvalLoopStats(),
      rewardSignalLoop: getRewardSignalLoopStatus(),
      evalAutoPromoteLoop: getEvalAutoPromoteLoopStatus(),
      localAutonomySupervisorLoop: getLocalAutonomySupervisorLoopStats(),
      obsidianMaintenanceControl: getObsidianMaintenanceControlSurface(),
      evalMaintenanceControl: getEvalMaintenanceControlSurface(),
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/agent/runtime/operator-snapshot', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const includeDocs = parseBool(String(req.query?.includeDocs || ''), true);
    const includeRuntime = parseBool(String(req.query?.includeRuntime || ''), true);
    const includePendingIntents = parseBool(String(req.query?.includePendingIntents || ''), false);
    const includeInternalKnowledge = parseBool(String(req.query?.includeInternalKnowledge || ''), false);
    const internalKnowledgeGoal = toStringParam(req.query?.internalKnowledgeGoal) || undefined;

    try {
      const snapshot = await buildOperatorSnapshot({
        guildId,
        days,
        includeDocs,
        includeRuntime,
        includePendingIntents,
        includeInternalKnowledge,
        internalKnowledgeGoal,
      });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/workset', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const objective = toStringParam(req.query?.objective) || undefined;
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    const includeEvidence = parseBool(String(req.query?.includeEvidence || ''), true);

    try {
      const workset = await buildActiveWorkset({
        guildId,
        objective,
        days,
        includeEvidence,
        maxArtifacts: req.query?.maxArtifacts !== undefined ? toBoundedInt(req.query?.maxArtifacts, 5, { min: 1, max: 12 }) : undefined,
        maxFacts: req.query?.maxFacts !== undefined ? toBoundedInt(req.query?.maxFacts, 6, { min: 1, max: 16 }) : undefined,
      });
      return res.json({ ok: true, workset });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/knowledge-control-plane', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await buildOperatorSnapshot({
        guildId,
        days,
        includeDocs: true,
        includeRuntime: true,
        includeInternalKnowledge: true,
        internalKnowledgeGoal: `knowledge control plane readiness for guild ${guildId}`,
      });
      return res.json({
        ok: true,
        snapshot,
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
}
import { requireAdmin } from '../../middleware/auth';
import { computeRewardSnapshot, persistRewardSnapshot, getRecentRewardSnapshots, computeRewardTrend } from '../../services/eval/rewardSignalService';
import { getRewardSignalLoopStatus } from '../../services/eval/rewardSignalLoopService';
import { createEvalRun, getRecentEvalRuns, runEvalPipeline } from '../../services/eval/evalAutoPromoteService';
import { getEvalAutoPromoteLoopStatus } from '../../services/eval/evalAutoPromoteLoopService';
import {
  getRecentShadowDivergence,
  getShadowDivergenceBySession,
  getShadowDivergenceStats,
} from '../../services/langgraph/shadowGraphRunner';
import {
  getRecentTrafficRoutingDecisions,
  getTrafficRouteDistribution,
} from '../../services/workflow/trafficRoutingService';
import { toStringParam, toBoundedInt } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';
import { getErrorMessage } from '../../utils/errorMessage';

export function registerBotAgentRewardEvalRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency } = deps;

  // ─── Reward Signal ────────────────────────────────────────────────

  /** Get current reward snapshot (computed on the fly) */
  router.get('/agent/reward/snapshot', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await computeRewardSnapshot(guildId);
      if (!snapshot) {
        return res.status(503).json({ ok: false, error: 'COMPUTE_FAILED', message: 'Could not compute reward snapshot' });
      }
      return res.json({ ok: true, snapshot });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'REWARD_SNAPSHOT_FAILED', message });
    }
  });

  /** Force-compute and persist a reward snapshot */
  router.post('/agent/reward/compute', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const snapshot = await computeRewardSnapshot(guildId);
      if (!snapshot) {
        return res.status(503).json({ ok: false, error: 'COMPUTE_FAILED', message: 'Could not compute reward snapshot' });
      }
      const persisted = await persistRewardSnapshot(snapshot);
      return res.json({ ok: true, persisted, snapshot });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'REWARD_COMPUTE_FAILED', message });
    }
  });

  /** Get recent reward snapshots for a guild (trend data) */
  router.get('/agent/reward/history', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const limit = toBoundedInt(req.query?.limit, 20, { min: 1, max: 100 });

    try {
      const snapshots = await getRecentRewardSnapshots(guildId, limit);
      return res.json({ ok: true, count: snapshots.length, snapshots });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'REWARD_HISTORY_FAILED', message });
    }
  });

  /** Get reward trend (improving / stable / degrading) */
  router.get('/agent/reward/trend', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const trend = await computeRewardTrend(guildId);
      if (!trend) {
        return res.json({ ok: true, trend: null, message: 'Not enough snapshots for trend analysis' });
      }
      return res.json({ ok: true, trend });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'REWARD_TREND_FAILED', message });
    }
  });

  /** Reward signal loop status */
  router.get('/agent/reward/loop-status', requireAdmin, async (_req, res) => {
    return res.json({ ok: true, ...getRewardSignalLoopStatus() });
  });

  // ─── A/B Eval ─────────────────────────────────────────────────────

  /** Create a new A/B eval run */
  router.post('/agent/eval/create-run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const evalName = toStringParam(req.body?.evalName);
    const baselineConfig = req.body?.baselineConfig;
    const candidateConfig = req.body?.candidateConfig;

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!evalName) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'evalName is required' });
    }
    if (!baselineConfig || typeof baselineConfig !== 'object' || Array.isArray(baselineConfig)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'baselineConfig must be a JSON object' });
    }
    if (!candidateConfig || typeof candidateConfig !== 'object' || Array.isArray(candidateConfig)) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'candidateConfig must be a JSON object' });
    }

    try {
      const evalRun = await createEvalRun({ guildId, evalName, baselineConfig, candidateConfig });
      if (!evalRun) {
        return res.status(503).json({ ok: false, error: 'EVAL_DISABLED', message: 'Eval service is disabled or Supabase not configured' });
      }
      return res.status(201).json({ ok: true, evalRun });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'EVAL_CREATE_FAILED', message });
    }
  });

  /** Force-run the eval pipeline for a guild */
  router.post('/agent/eval/run-pipeline', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId || req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const result = await runEvalPipeline(guildId);
      return res.json({ ok: true, ...result });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'EVAL_PIPELINE_FAILED', message });
    }
  });

  /** Get recent eval runs for a guild (dashboard) */
  router.get('/agent/eval/recent', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const limit = toBoundedInt(req.query?.limit, 20, { min: 1, max: 100 });

    try {
      const runs = await getRecentEvalRuns(guildId, limit);
      return res.json({ ok: true, count: runs.length, runs });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'EVAL_RECENT_FAILED', message });
    }
  });

  /** Eval auto-promote loop status */
  router.get('/agent/eval/loop-status', requireAdmin, async (_req, res) => {
    return res.json({ ok: true, ...getEvalAutoPromoteLoopStatus() });
  });

  // ─── Shadow Graph Divergence ──────────────────────────────────────

  /** Get recent shadow graph divergence logs */
  router.get('/agent/shadow/divergence', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    const limit = toBoundedInt(req.query?.limit, 20, { min: 1, max: 100 });

    try {
      const { data, error } = await getRecentShadowDivergence(guildId, limit);
      if (error) {
        const status = error === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
        return res.status(status).json({ ok: false, error: 'SHADOW_QUERY_FAILED', message: error });
      }
      return res.json({ ok: true, count: (data || []).length, logs: data || [] });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'SHADOW_DIVERGENCE_FAILED', message });
    }
  });

  /** Get shadow graph divergence for a specific session */
  router.get('/agent/shadow/divergence/:sessionId', requireAdmin, async (req, res) => {
    const sessionId = toStringParam(req.params?.sessionId);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'sessionId is required' });
    }

    try {
      const { data, error } = await getShadowDivergenceBySession(sessionId);
      if (error) {
        const status = error === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
        return res.status(status).json({ ok: false, error: 'SHADOW_QUERY_FAILED', message: error });
      }
      if (!data) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'No shadow divergence log for this session' });
      }
      return res.json({ ok: true, log: data });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'SHADOW_DIVERGENCE_FAILED', message });
    }
  });

  /** Aggregate shadow graph divergence stats for a guild */
  router.get('/agent/shadow/stats', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const { stats, error } = await getShadowDivergenceStats(guildId);
      if (error) {
        const status = error === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
        return res.status(status).json({ ok: false, error: 'SHADOW_QUERY_FAILED', message: error });
      }
      return res.json({ ok: true, stats });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'SHADOW_STATS_FAILED', message });
    }
  });

  // ─── Traffic Routing Decisions ──────────────────────────────────────

  /** Get recent traffic routing decisions for a guild */
  router.get('/agent/traffic/decisions', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query.guildId);
    const limit = toBoundedInt(req.query.limit, 20, { min: 1, max: 100 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const { data, error } = await getRecentTrafficRoutingDecisions(guildId, limit);
      if (error) {
        const status = error === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
        return res.status(status).json({ ok: false, error: 'TRAFFIC_QUERY_FAILED', message: error });
      }
      return res.json({ ok: true, decisions: data });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'TRAFFIC_DECISIONS_FAILED', message });
    }
  });

  /** Get traffic route distribution for a guild (percentage breakdown) */
  router.get('/agent/traffic/distribution', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query.guildId);
    const windowHours = toBoundedInt(req.query.windowHours, 24, { min: 1, max: 720 });

    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const { distribution, total, error } = await getTrafficRouteDistribution(guildId, windowHours);
      if (error) {
        const status = error === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
        return res.status(status).json({ ok: false, error: 'TRAFFIC_QUERY_FAILED', message: error });
      }
      return res.json({ ok: true, distribution, total, windowHours });
    } catch (error) {
      const message = getErrorMessage(error);
      return res.status(500).json({ ok: false, error: 'TRAFFIC_DISTRIBUTION_FAILED', message });
    }
  });
}

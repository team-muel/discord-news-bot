import { requireAdmin } from '../../middleware/auth';
import { buildTaskRoutingPolicyHints, getTaskRoutingSummary } from '../../services/taskRoutingAnalyticsService';
import { recordTaskRoutingFeedbackMetric } from '../../services/taskRoutingMetricsService';
import { buildToolLearningWeeklyReport, decideToolLearningCandidate, generateTaskRoutingLearningCandidates, listToolLearningCandidates, listToolLearningRules, recordToolLearningLog } from '../../services/toolLearningService';
import { isOneOf, toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentLearningRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;

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

  router.post('/agent/task-routing/feedback', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

  router.post('/agent/learning/task-routing/candidates/generate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

  router.post('/agent/learning/task-routing/candidates/:candidateId/decision', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
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

}


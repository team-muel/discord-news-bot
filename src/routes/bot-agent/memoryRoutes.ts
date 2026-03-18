import { requireAdmin } from '../../middleware/auth';
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
} from '../../services/agentMemoryStore';
import type { MemoryType } from '../../services/agentMemoryStore';
import { cancelMemoryJob, getMemoryJobQueueStats, getMemoryJobRunnerStats, listMemoryJobDeadletters, requeueDeadletterJob } from '../../services/memoryJobRunner';
import { getObsidianLoreSyncLoopStats } from '../../services/obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from '../../services/retrievalEvalLoopService';
import { getMemoryQualityMetrics } from '../../services/memoryQualityMetricsService';
import { createRetrievalEvalSet, getRetrievalEvalRun, listRetrievalEvalCases, runRetrievalAutoTuning, runRetrievalEval, upsertRetrievalEvalCase } from '../../services/retrievalEvalService';
import { buildGoNoGoReport } from '../../services/goNoGoService';
import { isOneOf, toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentMemoryRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;

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

}


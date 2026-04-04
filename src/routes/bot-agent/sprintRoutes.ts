import { requireAdmin } from '../../middleware/auth';
import {
  getSprintPipeline,
  listSprintPipelines,
  approveSprintPhase,
  cancelSprintPipeline,
  getSprintRuntimeSnapshot,
  getSprintMetrics,
} from '../../services/sprint/sprintOrchestrator';
import { triggerManualSprint } from '../../services/sprint/sprintTriggers';
import { rehydrateFromEvents, getEventSourcedEntity, getEventTimeline } from '../../services/sprint/eventSourcing/bridge';
import { toBoundedInt, toStringParam, isOneOf } from '../../utils/validation';
import type { BotAgentRouteDeps } from './types';
import type { AutonomyLevel } from '../../services/sprint/sprintOrchestrator';

const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['full-auto', 'approve-ship', 'approve-impl', 'manual'];

export function registerSprintRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency } = deps;

  // ── Read endpoints ──────────────────────────────────────────────────────

  router.get('/agent/sprint/snapshot', requireAdmin, (_req, res) => {
    return res.json({ ok: true, ...getSprintRuntimeSnapshot() });
  });

  router.get('/agent/sprint/metrics', requireAdmin, (_req, res) => {
    return res.json({ ok: true, ...getSprintMetrics() });
  });

  router.get('/agent/sprint/pipelines', requireAdmin, (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const limit = toBoundedInt(req.query?.limit, 20, { min: 1, max: 100 });
    return res.json({ ok: true, pipelines: listSprintPipelines(guildId, limit) });
  });

  router.get('/agent/sprint/pipelines/:id', requireAdmin, (req, res) => {
    const pipeline = getSprintPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Sprint pipeline not found' });
    }
    return res.json({ ok: true, pipeline });
  });

  // ── Event sourcing diagnostic endpoints ─────────────────────────────────

  router.get('/agent/sprint/pipelines/:id/events', requireAdmin, async (req, res) => {
    const sprintId = req.params.id;

    // Try in-memory entity first, fall back to rehydration from event store
    let entity = getEventSourcedEntity(sprintId);
    if (!entity) {
      entity = await rehydrateFromEvents(sprintId) ?? undefined;
    }
    if (!entity) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'No event-sourced data found for this pipeline' });
    }

    // Fetch raw events from the adapter for the timeline view
    let rawEvents: unknown[] = [];
    try {
      rawEvents = await getEventTimeline(sprintId);
    } catch {
      // non-fatal: still return the state
    }

    return res.json({
      ok: true,
      state: {
        currentPhase: entity.state.currentPhase,
        isTerminal: entity.isTerminal,
        totalPhasesExecuted: entity.state.totalPhasesExecuted,
        implReviewLoopCount: entity.state.implementReviewLoopCount,
        changedFiles: entity.state.changedFiles,
        phaseResults: entity.state.phaseResults,
        error: entity.state.error,
      },
      version: entity.version,
      eventCount: rawEvents.length,
      events: rawEvents,
    });
  });

  // ── Write endpoints ─────────────────────────────────────────────────────

  router.post('/agent/sprint/pipelines', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guild_id) || toStringParam(req.body?.guildId);
    const objective = toStringParam(req.body?.objective);
    if (!guildId || !objective) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guild_id and objective are required' });
    }

    const requestedBy = toStringParam(req.user?.id) || 'api';
    const rawAutonomy = toStringParam(req.body?.autonomy_level);
    const autonomyLevel = rawAutonomy && isOneOf(rawAutonomy, AUTONOMY_LEVELS) ? rawAutonomy : undefined;

    try {
      const result = await triggerManualSprint({
        guildId,
        objective,
        requestedBy,
        autonomyLevel,
      });
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(409).json({ ok: false, error: 'SPRINT_TRIGGER_FAILED', message });
    }
  });

  router.post('/agent/sprint/pipelines/:id/approve', requireAdmin, adminActionRateLimiter, async (req, res) => {
    const approvedBy = toStringParam(req.user?.id) || 'api';
    const result = await approveSprintPhase(req.params.id, approvedBy);
    const status = result.ok ? 200 : 404;
    return res.status(status).json(result);
  });

  router.delete('/agent/sprint/pipelines/:id', requireAdmin, (req, res) => {
    const result = cancelSprintPipeline(req.params.id);
    const status = result.ok ? 200 : 404;
    return res.status(status).json(result);
  });
}

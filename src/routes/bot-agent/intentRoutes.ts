/**
 * Intent Formation API Routes.
 *
 * GET  /agent/intents          — list intents
 * GET  /agent/intents/stats    — intent stats
 * POST /agent/intents/:id/approve — approve a pending intent
 * POST /agent/intents/:id/reject  — reject a pending intent
 * POST /agent/intent-formation/run — manually trigger intent evaluation
 */

import { requireAdmin } from '../../middleware/auth';
import logger from '../../logger';
import { toBoundedInt, toStringParam } from '../../utils/validation';
import type { BotAgentRouteDeps } from './types';

export function registerBotAgentIntentRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter } = deps;

  // GET /agent/intents — list intents with optional filters
  router.get('/agent/intents', requireAdmin, async (req, res, _next) => {
    try {
      const { getIntents } = await import('../../services/intent/intentStore');
      const guildId = toStringParam(req.query.guild_id as string | undefined);
      const status = toStringParam(req.query.status as string | undefined) as import('../../services/intent/intentTypes').IntentStatus | undefined;
      const limit = toBoundedInt(req.query.limit as string | undefined, 50, { min: 1, max: 200 });

      const intents = await getIntents({ guildId: guildId || undefined, status, limit });
      return res.json({ ok: true, intents, count: intents.length });
    } catch (err) {
      logger.debug('[INTENT-API] list error: %s', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to list intents' });
    }
  });

  // GET /agent/intents/stats — aggregate stats
  router.get('/agent/intents/stats', requireAdmin, async (req, res, _next) => {
    try {
      const { getIntentStats } = await import('../../services/intent/intentStore');
      const { getIntentRules } = await import('../../services/intent/intentFormationEngine');
      const guildId = toStringParam(req.query.guild_id as string | undefined) || undefined;

      const stats = await getIntentStats(guildId);
      const rules = getIntentRules().map((r) => ({
        id: r.id,
        channels: r.channels,
        autonomyLevel: r.autonomyLevel,
        autoExecute: r.autoExecute,
      }));

      return res.json({ ok: true, stats, rules });
    } catch (err) {
      logger.debug('[INTENT-API] stats error: %s', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to get intent stats' });
    }
  });

  // POST /agent/intents/:id/approve — approve and optionally execute
  router.post('/agent/intents/:id/approve', requireAdmin, adminActionRateLimiter, async (req, res, _next) => {
    try {
      const intentId = Number(req.params.id);
      if (!Number.isFinite(intentId) || intentId <= 0) {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'Invalid intent ID' });
      }

      const { getIntentById, updateIntentStatus } = await import('../../services/intent/intentStore');
      const intent = await getIntentById(intentId);
      if (!intent) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Intent not found' });
      }
      if (intent.status !== 'pending') {
        return res.status(409).json({ ok: false, error: 'CONFLICT', message: `Intent is ${intent.status}, not pending` });
      }

      await updateIntentStatus(intentId, 'approved');

      // Optionally auto-execute
      const autoExecute = req.body?.execute !== false;
      let sprintId: string | null = null;
      if (autoExecute) {
        const { executeIntent } = await import('../../services/intent/intentFormationEngine');
        sprintId = await executeIntent({ ...intent, status: 'approved' });
      }

      return res.json({ ok: true, intentId, status: 'approved', sprintId });
    } catch (err) {
      logger.debug('[INTENT-API] approve error: %s', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to approve intent' });
    }
  });

  // POST /agent/intents/:id/reject — reject a pending intent
  router.post('/agent/intents/:id/reject', requireAdmin, adminActionRateLimiter, async (req, res, _next) => {
    try {
      const intentId = Number(req.params.id);
      if (!Number.isFinite(intentId) || intentId <= 0) {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'Invalid intent ID' });
      }

      const { getIntentById, updateIntentStatus } = await import('../../services/intent/intentStore');
      const intent = await getIntentById(intentId);
      if (!intent) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Intent not found' });
      }
      if (intent.status !== 'pending') {
        return res.status(409).json({ ok: false, error: 'CONFLICT', message: `Intent is ${intent.status}, not pending` });
      }

      await updateIntentStatus(intentId, 'rejected');
      return res.json({ ok: true, intentId, status: 'rejected' });
    } catch (err) {
      logger.debug('[INTENT-API] reject error: %s', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to reject intent' });
    }
  });

  // POST /agent/intent-formation/run — manually trigger formation for a guild
  router.post('/agent/intent-formation/run', requireAdmin, adminActionRateLimiter, async (req, res, _next) => {
    try {
      const guildId = toStringParam(req.body?.guild_id) || toStringParam(req.body?.guildId);
      if (!guildId) {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guild_id is required' });
      }

      const { evaluateIntents } = await import('../../services/intent/intentFormationEngine');
      const intents = await evaluateIntents(guildId);

      return res.json({
        ok: true,
        created: intents.length,
        intents: intents.map((i) => ({
          id: i.id,
          ruleId: i.ruleId,
          hypothesis: i.hypothesis,
          autonomyLevel: i.autonomyLevel,
          status: i.status,
        })),
      });
    } catch (err) {
      logger.debug('[INTENT-API] manual run error: %s', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, error: 'INTERNAL', message: 'Failed to run intent formation' });
    }
  });
}

import { client } from '../../bot';
import { requireAdmin } from '../../middleware/auth';
import {
  cancelAgentSession,
  getAgentSession,
  getAgentPolicy,
  getMultiAgentRuntimeSnapshot,
  listAgentDeadletters,
  listAgentSkills,
  listGuildAgentSessions,
  serializeAgentSessionForApi,
  startAgentSession,
} from '../../services/multiAgentService';
import { getAgentOpsSnapshot, triggerDailyLearningRun, triggerGuildOnboardingSession, triggerGotCutoverAutopilotRun } from '../../services/agent/agentOpsService';
import { getConversationThreadBySession, listConversationThreads, listConversationTurns } from '../../services/conversationTurnService';
import { toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentCoreRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
  router.get('/agent/sessions', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD', message: 'guildId is required' });
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

  router.get('/agent/conversations/threads', requireAdmin, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/conversations/threads/:threadId/turns', requireAdmin, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/conversations/by-session/:sessionId', requireAdmin, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/deadletters', requireAdmin, async (req, res, next) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });
    const deadletters = listAgentDeadletters({ guildId, limit });
    return res.json({
      runtime: getMultiAgentRuntimeSnapshot(),
      deadletters,
      guildScope: guildId || 'all',
    });
  });

  router.get('/agent/skills', requireAdmin, async (_req, res, next) => {
    return res.json({ skills: listAgentSkills() });
  });

  router.get('/agent/policy', requireAdmin, async (_req, res, next) => {
    return res.json({ policy: getAgentPolicy(), ops: getAgentOpsSnapshot() });
  });

  router.post('/agent/onboarding/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD', message: 'guildId is required' });
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

  router.post('/agent/learning/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const result = triggerDailyLearningRun(client, guildId || undefined);
    return res.status(result.ok ? 202 : 409).json(result);
  });

  router.get('/agent/sessions/:sessionId', requireAdmin, async (req, res, next) => {
    const sessionId = toStringParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD', message: 'sessionId is required' });
    }

    const session = getAgentSession(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }

    const includeShadowGraph = String(req.query?.includeShadowGraph || '').trim().toLowerCase() === 'true';
    const traceTailLimit = toBoundedInt(req.query?.traceTailLimit, 5, { min: 0, max: 20 });

    return res.json({ session: serializeAgentSessionForApi(session, { includeShadowGraph, traceTailLimit }) });
  });

  router.post('/agent/sessions', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const guildId = toStringParam(req.body?.guildId);
    const goal = toStringParam(req.body?.goal);
    const skillId = toStringParam(req.body?.skillId);
    const priority = req.body?.priority ? String(req.body.priority).trim() : undefined;
    if (!guildId || !goal) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD', message: 'guildId and goal are required' });
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
      return next(error);
    }

    return res.status(202).json({ ok: true, session: serializeAgentSessionForApi(session) });
  });

  router.post('/agent/sessions/:sessionId/cancel', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const sessionId = toStringParam(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYLOAD', message: 'sessionId is required' });
    }

    const result = cancelAgentSession(sessionId);
    if (!result.ok) {
      return res.status(409).json({ ok: false, error: 'SESSION_CANCEL_FAILED', message: result.message });
    }

    return res.status(202).json({ ok: true, message: result.message });
  });

}

import { client } from '../../bot';
import { requireAdmin } from '../../middleware/auth';
import { getAgentGotPolicySnapshot } from '../../services/agent/agentGotPolicyService';
import { getGotRunById, listGotNodes, listGotRuns, listGotSelectionEvents } from '../../services/agent/agentGotStore';
import { buildGotPerformanceDashboard } from '../../services/agent/agentGotAnalyticsService';
import { getAgentGotCutoverDecision } from '../../services/agent/agentGotCutoverService';
import { triggerGotCutoverAutopilotRun } from '../../services/agent/agentOpsService';
import { toBoundedInt, toStringParam } from '../../utils/validation';

import { BotAgentRouteDeps } from './types';

export function registerBotAgentGotRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency, opencodeIdempotency } = deps;
  router.get('/agent/got/policy', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId) || undefined;
    return res.json({ ok: true, guildId: guildId || '*', policy: getAgentGotPolicySnapshot(guildId) });
  });

  router.get('/agent/got/runs', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const limit = toBoundedInt(req.query?.limit, 30, { min: 1, max: 200 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const runs = await listGotRuns({ guildId, limit });
      return res.json({ ok: true, runs, count: runs.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_RUN_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const run = await getGotRunById({ guildId, runId });
      return res.json({ ok: true, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'AGENT_GOT_RUN_NOT_FOUND') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_RUN_READ_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId/nodes', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 500 });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const nodes = await listGotNodes({ guildId, runId, limit });
      return res.json({ ok: true, nodes, count: nodes.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_NODE_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/runs/:runId/selection-events', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const runId = toBoundedInt(req.params.runId, -1, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const limit = toBoundedInt(req.query?.limit, 200, { min: 1, max: 500 });
    if (!guildId || runId < 1) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId and runId are required' });
    }

    try {
      const events = await listGotSelectionEvents({ guildId, runId, limit });
      return res.json({ ok: true, events, count: events.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_SELECTION_EVENT_LIST_FAILED', message });
    }
  });

  router.get('/agent/got/dashboard/performance', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const days = toBoundedInt(req.query?.days, 14, { min: 1, max: 90 });
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const dashboard = await buildGotPerformanceDashboard({ guildId, days });
      return res.json({ ok: true, dashboard });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'VALIDATION') {
        return res.status(400).json({ ok: false, error: 'VALIDATION', message });
      }
      if (message === 'SUPABASE_NOT_CONFIGURED') {
        return res.status(503).json({ ok: false, error: 'CONFIG', message });
      }
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_DASHBOARD_FAILED', message });
    }
  });

  router.get('/agent/got/cutover-decision', requireAdmin, async (req, res) => {
    const guildId = toStringParam(req.query?.guildId);
    const sessionId = toStringParam(req.query?.sessionId) || undefined;
    const forceRefresh = String(req.query?.forceRefresh || '').trim().toLowerCase() === 'true';
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }

    try {
      const decision = await getAgentGotCutoverDecision({ guildId, sessionId, forceRefresh });
      return res.json({ ok: true, decision });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ ok: false, error: 'AGENT_GOT_CUTOVER_DECISION_FAILED', message });
    }
  });


  router.post('/agent/got/cutover/autopilot/run', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res) => {
    const guildId = toStringParam(req.body?.guildId);
    const result = await triggerGotCutoverAutopilotRun(client, guildId || undefined);
    return res.status(result.ok ? 202 : 409).json(result);
  });


}

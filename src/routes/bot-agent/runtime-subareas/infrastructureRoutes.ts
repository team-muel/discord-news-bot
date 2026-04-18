import { requireAdmin } from '../../../middleware/auth';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
  listSupabaseCronJobs,
} from '../../../services/infra/supabaseExtensionOpsService';
import { getPlatformLightweightingReport } from '../../../services/runtime/platformLightweightingService';
import { getRuntimeSchedulerPolicySnapshot } from '../../../services/runtime/runtimeSchedulerPolicyService';
import { getEfficiencySnapshot, runEfficiencyQuickWins } from '../../../services/runtime/efficiencyOptimizationService';
import {
  computeSystemGradient,
  computeConvergenceReport,
  getCrossLoopOriginsSnapshot,
  evaluateCrossLoopOutcomes,
} from '../../../services/sprint/selfImprovementLoop';
import { syncHighRiskActionsToSandboxPolicy } from '../../../services/skills/actionRunner';
import { getSupabaseClient, isSupabaseConfigured } from '../../../services/supabaseClient';
import { sanitizeRecord, toBoundedInt, toStringParam } from '../../../utils/validation';
import type { BotAgentRouteDeps } from '../types';

const CHANNEL_ROUTING_KEY_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const VALID_CHANNEL_PROVIDERS = new Set(['native', 'openclaw', 'openshell', 'disabled']);
const DEFAULT_CHANNEL_ROUTING: Record<string, string> = {
  discord: 'native',
  whatsapp: 'openclaw',
  telegram: 'openclaw',
};

export function registerBotAgentInfrastructureRoutes(deps: BotAgentRouteDeps): void {
  const { router, adminActionRateLimiter, adminIdempotency } = deps;
  const channelRoutingCache = new Map<string, Record<string, string>>();

  const loadChannelRouting = async (guildId: string): Promise<Record<string, string>> => {
    const cached = channelRoutingCache.get(guildId);
    if (cached) {
      return cached;
    }

    if (!isSupabaseConfigured()) {
      return DEFAULT_CHANNEL_ROUTING;
    }

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
    } catch {
      // Fall through to the default in-memory mapping during outages.
    }

    return DEFAULT_CHANNEL_ROUTING;
  };

  const saveChannelRouting = async (guildId: string, channels: Record<string, string>): Promise<void> => {
    channelRoutingCache.set(guildId, channels);
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const db = getSupabaseClient();
      await db
        .from('guild_channel_routing')
        .upsert({ guild_id: guildId, channels, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' });
    } catch {
      // Non-blocking: cache remains authoritative while persistence is unavailable.
    }
  };

  router.get('/agent/runtime/supabase/extensions', requireAdmin, async (req, res, next) => {
    const includeTopQueries = String(req.query?.includeTopQueries || 'true').trim().toLowerCase() !== 'false';
    const topLimit = toBoundedInt(req.query?.topLimit, 10, { min: 1, max: 50 });

    try {
      const snapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries, topLimit });
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/cron-jobs', requireAdmin, async (_req, res, next) => {
    try {
      const jobs = await listSupabaseCronJobs();
      return res.json({ ok: true, jobs, count: jobs.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/cron-jobs/ensure-maintenance', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
    const llmRetentionDays = toBoundedInt(req.body?.llmRetentionDays, 30, { min: 1, max: 365 });

    try {
      const installed = await ensureSupabaseMaintenanceCronJobs({ llmRetentionDays });
      return res.status(202).json({ ok: true, llmRetentionDays, installed, count: installed.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/supabase/hypopg/candidates', requireAdmin, async (_req, res, next) => {
    try {
      const candidates = await getHypoPgCandidates();
      return res.json({ ok: true, candidates, count: candidates.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/supabase/hypopg/evaluate', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
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
      next(error);
    }
  });

  router.get('/agent/runtime/lightweighting-plan', requireAdmin, async (_req, res, next) => {
    try {
      const report = await getPlatformLightweightingReport();
      return res.json({ ok: true, report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/scheduler-policy', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getRuntimeSchedulerPolicySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/efficiency', requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await getEfficiencySnapshot();
      return res.json({ ok: true, snapshot });
    } catch (error) {
      next(error);
    }
  });

  router.post('/agent/runtime/efficiency/quick-wins', requireAdmin, adminActionRateLimiter, adminIdempotency, async (req, res, next) => {
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
      next(error);
    }
  });

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
    const channels = sanitizeRecord(req.body?.channels);
    if (!guildId) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'guildId is required' });
    }
    if (!channels) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: 'channels object is required (must be key-value map, not array)' });
    }

    for (const [channel, provider] of Object.entries(channels)) {
      if (!CHANNEL_ROUTING_KEY_PATTERN.test(channel)) {
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION',
          message: `Invalid channel key "${channel}". Keys must match /^[A-Za-z0-9_-]{1,50}$/ and are stored verbatim.`,
        });
      }
      if (typeof provider !== 'string' || !VALID_CHANNEL_PROVIDERS.has(provider)) {
        return res.status(400).json({
          ok: false,
          error: 'VALIDATION',
          message: `Invalid provider "${String(provider)}" for channel "${channel}". Valid: ${[...VALID_CHANNEL_PROVIDERS].join(', ')}`,
        });
      }
    }

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(channels)) {
      sanitized[key] = String(value);
    }

    await saveChannelRouting(guildId, sanitized);
    return res.json({ ok: true, guildId, channels: sanitized, updatedAt: new Date().toISOString() });
  });

  router.post('/agent/runtime/sandbox-policy-sync', requireAdmin, adminActionRateLimiter, async (_req, res, next) => {
    try {
      const result = await syncHighRiskActionsToSandboxPolicy();
      return res.json({ ok: result.synced, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/gradient', requireAdmin, async (_req, res, next) => {
    try {
      const gradient = await computeSystemGradient();
      return res.json({ ok: true, gradient });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/convergence', requireAdmin, async (_req, res, next) => {
    try {
      const report = await computeConvergenceReport();
      return res.json({ ok: true, convergence: report });
    } catch (error) {
      next(error);
    }
  });

  router.get('/agent/runtime/self-improvement/cross-loop', requireAdmin, async (_req, res, next) => {
    try {
      const origins = getCrossLoopOriginsSnapshot();
      const outcomes = await evaluateCrossLoopOutcomes();
      return res.json({ ok: true, origins: origins.slice(0, 50), outcomes });
    } catch (error) {
      next(error);
    }
  });
}
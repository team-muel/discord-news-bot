import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import {
  DISCORD_DOCS_INGRESS_ADAPTER,
  DISCORD_DOCS_INGRESS_HARD_DISABLE,
  DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
  DISCORD_DOCS_INGRESS_SHADOW_MODE,
  DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
  DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
  DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
  NODE_ENV,
  SUPABASE_SERVICE_ROLE_KEY,
} from '../config';
import {
  executeDiscordIngress,
  findDiscordIngressRolloutKey,
  getDiscordIngressCutoverSnapshot,
  primeDiscordIngressCutoverPolicy,
  resolveDiscordIngressEffectivePolicy,
  setDiscordIngressRuntimePolicyOverride,
  type DiscordIngressEvidenceSource,
  type DiscordIngressExecutionOptions,
  type DiscordIngressRouteRequest,
  type DiscordIngressSurface,
} from '../discord/runtime/discordIngressAdapter';
import { evaluateGuildSloAndPersistAlerts, runAgentSloAlertLoopOnce } from '../services/agent/agentSloService';
import {
  executeEvalAutoPromoteLoop,
  executeRetrievalEvalLoop,
  executeRewardSignalLoop,
} from '../services/eval/evalMaintenanceControlService';
import { T_MEMORY_JOB_DEADLETTERS, T_SOURCES } from '../services/infra/tableRegistry';
import { evaluateIntents } from '../services/intent/intentFormationEngine';
import { runConsolidationCycle } from '../services/memory/memoryConsolidationService';
import { requeueDeadletterJob } from '../services/memory/memoryJobRunner';
import { executeObsidianGraphAudit, executeObsidianLoreSync } from '../services/obsidian/obsidianMaintenanceControlService';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import { getErrorMessage } from '../utils/errorMessage';
import { toStringParam } from '../utils/validation';

const validateBearer = (req: Request): boolean => {
  const token = SUPABASE_SERVICE_ROLE_KEY.trim();
  if (!token) return false;

  const authHeader = String(req.headers.authorization || '').trim();
  if (!/^Bearer\s+/i.test(authHeader)) return false;

  const incoming = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = Buffer.from(token);
  const received = Buffer.from(incoming);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
};

const requireAuth = (req: Request, res: Response): boolean => {
  if (!SUPABASE_SERVICE_ROLE_KEY && NODE_ENV !== 'production') return true;
  if (validateBearer(req)) return true;
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return false;
};

const normalizeGuildIds = (guildIds: Iterable<string>): string[] => {
  const normalized = Array.from(guildIds)
    .map((guildId) => String(guildId || '').trim())
    .filter(Boolean);
  return [...new Set(normalized)];
};

type DiscordIngressExerciseVerdict = 'pass' | 'fail' | 'pending';

type DiscordIngressExerciseSurfaceSummary = {
  verdict: DiscordIngressExerciseVerdict;
  reason: string;
  observedCount: number;
  selectedCount: number;
  selectedAdapterId: string | null;
  routeDecision: string | null;
};

type DiscordIngressExerciseSummary = {
  exercised: boolean;
  surfaces: Record<DiscordIngressSurface, DiscordIngressExerciseSurfaceSummary>;
  rollback: {
    verdict: DiscordIngressExerciseVerdict;
    reason: string;
    observedFallbacks: number;
    selectedAdapterId: string | null;
  };
};

const toOptionalBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
};

const toOptionalInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
};

const getDefaultDiscordIngressExecutionPolicy = (
  surface: DiscordIngressSurface,
): DiscordIngressExecutionOptions => {
  if (surface === 'docs-command') {
    return {
      preferredAdapterId: DISCORD_DOCS_INGRESS_ADAPTER,
      hardDisable: DISCORD_DOCS_INGRESS_HARD_DISABLE,
      shadowMode: DISCORD_DOCS_INGRESS_SHADOW_MODE,
      rolloutPercentage: DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
    };
  }

  return {
    preferredAdapterId: DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
    hardDisable: DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
    shadowMode: DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
    rolloutPercentage: DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  };
};

const syncDiscordIngressCutoverPolicies = (): void => {
  primeDiscordIngressCutoverPolicy('docs-command', getDefaultDiscordIngressExecutionPolicy('docs-command'));
  primeDiscordIngressCutoverPolicy('muel-message', getDefaultDiscordIngressExecutionPolicy('muel-message'));
};

const parseDiscordIngressPolicyUpdate = (value: unknown): {
  ok: boolean;
  clear?: boolean;
  update?: Partial<DiscordIngressExecutionOptions>;
  error?: string;
} => {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'policy update must be an object' };
  }

  const raw = value as Record<string, unknown>;
  const clear = toOptionalBoolean(raw.clear);
  if (raw.clear !== undefined && clear === null) {
    return { ok: false, error: 'clear must be boolean' };
  }
  if (clear === true) {
    return { ok: true, clear: true };
  }

  const update: Partial<DiscordIngressExecutionOptions> = {};
  let hasField = false;

  if ('preferredAdapterId' in raw || 'preferred_adapter_id' in raw) {
    update.preferredAdapterId = toStringParam(raw.preferredAdapterId ?? raw.preferred_adapter_id) || null;
    hasField = true;
  }

  if ('hardDisable' in raw || 'hard_disabled' in raw) {
    const hardDisable = toOptionalBoolean(raw.hardDisable ?? raw.hard_disabled);
    if (hardDisable === null) {
      return { ok: false, error: 'hardDisable must be boolean' };
    }
    update.hardDisable = hardDisable;
    hasField = true;
  }

  if ('shadowMode' in raw || 'shadow_mode' in raw) {
    const shadowMode = toOptionalBoolean(raw.shadowMode ?? raw.shadow_mode);
    if (shadowMode === null) {
      return { ok: false, error: 'shadowMode must be boolean' };
    }
    update.shadowMode = shadowMode;
    hasField = true;
  }

  if ('rolloutPercentage' in raw || 'rollout_percentage' in raw) {
    const rolloutPercentage = toOptionalInteger(raw.rolloutPercentage ?? raw.rollout_percentage);
    if (rolloutPercentage === null) {
      return { ok: false, error: 'rolloutPercentage must be integer' };
    }
    update.rolloutPercentage = rolloutPercentage;
    hasField = true;
  }

  if (!hasField) {
    return { ok: false, error: 'policy update requires at least one field' };
  }

  return { ok: true, update };
};

const resolveDiscordIngressPolicyUpdates = (body: Record<string, unknown>): {
  ok: boolean;
  updates?: Partial<Record<DiscordIngressSurface, Partial<DiscordIngressExecutionOptions> | null>>;
  error?: string;
} => {
  const policies = body.policies && typeof body.policies === 'object'
    ? body.policies as Record<string, unknown>
    : {};

  const rawUpdates: Partial<Record<DiscordIngressSurface, unknown>> = {
    'docs-command': policies['docs-command'] ?? policies.docsCommand ?? body.docs ?? body.docsCommand,
    'muel-message': policies['muel-message'] ?? policies.muelMessage ?? body.muelMessage ?? body.prefixed,
  };

  const updates: Partial<Record<DiscordIngressSurface, Partial<DiscordIngressExecutionOptions> | null>> = {};
  for (const surface of ['docs-command', 'muel-message'] as DiscordIngressSurface[]) {
    const rawValue = rawUpdates[surface];
    if (rawValue === undefined) {
      continue;
    }

    const parsed = parseDiscordIngressPolicyUpdate(rawValue);
    if (!parsed.ok) {
      return { ok: false, error: `${surface}: ${parsed.error}` };
    }

    updates[surface] = parsed.clear ? null : (parsed.update || {});
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'at least one surface policy update is required' };
  }

  return { ok: true, updates };
};

const buildDiscordIngressExerciseReason = (
  routeDecision: string | null,
  fallbackReason: string | null,
  evidenceSource: DiscordIngressEvidenceSource,
): string => {
  if (routeDecision === 'adapter_accept') {
    return `${evidenceSource}_selected_path_adapter_accept`;
  }
  if (routeDecision === 'shadow_only') {
    return `${evidenceSource}_selected_path_shadow_only`;
  }
  return `${evidenceSource}_selected_path_failed:${fallbackReason || 'unknown'}`;
};

const buildDiscordIngressExerciseRequest = (
  surface: DiscordIngressSurface,
  evidenceSource: DiscordIngressEvidenceSource,
  stage: 'selected' | 'rollback',
): DiscordIngressRouteRequest => ({
  request: `internal ${evidenceSource} cutover ${surface} ${stage} probe`,
  guildId: `internal-${evidenceSource}-guild`,
  userId: `internal-${surface}-operator`,
  channel: null,
  messageId: null,
  correlationId: `internal-${evidenceSource}-${surface}-${stage}`,
  entryLabel: surface === 'docs-command' ? '/해줘' : '뮤엘 메시지',
  surface,
  replyMode: surface === 'docs-command' ? 'private' : 'channel',
  tenantLane: 'operator-personal' as const,
});

const runDiscordIngressExercise = async (params: {
  evidenceSource: DiscordIngressEvidenceSource;
  includeRollback: boolean;
}): Promise<DiscordIngressExerciseSummary> => {
  syncDiscordIngressCutoverPolicies();

  const runSelectedSurface = async (
    surface: DiscordIngressSurface,
  ): Promise<DiscordIngressExerciseSurfaceSummary> => {
    const defaultPolicy = getDefaultDiscordIngressExecutionPolicy(surface);
    const effectivePolicy = resolveDiscordIngressEffectivePolicy(surface, defaultPolicy);
    const rolloutKey = findDiscordIngressRolloutKey(
      effectivePolicy.rolloutPercentage,
      true,
      `internal:${params.evidenceSource}:${surface}:selected`,
    );

    if (!rolloutKey) {
      return {
        verdict: 'pending',
        reason: `${params.evidenceSource}_selected_path_unavailable_for_rollout_${effectivePolicy.rolloutPercentage}`,
        observedCount: 0,
        selectedCount: 0,
        selectedAdapterId: effectivePolicy.preferredAdapterId,
        routeDecision: null,
      };
    }

    const execution = await executeDiscordIngress(
      buildDiscordIngressExerciseRequest(surface, params.evidenceSource, 'selected'),
      {
        ...defaultPolicy,
        rolloutKey,
        evidenceSource: params.evidenceSource,
      },
    );

    return {
      verdict: execution.telemetry.routeDecision === 'adapter_accept' || execution.telemetry.routeDecision === 'shadow_only'
        ? 'pass'
        : 'fail',
      reason: buildDiscordIngressExerciseReason(
        execution.telemetry.routeDecision,
        execution.telemetry.fallbackReason,
        params.evidenceSource,
      ),
      observedCount: 1,
      selectedCount: execution.telemetry.selectedByRollout ? 1 : 0,
      selectedAdapterId: execution.telemetry.adapterId || execution.telemetry.selectedAdapterId,
      routeDecision: execution.telemetry.routeDecision,
    };
  };

  const docsSurface = await runSelectedSurface('docs-command');
  const messageSurface = await runSelectedSurface('muel-message');

  if (!params.includeRollback) {
    return {
      exercised: true,
      surfaces: {
        'docs-command': docsSurface,
        'muel-message': messageSurface,
      },
      rollback: {
        verdict: 'pending',
        reason: 'rollback exercise skipped',
        observedFallbacks: 0,
        selectedAdapterId: null,
      },
    };
  }

  const rollbackDefaultPolicy = getDefaultDiscordIngressExecutionPolicy('docs-command');
  const rollbackEffectivePolicy = resolveDiscordIngressEffectivePolicy('docs-command', rollbackDefaultPolicy);
  const rollbackKey = findDiscordIngressRolloutKey(
    rollbackEffectivePolicy.rolloutPercentage,
    true,
    `internal:${params.evidenceSource}:docs-command:rollback`,
  );
  const rollbackExecution = await executeDiscordIngress(
    buildDiscordIngressExerciseRequest('docs-command', params.evidenceSource, 'rollback'),
    {
      ...rollbackDefaultPolicy,
      hardDisable: true,
      shadowMode: false,
      rolloutKey: rollbackKey || undefined,
      evidenceSource: params.evidenceSource,
      preferCallOverrides: true,
    },
  );

  return {
    exercised: true,
    surfaces: {
      'docs-command': docsSurface,
      'muel-message': messageSurface,
    },
    rollback: {
      verdict: rollbackExecution.telemetry.fallbackReason === 'hard_disabled' ? 'pass' : 'fail',
      reason: rollbackExecution.telemetry.fallbackReason === 'hard_disabled'
        ? `${params.evidenceSource} rollback rehearsal produced forced legacy fallback`
        : `${params.evidenceSource} rollback rehearsal failed (${rollbackExecution.telemetry.fallbackReason || 'unknown'})`,
      observedFallbacks: rollbackExecution.telemetry.fallbackReason === 'hard_disabled' ? 1 : 0,
      selectedAdapterId: rollbackExecution.telemetry.selectedAdapterId,
    },
  };
};

const listActiveGuildIds = async (): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(T_SOURCES)
    .select('guild_id')
    .eq('is_active', true)
    .not('guild_id', 'is', null)
    .limit(5000);

  if (error) {
    throw new Error(error.message || 'INTERNAL_GUILD_LIST_FAILED');
  }

  return normalizeGuildIds(
    ((data || []) as Array<Record<string, unknown>>).map((row) => String(row.guild_id || '').trim()),
  );
};

const resolveGuildIds = async (guildId: string | undefined): Promise<string[]> => {
  if (guildId) {
    return [guildId];
  }
  return listActiveGuildIds();
};

const handleInternalError = (res: Response, error: unknown) =>
  res.status(500).json({ ok: false, error: 'INTERNAL', message: getErrorMessage(error) });

const recoverPendingDeadletters = async () => {
  if (!isSupabaseConfigured()) {
    return { requeued: 0, processedDeadletters: 0 };
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(T_MEMORY_JOB_DEADLETTERS)
    .select('id')
    .eq('recovery_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(3);

  if (error) {
    throw new Error(error.message || 'MEMORY_DEADLETTER_RECOVERY_QUERY_FAILED');
  }

  let requeued = 0;
  const rows = (data || []) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const deadletterId = Number(row.id || 0);
    if (!Number.isFinite(deadletterId) || deadletterId <= 0) {
      continue;
    }
    await requeueDeadletterJob({ deadletterId, actorId: 'system:pg-cron' });
    requeued += 1;
  }

  return { requeued, processedDeadletters: rows.length };
};

export const createInternalRouter = (): Router => {
  const router = Router();

  router.get('/discord/ingress/cutover/snapshot', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      syncDiscordIngressCutoverPolicies();
      return res.json({ ok: true, snapshot: getDiscordIngressCutoverSnapshot() });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/discord/ingress/cutover/policy', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const parsed = resolveDiscordIngressPolicyUpdates((req.body || {}) as Record<string, unknown>);
    if (!parsed.ok || !parsed.updates) {
      return res.status(400).json({ ok: false, error: 'VALIDATION', message: parsed.error || 'invalid discord ingress cutover policy update' });
    }

    try {
      const appliedSurfaces: DiscordIngressSurface[] = [];
      for (const surface of ['docs-command', 'muel-message'] as DiscordIngressSurface[]) {
        if (!(surface in parsed.updates)) {
          continue;
        }

        setDiscordIngressRuntimePolicyOverride(surface, parsed.updates[surface] ?? null);
        appliedSurfaces.push(surface);
      }

      syncDiscordIngressCutoverPolicies();
      return res.status(202).json({
        ok: true,
        appliedSurfaces,
        snapshot: getDiscordIngressCutoverSnapshot(),
      });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/discord/ingress/cutover/exercise', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const evidenceSource = String(req.body?.evidenceSource || '').trim().toLowerCase() === 'lab'
      ? 'lab'
      : 'live';
    const includeRollback = toOptionalBoolean(req.body?.includeRollback) ?? true;

    try {
      const summary = await runDiscordIngressExercise({
        evidenceSource,
        includeRollback,
      });
      return res.status(202).json({
        ok: true,
        summary,
        snapshot: getDiscordIngressCutoverSnapshot(),
      });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/memory/consolidate', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      const result = await runConsolidationCycle(guildId);
      return res.status(202).json({ ok: true, guildId: guildId || null, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/memory/deadletter-recover', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const result = await recoverPendingDeadletters();
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/slo/check', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      if (guildId) {
        const result = await evaluateGuildSloAndPersistAlerts({ guildId, actorId: 'system:pg-cron' });
        return res.status(202).json({ ok: true, processedGuilds: 1, result });
      }

      const result = await runAgentSloAlertLoopOnce();
      return res.status(202).json({ ok: true, ...result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/obsidian/sync', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const result = await executeObsidianLoreSync();
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/obsidian/audit', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { result } = await executeObsidianGraphAudit();
      if (result.lastStatus !== 'success') {
        return res.status(500).json({ ok: false, error: 'OBSIDIAN_GRAPH_AUDIT_FAILED', result });
      }
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/eval/retrieval', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      const guildIds = await resolveGuildIds(guildId);
      const result = await executeRetrievalEvalLoop(guildIds);
      return res.status(202).json({ ok: true, processedGuilds: guildIds.length, guildIds, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/eval/reward-signal', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      const guildIds = await resolveGuildIds(guildId);
      const result = await executeRewardSignalLoop(guildIds);
      return res.status(202).json({ ok: true, processedGuilds: guildIds.length, guildIds, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/eval/auto-promote', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      const guildIds = await resolveGuildIds(guildId);
      const result = await executeEvalAutoPromoteLoop(guildIds);
      return res.status(202).json({ ok: true, processedGuilds: guildIds.length, guildIds, result });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  router.post('/intent/evaluate', async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const guildId = toStringParam(req.body?.guildId) || undefined;
      const guildIds = await resolveGuildIds(guildId);
      const createdByGuild = [] as Array<{ guildId: string; created: number }>;
      let created = 0;

      for (const currentGuildId of guildIds) {
        const intents = await evaluateIntents(currentGuildId);
        created += intents.length;
        createdByGuild.push({ guildId: currentGuildId, created: intents.length });
      }

      return res.status(202).json({ ok: true, processedGuilds: guildIds.length, created, createdByGuild });
    } catch (error) {
      return handleInternalError(res, error);
    }
  });

  return router;
};
import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { NODE_ENV, SUPABASE_SERVICE_ROLE_KEY } from '../config';
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
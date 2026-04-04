import logger from '../../logger';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { listApprovals } from './workerApprovalStore';
import { runWorkerGenerationPipeline } from './workerGenerationPipeline';
import { recordWorkerGenerationResult, getWorkerProposalMetricsSnapshot } from './workerProposalMetrics';
import { executeExternalAction } from '../tools/externalAdapterRegistry';
import { parseBooleanEnv } from '../../utils/env';
import { triggerLacunaSprintIfNeeded, type LacunaCandidate } from '../sprint/selfImprovementLoop';
import { getGuildActionPolicy, upsertGuildActionPolicy } from '../skills/actionGovernanceStore';
import { runWithConcurrency } from '../../utils/async';
import { getErrorMessage } from '../../discord/ui';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AUTO_WORKER_PROPOSAL_BACKGROUND_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_ENABLED || 'true').trim());
const AUTO_WORKER_PROPOSAL_BACKGROUND_INTERVAL_MS = Math.max(5 * 60_000, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_INTERVAL_MS || 30 * 60_000));
const AUTO_WORKER_PROPOSAL_BACKGROUND_LOOKBACK_DAYS = Math.max(1, Math.min(30, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_LOOKBACK_DAYS || 7)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_NO_REQUEST_HOURS = Math.max(1, Math.min(72, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_NO_REQUEST_HOURS || 6)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_MISSING_COUNT = Math.max(1, Math.min(20, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_MISSING_COUNT || 2)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_DISTINCT_REQUESTERS = Math.max(1, Math.min(10, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_DISTINCT_REQUESTERS || 1)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PROPOSALS_PER_RUN = Math.max(1, Math.min(10, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PROPOSALS_PER_RUN || 2)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PENDING_PER_GUILD = Math.max(1, Math.min(20, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PENDING_PER_GUILD || 5)));
const AUTO_WORKER_PROPOSAL_BACKGROUND_DUPLICATE_WINDOW_MS = Math.max(60_000, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_DUPLICATE_WINDOW_MS || 7 * 24 * 60 * 60_000));
const AUTO_WORKER_PROPOSAL_BACKGROUND_GUILD_COOLDOWN_MS = Math.max(60_000, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_GUILD_COOLDOWN_MS || 6 * 60 * 60_000));
const AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_GOAL_LENGTH = Math.max(6, Math.min(120, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_GOAL_LENGTH || 8)));
const IMPLEMENT_PILOT_POLICY_ENFORCE_CONCURRENCY = Math.max(1, Math.min(20, Number(process.env.IMPLEMENT_PILOT_POLICY_ENFORCE_CONCURRENCY || process.env.OPENCODE_PILOT_POLICY_ENFORCE_CONCURRENCY || 4)));

let autoWorkerProposalBackgroundTimer: NodeJS.Timeout | null = null;
let autoWorkerProposalBackgroundRunning = false;

// ---------------------------------------------------------------------------
// Auto-Proposal Promotion Gate
// ---------------------------------------------------------------------------

const normalizePromotionGoal = (input: string): string =>
  String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();

const toActionLogRow = (row: unknown): {
  requestedBy: string;
  goal: string;
  status: string;
  actionName: string;
  summary: string;
  artifacts: Array<Record<string, unknown>>;
} => {
  const raw = (row && typeof row === 'object' && !Array.isArray(row))
    ? row as Record<string, unknown>
    : {};
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];

  return {
    requestedBy: String(raw.requested_by || '').trim(),
    goal: String(raw.goal || '').trim(),
    status: String(raw.status || '').trim().toLowerCase(),
    actionName: String(raw.action_name || '').trim(),
    summary: String(raw.summary || '').trim(),
    artifacts,
  };
};

export const evaluateAutoProposalPromotionGate = async (params: {
  guildId: string;
  request: string;
  windowDays: number;
  minFrequency: number;
  minDistinctRequesters: number;
  minOutcomeScore: number;
  maxPolicyBlockRate: number;
}): Promise<{
  ok: boolean;
  frequency: number;
  distinctRequesters: number;
  avgOutcomeScore: number;
  policyBlockRate: number;
}> => {
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      frequency: params.minFrequency,
      distinctRequesters: params.minDistinctRequesters,
      avgOutcomeScore: 1,
      policyBlockRate: 0,
    };
  }

  const normalizedRequest = normalizePromotionGoal(params.request);
  if (!normalizedRequest) {
    return {
      ok: false,
      frequency: 0,
      distinctRequesters: 0,
      avgOutcomeScore: 0,
      policyBlockRate: 0,
    };
  }

  const sinceIso = new Date(Date.now() - params.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_action_logs')
    .select('requested_by, goal, status, action_name, summary, artifacts, created_at')
    .eq('guild_id', params.guildId)
    .in('action_name', ['task_routing_vibe', 'task_routing_docs', 'task_routing_feedback'])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    return {
      ok: false,
      frequency: 0,
      distinctRequesters: 0,
      avgOutcomeScore: 0,
      policyBlockRate: 1,
    };
  }

  const rows = (data || []).map((row) => toActionLogRow(row));
  const routingRows = rows.filter((row) => {
    if (row.actionName !== 'task_routing_vibe' && row.actionName !== 'task_routing_docs') {
      return false;
    }
    return normalizePromotionGoal(row.goal) === normalizedRequest;
  });

  const frequency = routingRows.length;
  const distinctRequesters = new Set(routingRows.map((row) => row.requestedBy).filter(Boolean)).size;

  const feedbackRows = rows.filter((row) => row.actionName === 'task_routing_feedback' && normalizePromotionGoal(row.goal) === normalizedRequest);
  const outcomeScores = feedbackRows
    .map((row) => Number(row.artifacts[0]?.outcomeScore))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(1, value)));

  const avgOutcomeScore = outcomeScores.length > 0
    ? outcomeScores.reduce((acc, value) => acc + value, 0) / outcomeScores.length
    : (routingRows.length > 0
      ? routingRows.filter((row) => row.status === 'success').length / routingRows.length
      : 0);

  const policyBlockedCount = feedbackRows.filter((row) => {
    const artifact = row.artifacts[0];
    const blockedByArtifact = Number(
      (artifact as Record<string, unknown> | undefined)?.policyBlocked
      ?? (artifact as Record<string, unknown> | undefined)?.policy_blocked
      ?? 0,
    );
    if (Number.isFinite(blockedByArtifact) && blockedByArtifact > 0) {
      return true;
    }

    const summary = String(row.summary || '').toLowerCase();
    return /policy[_\s-]?blocked\s*=\s*([1-9]\d*)/.test(summary)
      || (summary.includes('policy') && (summary.includes('block') || summary.includes('차단')));
  }).length;
  const policyBlockRate = feedbackRows.length > 0 ? policyBlockedCount / feedbackRows.length : 0;

  const ok = frequency >= params.minFrequency
    && distinctRequesters >= params.minDistinctRequesters
    && avgOutcomeScore >= params.minOutcomeScore
    && policyBlockRate <= params.maxPolicyBlockRate;

  return {
    ok,
    frequency,
    distinctRequesters,
    avgOutcomeScore,
    policyBlockRate,
  };
};

// ---------------------------------------------------------------------------
// Implement Approval Pilot
// ---------------------------------------------------------------------------

export const enforceImplementApprovalRequiredPilot = async (guildIds: string[]): Promise<void> => {
  if (guildIds.length === 0) {
    return;
  }

  let changed = 0;
  await runWithConcurrency(guildIds, async (guildId) => {
    try {
      const policy = await getGuildActionPolicy(guildId, 'opencode.execute');
      if (policy.enabled && policy.runMode === 'approval_required') {
        return;
      }

      await upsertGuildActionPolicy({
        guildId,
        actionName: 'opencode.execute',
        enabled: true,
        runMode: 'approval_required',
        actorId: 'system:implement-pilot',
      });
      changed += 1;
    } catch (error) {
      logger.warn('[IMPLEMENT-PILOT] policy enforce failed guild=%s reason=%s', guildId, getErrorMessage(error));
    }
  }, IMPLEMENT_PILOT_POLICY_ENFORCE_CONCURRENCY);

  if (changed > 0) {
    logger.info('[IMPLEMENT-PILOT] approval_required enforced guilds=%d', changed);
  }
};

// ---------------------------------------------------------------------------
// Background Proposal Sweep
// ---------------------------------------------------------------------------

const normalizeBackgroundProposalGoal = (goal: string): string =>
  String(goal || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

export const runBackgroundAutoWorkerProposalSweep = async (): Promise<void> => {
  if (!AUTO_WORKER_PROPOSAL_BACKGROUND_ENABLED || autoWorkerProposalBackgroundRunning) {
    return;
  }
  if (!isSupabaseConfigured()) {
    return;
  }

  autoWorkerProposalBackgroundRunning = true;
  try {
    const client = getSupabaseClient();
    const nowMs = Date.now();
    const lookbackSinceIso = new Date(nowMs - AUTO_WORKER_PROPOSAL_BACKGROUND_LOOKBACK_DAYS * 24 * 60 * 60_000).toISOString();
    const noRequestSinceIso = new Date(nowMs - AUTO_WORKER_PROPOSAL_BACKGROUND_NO_REQUEST_HOURS * 60 * 60_000).toISOString();
    const dedupSinceMs = nowMs - AUTO_WORKER_PROPOSAL_BACKGROUND_DUPLICATE_WINDOW_MS;

    const [missingRes, retryExhaustRes, recentRequestRes, allApprovals] = await Promise.all([
      client
        .from('agent_action_logs')
        .select('guild_id, requested_by, goal, action_name, error, created_at')
        .in('error', ['ACTION_NOT_IMPLEMENTED', 'DYNAMIC_WORKER_NOT_FOUND'])
        .gte('created_at', lookbackSinceIso)
        .order('created_at', { ascending: false })
        .limit(5000),
      client
        .from('agent_action_logs')
        .select('guild_id, requested_by, goal, action_name, error, retry_count, created_at')
        .eq('status', 'failed')
        .not('error', 'in', '("ACTION_NOT_IMPLEMENTED","DYNAMIC_WORKER_NOT_FOUND")')
        .gte('retry_count', 2)
        .gte('created_at', lookbackSinceIso)
        .order('created_at', { ascending: false })
        .limit(3000),
      client
        .from('agent_action_logs')
        .select('guild_id, created_at')
        .in('action_name', ['task_routing_vibe', 'task_routing_docs'])
        .gte('created_at', noRequestSinceIso)
        .order('created_at', { ascending: false })
        .limit(5000),
      listApprovals({ status: 'all' }),
    ]);

    if (missingRes.error) {
      throw new Error(missingRes.error.message || 'BACKGROUND_MISSING_ACTION_QUERY_FAILED');
    }
    if (retryExhaustRes.error) {
      logger.warn('[WORKER-GEN] retry-exhaust query failed: %s', retryExhaustRes.error.message);
    }
    if (recentRequestRes.error) {
      throw new Error(recentRequestRes.error.message || 'BACKGROUND_RECENT_REQUEST_QUERY_FAILED');
    }

    const recentRequestGuildIds = new Set(
      ((recentRequestRes.data || []) as Array<Record<string, unknown>>)
        .map((row) => String(row.guild_id || '').trim())
        .filter(Boolean),
    );

    const pendingCountByGuild = new Map<string, number>();
    const recentApprovalByGuild = new Map<string, number>();
    const recentGoalApprovalKeys = new Set<string>();
    for (const approval of allApprovals) {
      if (approval.status === 'pending') {
        pendingCountByGuild.set(approval.guildId, (pendingCountByGuild.get(approval.guildId) || 0) + 1);
      }

      const createdAtMs = Date.parse(approval.createdAt);
      if (Number.isFinite(createdAtMs) && createdAtMs >= dedupSinceMs) {
        const goalKey = `${approval.guildId}::${normalizeBackgroundProposalGoal(approval.goal)}`;
        recentGoalApprovalKeys.add(goalKey);

        const lastCreatedAtMs = recentApprovalByGuild.get(approval.guildId) || 0;
        if (createdAtMs > lastCreatedAtMs) {
          recentApprovalByGuild.set(approval.guildId, createdAtMs);
        }
      }
    }

    type LacunaType = 'missing_action' | 'retry_exhaustion' | 'external_failure';
    type LacunaGroup = {
      guildId: string;
      goal: string;
      normalizedGoal: string;
      count: number;
      distinctRequesters: Set<string>;
      lastSeenAtMs: number;
      missingActionNames: Set<string>;
      lacunaType: LacunaType;
      errorCodes: Set<string>;
    };
    const groups = new Map<string, LacunaGroup>();

    const upsertGroup = (
      row: Record<string, unknown>,
      lacunaType: LacunaType,
    ): void => {
      const guildId = String(row.guild_id || '').trim();
      if (!guildId || recentRequestGuildIds.has(guildId)) {
        return;
      }
      const goal = String(row.goal || '').trim();
      if (goal.length < AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_GOAL_LENGTH) {
        return;
      }
      const normalizedGoal = normalizeBackgroundProposalGoal(goal);
      if (!normalizedGoal) {
        return;
      }
      const key = `${guildId}::${normalizedGoal}`;
      const requestedBy = String(row.requested_by || '').trim();
      const createdAtMs = Date.parse(String(row.created_at || ''));
      const actionName = String(row.action_name || '').trim();
      const errorCode = String(row.error || '').trim();
      const existing = groups.get(key);

      if (!existing) {
        const distinctRequesters = new Set<string>();
        if (requestedBy) distinctRequesters.add(requestedBy);
        const missingActionNames = new Set<string>();
        if (actionName) missingActionNames.add(actionName);
        const errorCodes = new Set<string>();
        if (errorCode) errorCodes.add(errorCode);

        groups.set(key, {
          guildId,
          goal,
          normalizedGoal,
          count: 1,
          distinctRequesters,
          lastSeenAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
          missingActionNames,
          lacunaType,
          errorCodes,
        });
        return;
      }
      existing.count += 1;
      if (requestedBy) existing.distinctRequesters.add(requestedBy);
      if (actionName) existing.missingActionNames.add(actionName);
      if (errorCode) existing.errorCodes.add(errorCode);
      if (Number.isFinite(createdAtMs) && createdAtMs > existing.lastSeenAtMs) {
        existing.lastSeenAtMs = createdAtMs;
      }
      if (lacunaType === 'missing_action' && existing.lacunaType !== 'missing_action') {
        existing.lacunaType = lacunaType;
      }
    };

    for (const row of (missingRes.data || []) as Array<Record<string, unknown>>) {
      upsertGroup(row, 'missing_action');
    }
    for (const row of (retryExhaustRes.data || []) as Array<Record<string, unknown>>) {
      const errorCode = String(row.error || '').toUpperCase();
      const isExternal = errorCode.includes('WORKER') || errorCode.includes('MCP_') || errorCode === 'ACTION_TIMEOUT' || errorCode === 'WEB_FETCH_FAILED' || errorCode.startsWith('RSS_');
      upsertGroup(row, isExternal ? 'external_failure' : 'retry_exhaustion');
    }

    const metrics = getWorkerProposalMetricsSnapshot();
    const qualityGuardHit = metrics.generationRequested >= 6 && metrics.generationSuccessRate < 0.45;
    if (qualityGuardHit) {
      logger.warn('[WORKER-GEN] background sweep skipped by quality guard successRate=%.3f requested=%d', metrics.generationSuccessRate, metrics.generationRequested);
      return;
    }

    const lacunaTypeWeight = (type: LacunaType): number =>
      type === 'missing_action' ? 3 : type === 'retry_exhaustion' ? 2 : 1;

    const scoreLacunaCandidate = (g: LacunaGroup): number => {
      const recencyDays = Math.max(0.1, (nowMs - g.lastSeenAtMs) / (24 * 60 * 60_000));
      const recencyDecay = 1 / (1 + Math.log2(recencyDays));
      return g.count * g.distinctRequesters.size * lacunaTypeWeight(g.lacunaType) * recencyDecay;
    };

    const candidates = [...groups.values()]
      .filter((group) => group.count >= AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_MISSING_COUNT)
      .filter((group) => group.distinctRequesters.size >= AUTO_WORKER_PROPOSAL_BACKGROUND_MIN_DISTINCT_REQUESTERS)
      .filter((group) => !recentGoalApprovalKeys.has(`${group.guildId}::${group.normalizedGoal}`))
      .filter((group) => (pendingCountByGuild.get(group.guildId) || 0) < AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PENDING_PER_GUILD)
      .filter((group) => {
        const lastApprovalAtMs = recentApprovalByGuild.get(group.guildId) || 0;
        return lastApprovalAtMs <= 0 || (nowMs - lastApprovalAtMs) >= AUTO_WORKER_PROPOSAL_BACKGROUND_GUILD_COOLDOWN_MS;
      })
      .sort((a, b) => scoreLacunaCandidate(b) - scoreLacunaCandidate(a))
      .slice(0, AUTO_WORKER_PROPOSAL_BACKGROUND_MAX_PROPOSALS_PER_RUN);

    if (candidates.length === 0) {
      logger.info('[WORKER-GEN] background sweep no candidates (no-request window=%dh)', AUTO_WORKER_PROPOSAL_BACKGROUND_NO_REQUEST_HOURS);
      return;
    }

    let generated = 0;
    for (const candidate of candidates) {
      const errorContext = [...candidate.errorCodes].slice(0, 5).join(',');
      const requestText = `${candidate.goal}\n\n[auto-proposal:${candidate.lacunaType} count=${candidate.count}, distinct_requesters=${candidate.distinctRequesters.size}, actions=${[...candidate.missingActionNames].slice(0, 5).join(',')}, errors=${errorContext}, score=${scoreLacunaCandidate(candidate).toFixed(1)}]`;
      const result = await runWorkerGenerationPipeline({
        goal: requestText,
        guildId: candidate.guildId,
        requestedBy: 'system:auto-proposal-background',
      });

      recordWorkerGenerationResult(result.ok, result.ok ? undefined : result.error);
      if (result.ok) {
        generated += 1;

        if (parseBooleanEnv(process.env.OPENCLAW_LACUNA_SKILL_CREATE_ENABLED, false)) {
          const rawName = [...candidate.missingActionNames][0]?.replace(/[^a-zA-Z0-9_-]/g, '_') || '';
          const skillName = rawName.slice(0, 100);
          if (skillName) {
            executeExternalAction('openclaw', 'agent.skill.create', { name: skillName })
              .then((r) => {
                if (r.ok) {
                  logger.info('[WORKER-GEN] OpenClaw skill.create triggered for lacuna=%s', skillName);
                  if (isSupabaseConfigured()) {
                    getSupabaseClient().from('agent_action_logs').insert({
                      guild_id: candidate.guildId || null,
                      action_name: 'openclaw.skill.create',
                      goal: `lacuna:${skillName}`,
                      result_ok: true,
                      created_at: new Date().toISOString(),
                    }).then(() => {}, () => {});
                  }
                } else {
                  logger.debug('[WORKER-GEN] OpenClaw skill.create failed for lacuna=%s: %s', skillName, r.error);
                }
              })
              .catch(() => { /* non-blocking */ });
          }
        }
      }
    }

    logger.info('[WORKER-GEN] background sweep completed generated=%d candidates=%d', generated, candidates.length);

    if (candidates.length > 0) {
      const lacunaCandidates: LacunaCandidate[] = candidates.map((c) => ({
        guildId: c.guildId,
        goal: c.goal,
        normalizedGoal: c.normalizedGoal,
        count: c.count,
        distinctRequestersSize: c.distinctRequesters.size,
        score: scoreLacunaCandidate(c),
        lacunaType: c.lacunaType,
        missingActionNames: [...c.missingActionNames].slice(0, 10),
      }));
      triggerLacunaSprintIfNeeded(lacunaCandidates).catch(() => { /* non-blocking */ });
    }
  } catch (error) {
    logger.warn('[WORKER-GEN] background sweep failed: %s', getErrorMessage(error));
  } finally {
    autoWorkerProposalBackgroundRunning = false;
  }
};

export const startAutoWorkerProposalBackgroundLoop = (): void => {
  if (!AUTO_WORKER_PROPOSAL_BACKGROUND_ENABLED) {
    return;
  }

  if (autoWorkerProposalBackgroundTimer) {
    clearInterval(autoWorkerProposalBackgroundTimer);
    autoWorkerProposalBackgroundTimer = null;
  }

  void runBackgroundAutoWorkerProposalSweep();
  autoWorkerProposalBackgroundTimer = setInterval(() => {
    void runBackgroundAutoWorkerProposalSweep();
  }, AUTO_WORKER_PROPOSAL_BACKGROUND_INTERVAL_MS);
  autoWorkerProposalBackgroundTimer.unref();
};

/**
 * Trust Score Service — computes and caches guild×category trust scores.
 *
 * Trust scores determine the maximum autonomy level permitted for a
 * sprint category. Based on historical sprint success, rollback rate,
 * and scope compliance.
 *
 * Score formula:
 *   trust = successRate×0.35 + rollbackRateInv×0.20 + scopeCompliance×0.15
 *         + reviewQuality×0.15 + ageDecay×0.15
 *
 * Thresholds (configurable via env):
 *   - bugfix trust ≥ TRUST_BUGFIX_THRESHOLD  → full-auto allowed
 *   - feature trust ≥ TRUST_FEATURE_THRESHOLD → full-auto allowed
 *   - Hard cap: TRUST_MAX_AUTONOMY_LEVEL (never exceeds this)
 */

import logger from '../../logger';
import {
  TRUST_ENGINE_ENABLED,
  TRUST_MAX_AUTONOMY_LEVEL,
  TRUST_BUGFIX_THRESHOLD,
  TRUST_FEATURE_THRESHOLD,
  TRUST_DEFAULT_SCORE,
  TRUST_CACHE_TTL_MS,
  TRUST_DECAY_DAILY_RATE,
  TRUST_DECAY_INACTIVE_DAYS,
  TRUST_LOOP_BREAKER_ENABLED,
} from '../../config';
import { isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_SPRINT_PIPELINES, T_AGENT_TRUST_SCORES } from '../infra/tableRegistry';
import type { AutonomyLevel } from './sprintOrchestrator';
import { getErrorMessage } from '../../utils/errorMessage';

// ── Types ───────────────────────────────────────────────────────────────────

export type TrustCategory = 'bugfix' | 'feature' | 'maintenance' | 'qa';

export type TrustFactors = {
  successRate: number;
  rollbackRateInv: number;
  scopeCompliance: number;
  reviewQuality: number;
  ageDecay: number;
};

export type TrustScore = {
  guildId: string;
  category: TrustCategory;
  score: number;
  factors: TrustFactors;
  computedAt: string;
};

// ── In-memory cache ─────────────────────────────────────────────────────────

const cache = new Map<string, { score: TrustScore; expiresAt: number }>();

function cacheKey(guildId: string, category: TrustCategory): string {
  return `${guildId}:${category}`;
}

// ── Autonomy ordering ───────────────────────────────────────────────────────

const AUTONOMY_ORDER: AutonomyLevel[] = ['manual', 'approve-impl', 'approve-ship', 'full-auto'];

function autonomyIndex(level: AutonomyLevel): number {
  return AUTONOMY_ORDER.indexOf(level);
}

function cappedAutonomy(requested: AutonomyLevel): AutonomyLevel {
  const maxIdx = autonomyIndex(TRUST_MAX_AUTONOMY_LEVEL as AutonomyLevel);
  const reqIdx = autonomyIndex(requested);
  return reqIdx <= maxIdx ? requested : TRUST_MAX_AUTONOMY_LEVEL as AutonomyLevel;
}

// ── Core Computation ────────────────────────────────────────────────────────

/**
 * Compute trust score for a guild×category pair from sprint history.
 */
export async function computeTrustScore(
  guildId: string,
  category: TrustCategory,
): Promise<TrustScore> {
  const defaultFactors: TrustFactors = {
    successRate: TRUST_DEFAULT_SCORE,
    rollbackRateInv: 1,
    scopeCompliance: TRUST_DEFAULT_SCORE,
    reviewQuality: TRUST_DEFAULT_SCORE,
    ageDecay: 1,
  };

  if (!isSupabaseConfigured()) {
    return {
      guildId,
      category,
      score: TRUST_DEFAULT_SCORE,
      factors: defaultFactors,
      computedAt: new Date().toISOString(),
    };
  }

  try {
    const sb = getClient()!;

    // Fetch recent sprint pipelines for this guild (last 90 days)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: sprints, error } = await sb
      .from(T_SPRINT_PIPELINES)
      .select('status, trigger_type, rollback_plan, changed_files, created_at, completed_at')
      .eq('guild_id', guildId)
      .gt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !sprints || sprints.length === 0) {
      return {
        guildId,
        category,
        score: TRUST_DEFAULT_SCORE,
        factors: defaultFactors,
        computedAt: new Date().toISOString(),
      };
    }

    // Filter by category mapping
    const categoryTriggers = getCategoryTriggerTypes(category);
    const relevant = sprints.filter((s: Record<string, unknown>) =>
      categoryTriggers.includes((s.trigger_type as string) ?? ''),
    );

    if (relevant.length === 0) {
      return {
        guildId,
        category,
        score: TRUST_DEFAULT_SCORE,
        factors: defaultFactors,
        computedAt: new Date().toISOString(),
      };
    }

    // Calculate factors
    const completed = relevant.filter((s: Record<string, unknown>) => s.status === 'complete');
    const failed = relevant.filter((s: Record<string, unknown>) =>
      s.status === 'cancelled' || s.status === 'blocked',
    );
    const hadRollback = relevant.filter((s: Record<string, unknown>) =>
      typeof s.rollback_plan === 'string' && (s.rollback_plan as string).includes('reverted'),
    );

    const successRate = relevant.length > 0 ? completed.length / relevant.length : TRUST_DEFAULT_SCORE;
    const rollbackRate = relevant.length > 0 ? hadRollback.length / relevant.length : 0;
    const rollbackRateInv = 1 - rollbackRate;

    // Scope compliance: approximate by checking changed_files count < 20
    const scopeCompliant = completed.filter((s: Record<string, unknown>) => {
      const files = s.changed_files;
      return Array.isArray(files) ? files.length <= 20 : true;
    });
    const scopeCompliance = completed.length > 0 ? scopeCompliant.length / completed.length : TRUST_DEFAULT_SCORE;

    // Review quality: approximate from completion time (completed in < 1 hour = higher quality)
    const fastCompleted = completed.filter((s: Record<string, unknown>) => {
      if (!s.completed_at || !s.created_at) return false;
      const duration = new Date(s.completed_at as string).getTime() - new Date(s.created_at as string).getTime();
      return duration < 60 * 60 * 1000; // < 1 hour
    });
    const reviewQuality = completed.length > 0 ? fastCompleted.length / completed.length : TRUST_DEFAULT_SCORE;

    // Age decay: more recent sprints get higher weight (simple recency bias)
    const latestSprint = relevant[0] as Record<string, unknown>;
    const daysSinceLast = (Date.now() - new Date(latestSprint.created_at as string).getTime()) / (24 * 60 * 60 * 1000);
    const ageDecay = Math.max(0.3, 1 - daysSinceLast / 90);

    const factors: TrustFactors = {
      successRate,
      rollbackRateInv,
      scopeCompliance,
      reviewQuality,
      ageDecay,
    };

    const score =
      factors.successRate * 0.35 +
      factors.rollbackRateInv * 0.20 +
      factors.scopeCompliance * 0.15 +
      factors.reviewQuality * 0.15 +
      factors.ageDecay * 0.15;

    const result: TrustScore = {
      guildId,
      category,
      score: Math.max(0, Math.min(1, score)),
      factors,
      computedAt: new Date().toISOString(),
    };

    // Persist score to history table
    void persistTrustScore(result).catch(() => {});

    return result;
  } catch (err) {
    logger.debug('[TRUST] compute error for %s/%s: %s', guildId, category, getErrorMessage(err));
    return {
      guildId,
      category,
      score: TRUST_DEFAULT_SCORE,
      factors: defaultFactors,
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get or compute trust score with caching.
 */
export async function getTrustScore(
  guildId: string,
  category: TrustCategory,
): Promise<TrustScore> {
  const key = cacheKey(guildId, category);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.score;
  }

  const score = await computeTrustScore(guildId, category);
  cache.set(key, { score, expiresAt: Date.now() + TRUST_CACHE_TTL_MS });
  return score;
}

/**
 * Resolve the effective autonomy level for a sprint based on trust.
 *
 * @param guildId - The guild
 * @param category - Sprint category (bugfix, feature, etc.)
 * @param requestedLevel - The autonomy level explicitly requested (if any)
 * @returns The effective AutonomyLevel, capped by trust and hard cap
 */
export async function resolveTrustBasedAutonomy(
  guildId: string,
  category: TrustCategory,
  requestedLevel?: AutonomyLevel,
): Promise<AutonomyLevel> {
  if (!TRUST_ENGINE_ENABLED) {
    // Trust engine disabled — use requested level as-is (or default)
    return requestedLevel ?? 'approve-impl';
  }

  const trust = await getTrustScore(guildId, category);
  const threshold = category === 'bugfix' || category === 'qa'
    ? TRUST_BUGFIX_THRESHOLD
    : TRUST_FEATURE_THRESHOLD;

  let effective: AutonomyLevel;
  if (trust.score >= threshold) {
    effective = 'full-auto';
  } else if (trust.score >= 0.5) {
    effective = 'approve-ship';
  } else if (trust.score >= 0.2) {
    effective = 'approve-impl';
  } else {
    effective = 'manual';
  }

  // If a specific level was requested, use the more restrictive of requested vs trust-derived
  if (requestedLevel) {
    const reqIdx = autonomyIndex(requestedLevel);
    const effIdx = autonomyIndex(effective);
    effective = reqIdx < effIdx ? requestedLevel : effective;
  }

  // Apply hard cap
  return cappedAutonomy(effective);
}

/**
 * Invalidate cache and demote trust after a rollback event.
 */
export function demoteTrustOnRollback(guildId: string, category: TrustCategory): void {
  const key = cacheKey(guildId, category);
  cache.delete(key);
  logger.info('[TRUST] cache invalidated for %s/%s due to rollback', guildId, category);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getCategoryTriggerTypes(category: TrustCategory): string[] {
  switch (category) {
    case 'bugfix':
      return ['error-detection', 'cs-ticket'];
    case 'feature':
      return ['feature-request', 'self-improvement'];
    case 'maintenance':
      return ['scheduled', 'observation'];
    case 'qa':
      return ['self-improvement'];
    default:
      return [];
  }
}

async function persistTrustScore(score: TrustScore): Promise<void> {
  const qb = fromTable(T_AGENT_TRUST_SCORES);
  if (!qb) return;

  try {
    await qb.insert({
      guild_id: score.guildId,
      category: score.category,
      score: score.score,
      factors: score.factors,
      computed_at: score.computedAt,
    });
  } catch {
    // Best-effort
  }
}

/** Clear cache (for testing) */
export function __resetTrustCacheForTests(): void {
  cache.clear();
  loopCounters.clear();
}

// ── Loop Breaker (Phase H) ──────────────────────────────────────────────────
//
// 3-stage recovery for sprint phase looping:
//   Stage 1 (loopCount ≥ 3): bump temperature by +0.2 → retry
//   Stage 2 (loopCount ≥ 5): switch strategy from current to 'least-to-most'
//   Stage 3 (loopCount ≥ 7): mark sprint as 'blocked', stop execution
//
// Consumed by signalBusWiring on 'workflow.phase.looping' signal.

const loopCounters = new Map<string, number>();

export type LoopBreakerAction = {
  stage: 1 | 2 | 3;
  action: 'bump-temperature' | 'switch-strategy' | 'block-sprint';
  temperatureDelta?: number;
  newStrategy?: string;
  shouldBlock: boolean;
};

/**
 * Evaluate loop breaker action for a sprint that is looping between phases.
 * Returns the recommended recovery action based on cumulative loop count.
 */
export function evaluateLoopBreaker(sprintId: string, loopCount?: number): LoopBreakerAction {
  const prev = loopCounters.get(sprintId) ?? 0;
  const count = loopCount ?? prev + 1;
  loopCounters.set(sprintId, count);

  if (count >= 7) {
    return { stage: 3, action: 'block-sprint', shouldBlock: true };
  }
  if (count >= 5) {
    return { stage: 2, action: 'switch-strategy', newStrategy: 'least-to-most', shouldBlock: false };
  }
  return { stage: 1, action: 'bump-temperature', temperatureDelta: 0.2, shouldBlock: false };
}

/**
 * Check if loop breaker feature is enabled.
 */
export function isLoopBreakerEnabled(): boolean {
  return TRUST_LOOP_BREAKER_ENABLED;
}

// ── Trust Decay (Phase H) ───────────────────────────────────────────────────
//
// Decays trust scores for guilds that haven't run sprints recently.
// Logic: If no sprint in the last TRUST_DECAY_INACTIVE_DAYS, reduce score
//        by TRUST_DECAY_DAILY_RATE per day of inactivity (min 0.1).
// Runs as a daily timer from bootstrapServerInfra.

export const TRUST_DECAY_INTERVAL_MS = 24 * 60 * 60_000; // 24 hours

let decayTimerId: ReturnType<typeof setInterval> | null = null;

/**
 * Run a single trust decay cycle across all guilds with trust scores.
 * Reads the most recent sprint per guild and decays if inactive.
 */
export async function runTrustDecayCycle(): Promise<{ decayed: number; skipped: number }> {
  if (!TRUST_ENGINE_ENABLED || !isSupabaseConfigured()) {
    return { decayed: 0, skipped: 0 };
  }

  const sb = getClient()!;
  let decayed = 0;
  let skipped = 0;

  try {
    // Get distinct guild×category pairs with trust scores
    const { data: scores, error } = await sb
      .from(T_AGENT_TRUST_SCORES)
      .select('guild_id, category, score, computed_at')
      .order('computed_at', { ascending: false });

    if (error || !scores || scores.length === 0) {
      return { decayed: 0, skipped: 0 };
    }

    // Deduplicate: latest per guild×category
    const latest = new Map<string, { guild_id: string; category: string; score: number; computed_at: string }>();
    for (const row of scores as Array<{ guild_id: string; category: string; score: number; computed_at: string }>) {
      const key = `${row.guild_id}:${row.category}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    const cutoff = new Date(Date.now() - TRUST_DECAY_INACTIVE_DAYS * 24 * 60 * 60_000).toISOString();

    for (const [, row] of latest) {
      // Check most recent sprint for this guild
      const { data: recentSprints } = await sb
        .from(T_SPRINT_PIPELINES)
        .select('created_at')
        .eq('guild_id', row.guild_id)
        .gt('created_at', cutoff)
        .limit(1);

      if (recentSprints && recentSprints.length > 0) {
        skipped++;
        continue;
      }

      // No recent sprints → decay
      const daysSinceComputed = Math.max(1, (Date.now() - new Date(row.computed_at).getTime()) / (24 * 60 * 60_000));
      const decayAmount = TRUST_DECAY_DAILY_RATE * Math.min(daysSinceComputed, 30); // cap at 30 days of decay
      const newScore = Math.max(0.1, row.score - decayAmount);

      if (newScore < row.score) {
        const qb = fromTable(T_AGENT_TRUST_SCORES);
        if (qb) {
          await qb.insert({
            guild_id: row.guild_id,
            category: row.category,
            score: newScore,
            factors: { decayApplied: true, decayAmount, previousScore: row.score },
            computed_at: new Date().toISOString(),
          });
        }
        // Invalidate cache
        cache.delete(cacheKey(row.guild_id, row.category as TrustCategory));
        decayed++;
        logger.debug('[TRUST-DECAY] %s/%s: %.3f → %.3f (inactive %d days)',
          row.guild_id, row.category, row.score, newScore, Math.round(daysSinceComputed));
      } else {
        skipped++;
      }
    }
  } catch (err) {
    logger.debug('[TRUST-DECAY] cycle error: %s', getErrorMessage(err));
  }

  return { decayed, skipped };
}

/**
 * Start the daily trust decay timer.
 */
export function startTrustDecayTimer(): void {
  if (decayTimerId) return;
  if (!TRUST_ENGINE_ENABLED) {
    logger.debug('[TRUST-DECAY] disabled (TRUST_ENGINE_ENABLED=false)');
    return;
  }
  logger.info('[TRUST-DECAY] started (interval=%dh, decayRate=%.3f/day, inactiveDays=%d)',
    TRUST_DECAY_INTERVAL_MS / 3_600_000, TRUST_DECAY_DAILY_RATE, TRUST_DECAY_INACTIVE_DAYS);

  decayTimerId = setInterval(() => {
    void runTrustDecayCycle().catch((err: unknown) => {
      logger.debug('[TRUST-DECAY] cycle failed: %s', getErrorMessage(err));
    });
  }, TRUST_DECAY_INTERVAL_MS);
}

/**
 * Stop the trust decay timer (for graceful shutdown or testing).
 */
export function stopTrustDecayTimer(): void {
  if (decayTimerId) {
    clearInterval(decayTimerId);
    decayTimerId = null;
  }
}

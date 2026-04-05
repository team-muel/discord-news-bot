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
} from '../../config';
import { isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_SPRINT_PIPELINES, T_AGENT_TRUST_SCORES } from '../infra/tableRegistry';
import type { AutonomyLevel } from './sprintOrchestrator';

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
    logger.debug('[TRUST] compute error for %s/%s: %s', guildId, category, err instanceof Error ? err.message : String(err));
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
}

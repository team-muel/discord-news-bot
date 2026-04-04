/**
 * Eval Auto-Promote Loop Service
 *
 * Periodically runs the A/B eval pipeline for all active guilds:
 * collect samples, judge pending runs, and auto-promote/reject.
 */

import type { Client } from 'discord.js';
import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { runEvalPipeline } from './evalAutoPromoteService';

const EVAL_LOOP_ENABLED = parseBooleanEnv(process.env.EVAL_AUTO_PROMOTE_LOOP_ENABLED, true);
const EVAL_LOOP_INTERVAL_HOURS = Math.max(1, parseIntegerEnv(process.env.EVAL_AUTO_PROMOTE_LOOP_INTERVAL_HOURS, 6));
const EVAL_LOOP_RUN_ON_START = parseBooleanEnv(process.env.EVAL_AUTO_PROMOTE_LOOP_RUN_ON_START, false);
const EVAL_LOOP_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.EVAL_AUTO_PROMOTE_LOOP_MAX_GUILDS, 30));
const EVAL_LOOP_CONCURRENCY = Math.max(1, parseIntegerEnv(process.env.EVAL_AUTO_PROMOTE_LOOP_CONCURRENCY, 4));

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastSummary: string | null = null;

type LoopStats = {
  attemptedGuilds: number;
  completedGuilds: number;
  failedGuilds: number;
  totalCollected: number;
  totalJudged: number;
  totalPromoted: number;
  totalRejected: number;
};

const runOnce = async (client: Client): Promise<LoopStats> => {
  if (running) {
    return {
      attemptedGuilds: 0, completedGuilds: 0, failedGuilds: 0,
      totalCollected: 0, totalJudged: 0, totalPromoted: 0, totalRejected: 0,
    };
  }

  running = true;
  lastRunAt = new Date().toISOString();

  const stats: LoopStats = {
    attemptedGuilds: 0,
    completedGuilds: 0,
    failedGuilds: 0,
    totalCollected: 0,
    totalJudged: 0,
    totalPromoted: 0,
    totalRejected: 0,
  };

  try {
    const guildIds = [...client.guilds.cache.keys()].slice(0, EVAL_LOOP_MAX_GUILDS);
    stats.attemptedGuilds = guildIds.length;

    // Process guilds in concurrent batches
    for (let i = 0; i < guildIds.length; i += EVAL_LOOP_CONCURRENCY) {
      const batch = guildIds.slice(i, i + EVAL_LOOP_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (guildId) => {
          const pipelineResult = await runEvalPipeline(guildId);
          return { ...pipelineResult, guildId };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          stats.totalCollected += result.value.collected;
          stats.totalJudged += result.value.judged;
          stats.totalPromoted += result.value.promoted.length;
          stats.totalRejected += result.value.rejected.length;
          stats.completedGuilds += 1;

          // Signal bus: emit promotion outcomes
          try {
            const { emitSignal } = await import('../runtime/signalBus');
            for (const name of result.value.rejected) {
              emitSignal('eval.promotion.failed', 'evalAutoPromoteLoop', result.value.guildId, { evalName: name, verdict: 'reject' });
            }
            for (const name of result.value.promoted) {
              emitSignal('eval.promotion.succeeded', 'evalAutoPromoteLoop', result.value.guildId, { evalName: name, verdict: 'promote' });
            }
          } catch {
            // Best-effort
          }
        } else {
          stats.failedGuilds += 1;
          logger.warn(
            '[EVAL-PROMOTE-LOOP] guild run failed error=%s',
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        }
      }
    }
  } finally {
    running = false;
    lastSummary = `guilds=${stats.completedGuilds}/${stats.attemptedGuilds} collected=${stats.totalCollected} judged=${stats.totalJudged} promoted=${stats.totalPromoted} rejected=${stats.totalRejected}`;
    logger.info('[EVAL-PROMOTE-LOOP] completed: %s', lastSummary);
  }

  return stats;
};

export const startEvalAutoPromoteLoop = (client: Client): void => {
  if (!EVAL_LOOP_ENABLED || timer) {
    return;
  }

  const intervalMs = EVAL_LOOP_INTERVAL_HOURS * 60 * 60 * 1000;
  timer = setInterval(() => {
    void runOnce(client).catch((err) => logger.error('[EVAL-PROMOTE-LOOP] unhandled error: %s', err instanceof Error ? err.message : String(err)));
  }, intervalMs);
  timer.unref();

  if (EVAL_LOOP_RUN_ON_START) {
    void runOnce(client).catch((err) => logger.error('[EVAL-PROMOTE-LOOP] unhandled error: %s', err instanceof Error ? err.message : String(err)));
  }

  logger.info(
    '[EVAL-PROMOTE-LOOP] started intervalHours=%d runOnStart=%s maxGuilds=%d',
    EVAL_LOOP_INTERVAL_HOURS,
    String(EVAL_LOOP_RUN_ON_START),
    EVAL_LOOP_MAX_GUILDS,
  );
};

export const stopEvalAutoPromoteLoop = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const getEvalAutoPromoteLoopStatus = (): {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastSummary: string | null;
  intervalHours: number;
} => ({
  enabled: EVAL_LOOP_ENABLED,
  running,
  lastRunAt,
  lastSummary,
  intervalHours: EVAL_LOOP_INTERVAL_HOURS,
});

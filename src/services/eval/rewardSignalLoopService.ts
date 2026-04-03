/**
 * Reward Signal Loop Service
 *
 * Periodically computes and persists reward snapshots for all active guilds.
 * Mirrors the retrievalEvalLoopService pattern.
 */

import type { Client } from 'discord.js';
import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { computeRewardSnapshot, persistRewardSnapshot } from './rewardSignalService';

const REWARD_LOOP_ENABLED = parseBooleanEnv(process.env.REWARD_SIGNAL_LOOP_ENABLED, true);
const REWARD_LOOP_INTERVAL_HOURS = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_INTERVAL_HOURS, 6));
const REWARD_LOOP_RUN_ON_START = parseBooleanEnv(process.env.REWARD_SIGNAL_LOOP_RUN_ON_START, false);
const REWARD_LOOP_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_MAX_GUILDS, 30));
const REWARD_LOOP_CONCURRENCY = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_CONCURRENCY, 4));

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastSummary: string | null = null;

type LoopStats = {
  attemptedGuilds: number;
  completedGuilds: number;
  failedGuilds: number;
};

const runOnce = async (client: Client): Promise<LoopStats> => {
  if (running) {
    return { attemptedGuilds: 0, completedGuilds: 0, failedGuilds: 0 };
  }

  running = true;
  lastRunAt = new Date().toISOString();

  const stats: LoopStats = {
    attemptedGuilds: 0,
    completedGuilds: 0,
    failedGuilds: 0,
  };

  try {
    const guildIds = [...client.guilds.cache.keys()].slice(0, REWARD_LOOP_MAX_GUILDS);
    stats.attemptedGuilds = guildIds.length;

    // Process guilds in concurrent batches
    for (let i = 0; i < guildIds.length; i += REWARD_LOOP_CONCURRENCY) {
      const batch = guildIds.slice(i, i + REWARD_LOOP_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (guildId) => {
          const snapshot = await computeRewardSnapshot(guildId);
          if (snapshot) {
            await persistRewardSnapshot(snapshot);
            return true;
          }
          return false;
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          stats.completedGuilds += 1;
        } else if (result.status === 'rejected') {
          stats.failedGuilds += 1;
          logger.warn(
            '[REWARD-SIGNAL-LOOP] guild run failed error=%s',
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        }
        // fulfilled with false = guild skipped (Supabase not configured, etc.) — not counted as failure
      }
    }
  } finally {
    running = false;
    lastSummary = `attempted=${stats.attemptedGuilds} completed=${stats.completedGuilds} failed=${stats.failedGuilds}`;
    logger.info('[REWARD-SIGNAL-LOOP] completed: %s', lastSummary);
  }

  return stats;
};

export const startRewardSignalLoop = (client: Client): void => {
  if (!REWARD_LOOP_ENABLED || timer) {
    return;
  }

  const intervalMs = REWARD_LOOP_INTERVAL_HOURS * 60 * 60 * 1000;
  timer = setInterval(() => {
    void runOnce(client).catch((err) => logger.error('[REWARD-SIGNAL-LOOP] unhandled error: %s', err instanceof Error ? err.message : String(err)));
  }, intervalMs);
  timer.unref();

  if (REWARD_LOOP_RUN_ON_START) {
    void runOnce(client).catch((err) => logger.error('[REWARD-SIGNAL-LOOP] unhandled error: %s', err instanceof Error ? err.message : String(err)));
  }

  logger.info(
    '[REWARD-SIGNAL-LOOP] started intervalHours=%d runOnStart=%s maxGuilds=%d',
    REWARD_LOOP_INTERVAL_HOURS,
    String(REWARD_LOOP_RUN_ON_START),
    REWARD_LOOP_MAX_GUILDS,
  );
};

export const stopRewardSignalLoop = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const getRewardSignalLoopStatus = (): {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastSummary: string | null;
  intervalHours: number;
} => ({
  enabled: REWARD_LOOP_ENABLED,
  running,
  lastRunAt,
  lastSummary,
  intervalHours: REWARD_LOOP_INTERVAL_HOURS,
});

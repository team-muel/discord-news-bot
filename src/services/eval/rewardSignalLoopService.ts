/**
 * Reward Signal Loop Service
 *
 * Periodically computes and persists reward snapshots for all active guilds.
 * Mirrors the retrievalEvalLoopService pattern.
 */

import type { Client } from 'discord.js';
import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { BackgroundLoop } from '../../utils/backgroundLoop';
import { computeRewardSnapshot, persistRewardSnapshot } from './rewardSignalService';
import { getErrorMessage } from '../../utils/errorMessage';

const REWARD_LOOP_ENABLED = parseBooleanEnv(process.env.REWARD_SIGNAL_LOOP_ENABLED, true);
const REWARD_LOOP_INTERVAL_HOURS = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_INTERVAL_HOURS, 6));
const REWARD_LOOP_RUN_ON_START = parseBooleanEnv(process.env.REWARD_SIGNAL_LOOP_RUN_ON_START, false);
const REWARD_LOOP_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_MAX_GUILDS, 30));
const REWARD_LOOP_CONCURRENCY = Math.max(1, parseIntegerEnv(process.env.REWARD_SIGNAL_LOOP_CONCURRENCY, 4));

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

            // Signal bus: emit reward trend for downstream consumers
            try {
              const { computeRewardTrend } = await import('./rewardSignalService');
              const trend = await computeRewardTrend(guildId);
              if (trend && trend.trend !== 'stable') {
                const { emitSignal } = await import('../runtime/signalBus');
                emitSignal(
                  trend.trend === 'degrading' ? 'reward.degrading' : 'reward.improving',
                  'rewardSignalLoop',
                  guildId,
                  { trend: trend.trend, delta: trend.delta },
                );
              }
            } catch {
              // Best-effort signal emission
            }

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
            getErrorMessage(result.reason),
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

let loop: BackgroundLoop | null = null;

export const startRewardSignalLoop = (client: Client): void => {
  if (!REWARD_LOOP_ENABLED || loop) return;

  loop = new BackgroundLoop(
    async () => {
      const s = await runOnce(client);
      return `attempted=${s.attemptedGuilds} completed=${s.completedGuilds} failed=${s.failedGuilds}`;
    },
    {
      name: '[REWARD-SIGNAL-LOOP]',
      intervalMs: REWARD_LOOP_INTERVAL_HOURS * 60 * 60 * 1000,
      runOnStart: REWARD_LOOP_RUN_ON_START,
      errorLevel: 'error',
    },
  );
  loop.start();
};

export const stopRewardSignalLoop = (): void => {
  loop?.stop();
  loop = null;
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

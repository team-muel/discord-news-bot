import type { Client } from 'discord.js';
import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { runRetrievalAutoTuning, runRetrievalEval } from './retrievalEvalService';

const RETRIEVAL_AUTO_EVAL_ENABLED = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_ENABLED, false);
const RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS = Math.max(1, parseIntegerEnv(process.env.RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS, 24));
const RETRIEVAL_AUTO_EVAL_RUN_ON_START = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_RUN_ON_START, false);
const RETRIEVAL_AUTO_EVAL_APPLY_TUNING = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_APPLY_TUNING, false);
const RETRIEVAL_AUTO_EVAL_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.RETRIEVAL_AUTO_EVAL_MAX_GUILDS, 30));
const RETRIEVAL_AUTO_EVAL_TOP_K = Math.max(1, Math.min(20, parseIntegerEnv(process.env.RETRIEVAL_AUTO_EVAL_TOP_K, 5)));

const parseOptionalEvalSetId = (value: string | undefined): number | undefined => {
  const parsed = Number(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.trunc(parsed);
};

const RETRIEVAL_AUTO_EVAL_SET_ID = parseOptionalEvalSetId(process.env.RETRIEVAL_AUTO_EVAL_SET_ID);

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastSummary: string | null = null;

type EvalRunStats = {
  attemptedGuilds: number;
  completedGuilds: number;
  failedGuilds: number;
  appliedTunings: number;
};

const runOnce = async (client: Client): Promise<EvalRunStats> => {
  if (running) {
    return {
      attemptedGuilds: 0,
      completedGuilds: 0,
      failedGuilds: 0,
      appliedTunings: 0,
    };
  }

  running = true;
  lastRunAt = new Date().toISOString();

  const stats: EvalRunStats = {
    attemptedGuilds: 0,
    completedGuilds: 0,
    failedGuilds: 0,
    appliedTunings: 0,
  };

  try {
    const guildIds = [...client.guilds.cache.keys()].slice(0, RETRIEVAL_AUTO_EVAL_MAX_GUILDS);
    for (const guildId of guildIds) {
      stats.attemptedGuilds += 1;
      try {
        const evalRun = await runRetrievalEval({
          guildId,
          evalSetId: RETRIEVAL_AUTO_EVAL_SET_ID,
          requestedBy: 'system-auto-retrieval-eval',
          topK: RETRIEVAL_AUTO_EVAL_TOP_K,
        });

        const tuning = await runRetrievalAutoTuning({
          guildId,
          runId: evalRun.runId,
          requestedBy: 'system-auto-retrieval-eval',
          applyIfBetter: RETRIEVAL_AUTO_EVAL_APPLY_TUNING,
        });

        if (tuning.applied) {
          stats.appliedTunings += 1;
        }

        stats.completedGuilds += 1;
      } catch (error) {
        stats.failedGuilds += 1;
        logger.warn('[RETRIEVAL-EVAL-LOOP] guild run failed guild=%s error=%s', guildId, error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    running = false;
    lastSummary = `attempted=${stats.attemptedGuilds} completed=${stats.completedGuilds} failed=${stats.failedGuilds} appliedTunings=${stats.appliedTunings}`;
    logger.info('[RETRIEVAL-EVAL-LOOP] completed: %s', lastSummary);
  }

  return stats;
};

export const startRetrievalEvalLoop = (client: Client) => {
  if (!RETRIEVAL_AUTO_EVAL_ENABLED || timer) {
    return;
  }

  const intervalMs = RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS * 60 * 60 * 1000;
  timer = setInterval(() => {
    void runOnce(client);
  }, intervalMs);
  timer.unref();

  if (RETRIEVAL_AUTO_EVAL_RUN_ON_START) {
    void runOnce(client);
  }

  logger.info(
    '[RETRIEVAL-EVAL-LOOP] started intervalHours=%d runOnStart=%s evalSetId=%s applyTuning=%s maxGuilds=%d topK=%d',
    RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS,
    String(RETRIEVAL_AUTO_EVAL_RUN_ON_START),
    String(RETRIEVAL_AUTO_EVAL_SET_ID || 'auto-all'),
    String(RETRIEVAL_AUTO_EVAL_APPLY_TUNING),
    RETRIEVAL_AUTO_EVAL_MAX_GUILDS,
    RETRIEVAL_AUTO_EVAL_TOP_K,
  );
};

export const stopRetrievalEvalLoop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const getRetrievalEvalLoopStats = () => ({
  enabled: RETRIEVAL_AUTO_EVAL_ENABLED,
  running,
  intervalHours: RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS,
  runOnStart: RETRIEVAL_AUTO_EVAL_RUN_ON_START,
  evalSetId: RETRIEVAL_AUTO_EVAL_SET_ID || null,
  applyTuning: RETRIEVAL_AUTO_EVAL_APPLY_TUNING,
  maxGuilds: RETRIEVAL_AUTO_EVAL_MAX_GUILDS,
  topK: RETRIEVAL_AUTO_EVAL_TOP_K,
  lastRunAt,
  lastSummary,
});

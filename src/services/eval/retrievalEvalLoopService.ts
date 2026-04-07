import type { Client } from 'discord.js';
import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv } from '../../utils/env';
import { BackgroundLoop } from '../../utils/backgroundLoop';
import { runRetrievalAutoTuning, runRetrievalEval } from './retrievalEvalService';
import { getErrorMessage } from '../../utils/errorMessage';

const RETRIEVAL_AUTO_EVAL_ENABLED = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_ENABLED, false);
const RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS = parseMinIntEnv(process.env.RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS, 24, 1);
const RETRIEVAL_AUTO_EVAL_RUN_ON_START = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_RUN_ON_START, false);
const RETRIEVAL_AUTO_EVAL_APPLY_TUNING = parseBooleanEnv(process.env.RETRIEVAL_AUTO_EVAL_APPLY_TUNING, false);
const RETRIEVAL_AUTO_EVAL_MAX_GUILDS = parseMinIntEnv(process.env.RETRIEVAL_AUTO_EVAL_MAX_GUILDS, 30, 1);
const RETRIEVAL_AUTO_EVAL_TOP_K = parseBoundedNumberEnv(process.env.RETRIEVAL_AUTO_EVAL_TOP_K, 5, 1, 20);

const parseOptionalEvalSetId = (value: string | undefined): number | undefined => {
  const parsed = Number(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.trunc(parsed);
};

const RETRIEVAL_AUTO_EVAL_SET_ID = parseOptionalEvalSetId(process.env.RETRIEVAL_AUTO_EVAL_SET_ID);

let lastRunAt: string | null = null;
let lastSummary: string | null = null;
let running = false;

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
        logger.warn('[RETRIEVAL-EVAL-LOOP] guild run failed guild=%s error=%s', guildId, getErrorMessage(error));
      }
    }
  } finally {
    running = false;
    lastSummary = `attempted=${stats.attemptedGuilds} completed=${stats.completedGuilds} failed=${stats.failedGuilds} appliedTunings=${stats.appliedTunings}`;
    logger.info('[RETRIEVAL-EVAL-LOOP] completed: %s', lastSummary);
  }

  return stats;
};

let loop: BackgroundLoop | null = null;

export const startRetrievalEvalLoop = (client: Client) => {
  if (!RETRIEVAL_AUTO_EVAL_ENABLED || loop) return;

  loop = new BackgroundLoop(
    async () => {
      const s = await runOnce(client);
      return `attempted=${s.attemptedGuilds} completed=${s.completedGuilds} failed=${s.failedGuilds} appliedTunings=${s.appliedTunings}`;
    },
    {
      name: '[RETRIEVAL-EVAL-LOOP]',
      intervalMs: RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS * 60 * 60 * 1000,
      runOnStart: RETRIEVAL_AUTO_EVAL_RUN_ON_START,
      errorLevel: 'error',
    },
  );
  loop.start();
};

export const stopRetrievalEvalLoop = () => {
  loop?.stop();
  loop = null;
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

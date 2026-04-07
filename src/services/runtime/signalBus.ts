/**
 * Platform Signal Bus — in-process event hub that connects producers
 * (eval loops, go/no-go, convergence, memory quality, workflow events)
 * to consumers (sprint triggers, runtime alerts, traffic routing).
 *
 * Replaces the pattern of "write to Supabase and hope someone reads it"
 * with immediate in-process signal propagation.
 *
 * Design:
 * - Typed signal names with typed payloads
 * - Async listeners (fire-and-forget, never block producers)
 * - Dedup/cooldown per signal type to prevent cascading triggers
 * - Observable: snapshot of recent signals for diagnostics
 */

import logger from '../../logger';
import { parseBooleanEnv, parseMinIntEnv } from '../../utils/env';
import { getErrorMessage } from '../../utils/errorMessage';

// ──── Config ──────────────────────────────────────────────────────────────────

const SIGNAL_BUS_ENABLED = parseBooleanEnv(process.env.SIGNAL_BUS_ENABLED, true);
const SIGNAL_COOLDOWN_MS = parseMinIntEnv(process.env.SIGNAL_BUS_COOLDOWN_MS, 60_000, 5_000);
const SIGNAL_HISTORY_MAX = parseMinIntEnv(process.env.SIGNAL_BUS_HISTORY_MAX, 200, 10);

// ──── Signal Types ────────────────────────────────────────────────────────────

export type SignalName =
  | 'reward.degrading'
  | 'reward.improving'
  | 'eval.promotion.failed'
  | 'eval.promotion.succeeded'
  | 'gonogo.no-go'
  | 'gonogo.go'
  | 'convergence.degrading'
  | 'convergence.improving'
  | 'convergence.stable'
  | 'memory.quality.below'
  | 'memory.quality.recovered'
  | 'workflow.phase.looping'
  | 'workflow.sprint.completed'
  | 'workflow.sprint.failed'
  | 'weekly.report.ready'
  | 'observation.new'
  | 'observation.critical';

export type Signal<T = Record<string, unknown>> = {
  name: SignalName;
  source: string;
  guildId: string;
  payload: T;
  emittedAt: string;
};

export type RewardSignalPayload = {
  trend: 'improving' | 'stable' | 'degrading';
  delta: number;
};

export type EvalPromotionPayload = {
  evalName: string;
  verdict: string;
  deltaReward?: number;
};

export type GoNoGoPayload = {
  decision: 'go' | 'no-go';
  failedChecks: string[];
  failedCount: number;
};

export type ConvergencePayload = {
  overallVerdict: string;
  benchScoreTrend: string;
  qualityScoreTrend: string;
  dataPoints: number;
};

export type MemoryQualityPayload = {
  metricId: string;
  actual: number;
  threshold: number;
};

export type WorkflowLoopPayload = {
  sprintId: string;
  loopCount: number;
  fromPhase: string;
  toPhase: string;
};

export type WorkflowCompletionPayload = {
  sprintId: string;
  triggerType: string;
  phasesExecuted: number;
  changedFiles: string[];
};

export type WeeklyReportPayload = {
  reportKind: string;
  reportKey: string;
};

// ──── Listener Registry ───────────────────────────────────────────────────────

type SignalListener = (signal: Signal) => void | Promise<void>;

const listeners = new Map<SignalName | '*', Set<SignalListener>>();
const cooldowns = new Map<string, number>(); // `${signalName}:${guildId}` → lastEmittedAt
const history: Signal[] = [];

// ──── Core API ────────────────────────────────────────────────────────────────

/**
 * Register a listener for a specific signal or '*' for all signals.
 * Returns an unsubscribe function.
 */
export const onSignal = (name: SignalName | '*', listener: SignalListener): (() => void) => {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(listener);
  return () => { listeners.get(name)?.delete(listener); };
};

/**
 * Emit a signal. Listeners are called asynchronously (fire-and-forget).
 * Respects per-signal cooldown to prevent cascade storms.
 */
export const emitSignal = <T extends Record<string, unknown>>(
  name: SignalName,
  source: string,
  guildId: string,
  payload: T,
): boolean => {
  if (!SIGNAL_BUS_ENABLED) return false;

  const cooldownKey = `${name}:${guildId}`;
  const now = Date.now();
  const lastEmitted = cooldowns.get(cooldownKey) || 0;
  if (now - lastEmitted < SIGNAL_COOLDOWN_MS) {
    return false; // Cooldown active
  }

  cooldowns.set(cooldownKey, now);

  const signal: Signal<T> = {
    name,
    source,
    guildId,
    payload,
    emittedAt: new Date().toISOString(),
  };

  // Record in history
  history.push(signal as Signal);
  if (history.length > SIGNAL_HISTORY_MAX) {
    history.splice(0, history.length - SIGNAL_HISTORY_MAX);
  }

  // Dispatch to specific + wildcard listeners
  const dispatch = (set: Set<SignalListener> | undefined) => {
    if (!set) return;
    for (const listener of set) {
      try {
        const result = listener(signal as Signal);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            logger.warn('[SIGNAL-BUS] listener error signal=%s source=%s: %s', name, source, getErrorMessage(err));
          });
        }
      } catch (err) {
        logger.warn('[SIGNAL-BUS] listener sync error signal=%s: %s', name, getErrorMessage(err));
      }
    }
  };

  dispatch(listeners.get(name));
  dispatch(listeners.get('*'));

  logger.debug('[SIGNAL-BUS] emitted signal=%s source=%s guild=%s', name, source, guildId);
  return true;
};

// ──── Diagnostics ─────────────────────────────────────────────────────────────

export const getSignalBusSnapshot = () => ({
  enabled: SIGNAL_BUS_ENABLED,
  listenerCount: [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  signalTypes: [...listeners.keys()],
  recentSignals: history.slice(-20),
  cooldownEntries: cooldowns.size,
});

export const getSignalHistory = (limit = 50): readonly Signal[] =>
  history.slice(-Math.min(limit, SIGNAL_HISTORY_MAX));

/** Clear all listeners and history — for testing only. */
export const __resetSignalBusForTests = () => {
  listeners.clear();
  cooldowns.clear();
  history.length = 0;
};

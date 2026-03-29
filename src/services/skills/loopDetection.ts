/**
 * Action Loop Detection — Cline's loop-detection.ts pattern adapted for sprint actions.
 *
 * Detects repeated identical action+args calls within a sprint/session,
 * escalating from soft warning to hard block to prevent infinite loops.
 */

export const LOOP_SOFT_THRESHOLD = 3;
export const LOOP_HARD_THRESHOLD = 5;

export type LoopState = {
  /** Last action name executed. */
  lastActionName: string | null;
  /** Signature of last action params (stable JSON). */
  lastActionSignature: string | null;
  /** Consecutive count of identical action+params calls. */
  consecutiveRepeatCount: number;
};

export type LoopCheckResult = {
  /** True when repeats reach soft threshold — inject a warning into context. */
  softWarning: boolean;
  /** True when repeats reach hard threshold — abort execution. */
  hardBlock: boolean;
  /** Current consecutive repeat count (after this call). */
  count: number;
};

/**
 * Compute a stable signature from action args.
 * Uses sorted-key JSON to ensure deterministic comparison.
 */
export function actionSignature(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return '{}';
  const sorted = Object.entries(args)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${JSON.stringify(v ?? null)}`);
  return `{${sorted.join(',')}}`;
}

/**
 * Check whether the current action+args is a repeat of the previous call.
 * Mutates `state` in-place (like Cline's TaskState mutation pattern).
 */
export function checkActionLoop(
  state: LoopState,
  actionName: string,
  argSignature: string,
): LoopCheckResult {
  if (state.lastActionName === actionName && state.lastActionSignature === argSignature) {
    state.consecutiveRepeatCount += 1;
  } else {
    state.consecutiveRepeatCount = 1;
  }

  state.lastActionName = actionName;
  state.lastActionSignature = argSignature;

  return {
    softWarning: state.consecutiveRepeatCount >= LOOP_SOFT_THRESHOLD && state.consecutiveRepeatCount < LOOP_HARD_THRESHOLD,
    hardBlock: state.consecutiveRepeatCount >= LOOP_HARD_THRESHOLD,
    count: state.consecutiveRepeatCount,
  };
}

/** Create a fresh loop state (e.g. at sprint start). */
export function createLoopState(): LoopState {
  return {
    lastActionName: null,
    lastActionSignature: null,
    consecutiveRepeatCount: 0,
  };
}

/** Format a soft-warning message for injection into the sprint context. */
export function formatLoopWarning(actionName: string, count: number): string {
  return `⚠ Loop detection: "${actionName}" has been called ${count} consecutive times with identical parameters. Vary your approach or move to the next step.`;
}

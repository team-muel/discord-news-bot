/**
 * Action runner diagnostics — failure tracking, trend analysis, and snapshot export.
 * Extracted from actionRunner to reduce file size.
 */
import { parseBoundedNumberEnv } from '../../utils/env';

// ──── Types ───────────────────────────────────────────────────────────────────

export type FailureDiagnostics = {
  totalFailures: number;
  missingAction: number;
  policyBlocked: number;
  governanceUnavailable: number;
  finopsBlocked: number;
  externalFailures: number;
  unknownFailures: number;
};

export type SkillActionResult = {
  handled: boolean;
  output: string;
  hasSuccess: boolean;
  externalUnavailable: boolean;
  diagnostics: FailureDiagnostics;
};

export type ActionRunnerDiagnosticsSnapshot = {
  lastUpdatedAt: string | null;
  totalRuns: number;
  handledRuns: number;
  successRuns: number;
  failedRuns: number;
  externalUnavailableRuns: number;
  failureTotals: FailureDiagnostics;
  trend: {
    windowSize: number;
    comparedRuns: number;
    failureRateDelta: number | null;
    missingActionDelta: number | null;
    policyBlockedDelta: number | null;
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };
  topFailureCodes: Array<{
    code: string;
    count: number;
    share: number;
  }>;
  recentRuns: Array<{
    at: string;
    totalFailures: number;
    failed: boolean;
    missingAction: number;
    policyBlocked: number;
  }>;
  lastRun: {
    handled: boolean;
    hasSuccess: boolean;
    externalUnavailable: boolean;
    diagnostics: FailureDiagnostics;
  } | null;
};

type ActionRunnerRunSample = {
  at: string;
  failureTotal: number;
  missingAction: number;
  policyBlocked: number;
};

// ──── Config ──────────────────────────────────────────────────────────────────

const ACTION_RUNNER_TREND_WINDOW_RUNS = parseBoundedNumberEnv(process.env.ACTION_RUNNER_TREND_WINDOW_RUNS, 10, 4, 50);

// ──── Helpers ─────────────────────────────────────────────────────────────────

export const createEmptyDiagnostics = (): FailureDiagnostics => ({
  totalFailures: 0,
  missingAction: 0,
  policyBlocked: 0,
  governanceUnavailable: 0,
  finopsBlocked: 0,
  externalFailures: 0,
  unknownFailures: 0,
});

const cloneDiagnostics = (source: FailureDiagnostics): FailureDiagnostics => ({
  totalFailures: Number(source.totalFailures || 0),
  missingAction: Number(source.missingAction || 0),
  policyBlocked: Number(source.policyBlocked || 0),
  governanceUnavailable: Number(source.governanceUnavailable || 0),
  finopsBlocked: Number(source.finopsBlocked || 0),
  externalFailures: Number(source.externalFailures || 0),
  unknownFailures: Number(source.unknownFailures || 0),
});

export const isExternalUnavailableError = (errorCode?: string): boolean => {
  const code = String(errorCode || '').toUpperCase();
  if (!code) {
    return false;
  }

  return code.includes('WORKER')
    || code.includes('MCP_')
    || code === 'ACTION_TIMEOUT'
    || code === 'WEB_FETCH_FAILED';
};

export const classifyFailureCode = (code: string | undefined): 'missingAction' | 'policyBlocked' | 'governanceUnavailable' | 'finopsBlocked' | 'externalFailures' | 'unknownFailures' => {
  const error = String(code || '').trim().toUpperCase();
  if (!error) {
    return 'unknownFailures';
  }
  if (error === 'ACTION_NOT_IMPLEMENTED' || error === 'DYNAMIC_WORKER_NOT_FOUND') {
    return 'missingAction';
  }
  if (error === 'ACTION_NOT_ALLOWED' || error === 'ACTION_DISABLED_BY_POLICY' || error === 'ACTION_APPROVAL_REQUIRED') {
    return 'policyBlocked';
  }
  if (error === 'ALLOWLIST_BLOCKED' || error === 'GATE_VERDICT_NO_GO') {
    return 'policyBlocked';
  }
  if (error === 'ACTION_POLICY_UNAVAILABLE') {
    return 'governanceUnavailable';
  }
  if (error.includes('FINOPS') || error.includes('BUDGET')) {
    return 'finopsBlocked';
  }
  if (error.startsWith('RSS_')) {
    return 'externalFailures';
  }
  if (isExternalUnavailableError(error)) {
    return 'externalFailures';
  }
  return 'unknownFailures';
};

// ──── State ───────────────────────────────────────────────────────────────────

const actionRunnerDiagnosticsState: ActionRunnerDiagnosticsSnapshot = {
  lastUpdatedAt: null,
  totalRuns: 0,
  handledRuns: 0,
  successRuns: 0,
  failedRuns: 0,
  externalUnavailableRuns: 0,
  failureTotals: createEmptyDiagnostics(),
  trend: {
    windowSize: ACTION_RUNNER_TREND_WINDOW_RUNS,
    comparedRuns: 0,
    failureRateDelta: null,
    missingActionDelta: null,
    policyBlockedDelta: null,
    direction: 'unknown',
  },
  topFailureCodes: [],
  recentRuns: [],
  lastRun: null,
};

const actionRunnerRecentRuns: ActionRunnerRunSample[] = [];
const actionRunnerFailureCodeCounts = new Map<string, number>();

// ──── Trend computation ───────────────────────────────────────────────────────

const round = (value: number): number => Number(value.toFixed(4));

const computeTrendDirection = (deltas: Array<number | null>): 'up' | 'down' | 'flat' | 'unknown' => {
  const available = deltas.filter((value): value is number => Number.isFinite(value));
  if (available.length === 0) {
    return 'unknown';
  }

  const score = available.reduce((sum, value) => sum + value, 0);
  if (score > 0.03) {
    return 'up';
  }
  if (score < -0.03) {
    return 'down';
  }
  return 'flat';
};

const computeTrendSnapshot = () => {
  const windowSize = ACTION_RUNNER_TREND_WINDOW_RUNS;
  const latest = actionRunnerRecentRuns.slice(-windowSize);
  const previous = actionRunnerRecentRuns.slice(-(windowSize * 2), -windowSize);
  if (latest.length === 0 || previous.length === 0) {
    return {
      windowSize,
      comparedRuns: 0,
      failureRateDelta: null,
      missingActionDelta: null,
      policyBlockedDelta: null,
      direction: 'unknown' as const,
    };
  }

  const failureRate = (samples: ActionRunnerRunSample[]): number => {
    const failed = samples.filter((sample) => sample.failureTotal > 0).length;
    return failed / samples.length;
  };
  const averageBy = (samples: ActionRunnerRunSample[], key: 'missingAction' | 'policyBlocked'): number => {
    const total = samples.reduce((sum, sample) => sum + sample[key], 0);
    return total / samples.length;
  };

  const failureRateDelta = round(failureRate(latest) - failureRate(previous));
  const missingActionDelta = round(averageBy(latest, 'missingAction') - averageBy(previous, 'missingAction'));
  const policyBlockedDelta = round(averageBy(latest, 'policyBlocked') - averageBy(previous, 'policyBlocked'));

  return {
    windowSize,
    comparedRuns: latest.length + previous.length,
    failureRateDelta,
    missingActionDelta,
    policyBlockedDelta,
    direction: computeTrendDirection([failureRateDelta, missingActionDelta, policyBlockedDelta]),
  };
};

const computeTopFailureCodes = (): Array<{ code: string; count: number; share: number }> => {
  const totalFailures = Math.max(0, Number(actionRunnerDiagnosticsState.failureTotals.totalFailures || 0));
  if (totalFailures <= 0 || actionRunnerFailureCodeCounts.size === 0) {
    return [];
  }

  return Array.from(actionRunnerFailureCodeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => ({
      code,
      count,
      share: round(count / totalFailures),
    }));
};

// ──── Public API ──────────────────────────────────────────────────────────────

export const updateActionRunnerDiagnostics = (result: SkillActionResult) => {
  const nowIso = new Date().toISOString();
  actionRunnerDiagnosticsState.lastUpdatedAt = nowIso;
  actionRunnerDiagnosticsState.totalRuns += 1;
  if (result.handled) {
    actionRunnerDiagnosticsState.handledRuns += 1;
  }
  if (result.hasSuccess) {
    actionRunnerDiagnosticsState.successRuns += 1;
  }
  if (result.diagnostics.totalFailures > 0) {
    actionRunnerDiagnosticsState.failedRuns += 1;
  }
  if (result.externalUnavailable) {
    actionRunnerDiagnosticsState.externalUnavailableRuns += 1;
  }

  const totals = actionRunnerDiagnosticsState.failureTotals;
  totals.totalFailures += result.diagnostics.totalFailures;
  totals.missingAction += result.diagnostics.missingAction;
  totals.policyBlocked += result.diagnostics.policyBlocked;
  totals.governanceUnavailable += result.diagnostics.governanceUnavailable;
  totals.finopsBlocked += result.diagnostics.finopsBlocked;
  totals.externalFailures += result.diagnostics.externalFailures;
  totals.unknownFailures += result.diagnostics.unknownFailures;

  actionRunnerDiagnosticsState.lastRun = {
    handled: result.handled,
    hasSuccess: result.hasSuccess,
    externalUnavailable: result.externalUnavailable,
    diagnostics: cloneDiagnostics(result.diagnostics),
  };

  actionRunnerRecentRuns.push({
    at: nowIso,
    failureTotal: Number(result.diagnostics.totalFailures || 0),
    missingAction: Number(result.diagnostics.missingAction || 0),
    policyBlocked: Number(result.diagnostics.policyBlocked || 0),
  });
  const maxRuns = ACTION_RUNNER_TREND_WINDOW_RUNS * 2;
  while (actionRunnerRecentRuns.length > maxRuns) {
    actionRunnerRecentRuns.shift();
  }

  actionRunnerDiagnosticsState.trend = computeTrendSnapshot();
  actionRunnerDiagnosticsState.topFailureCodes = computeTopFailureCodes();
  actionRunnerDiagnosticsState.recentRuns = actionRunnerRecentRuns.map((sample) => ({
    at: sample.at,
    totalFailures: sample.failureTotal,
    failed: sample.failureTotal > 0,
    missingAction: sample.missingAction,
    policyBlocked: sample.policyBlocked,
  }));
};

export const getActionRunnerDiagnosticsSnapshot = (): ActionRunnerDiagnosticsSnapshot => ({
  lastUpdatedAt: actionRunnerDiagnosticsState.lastUpdatedAt,
  totalRuns: actionRunnerDiagnosticsState.totalRuns,
  handledRuns: actionRunnerDiagnosticsState.handledRuns,
  successRuns: actionRunnerDiagnosticsState.successRuns,
  failedRuns: actionRunnerDiagnosticsState.failedRuns,
  externalUnavailableRuns: actionRunnerDiagnosticsState.externalUnavailableRuns,
  failureTotals: cloneDiagnostics(actionRunnerDiagnosticsState.failureTotals),
  trend: {
    windowSize: actionRunnerDiagnosticsState.trend.windowSize,
    comparedRuns: actionRunnerDiagnosticsState.trend.comparedRuns,
    failureRateDelta: actionRunnerDiagnosticsState.trend.failureRateDelta,
    missingActionDelta: actionRunnerDiagnosticsState.trend.missingActionDelta,
    policyBlockedDelta: actionRunnerDiagnosticsState.trend.policyBlockedDelta,
    direction: actionRunnerDiagnosticsState.trend.direction,
  },
  topFailureCodes: actionRunnerDiagnosticsState.topFailureCodes.map((item) => ({
    code: item.code,
    count: item.count,
    share: item.share,
  })),
  recentRuns: actionRunnerDiagnosticsState.recentRuns.map((sample) => ({
    at: sample.at,
    totalFailures: sample.totalFailures,
    failed: sample.failed,
    missingAction: sample.missingAction,
    policyBlocked: sample.policyBlocked,
  })),
  lastRun: actionRunnerDiagnosticsState.lastRun
    ? {
      handled: actionRunnerDiagnosticsState.lastRun.handled,
      hasSuccess: actionRunnerDiagnosticsState.lastRun.hasSuccess,
      externalUnavailable: actionRunnerDiagnosticsState.lastRun.externalUnavailable,
      diagnostics: cloneDiagnostics(actionRunnerDiagnosticsState.lastRun.diagnostics),
    }
    : null,
});

/** Record a failure error code for top failure codes tracking. */
export const recordFailureCode = (code: string): void => {
  actionRunnerFailureCodeCounts.set(code, (actionRunnerFailureCodeCounts.get(code) || 0) + 1);
  // Bound failure code map to prevent unbounded growth
  if (actionRunnerFailureCodeCounts.size > 500) {
    const first = actionRunnerFailureCodeCounts.keys().next().value;
    if (first !== undefined) actionRunnerFailureCodeCounts.delete(first);
  }
};

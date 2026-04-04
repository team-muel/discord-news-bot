/**
 * Sprint phase execution metrics — in-memory counters with bounded history.
 * Extracted from sprintOrchestrator to reduce file size.
 */

const sprintMetrics = {
  totalPipelinesCreated: 0,
  totalPhasesExecuted: 0,
  totalPhasesFailed: 0,
  totalLoopBacks: 0,
  deterministicPhasesExecuted: 0,
  llmPhasesExecuted: 0,
  deterministicTimeMs: 0,
  llmTimeMs: 0,
  phaseTimingsMs: [] as Array<{ phase: string; durationMs: number; deterministic: boolean; at: string }>,
};

export const recordPhaseMetric = (phase: string, durationMs: number, failed: boolean, deterministic = false): void => {
  sprintMetrics.totalPhasesExecuted++;
  if (failed) sprintMetrics.totalPhasesFailed++;
  if (deterministic) {
    sprintMetrics.deterministicPhasesExecuted++;
    sprintMetrics.deterministicTimeMs += durationMs;
  } else {
    sprintMetrics.llmPhasesExecuted++;
    sprintMetrics.llmTimeMs += durationMs;
  }
  sprintMetrics.phaseTimingsMs.push({ phase, durationMs, deterministic, at: new Date().toISOString() });
  if (sprintMetrics.phaseTimingsMs.length > 200) {
    sprintMetrics.phaseTimingsMs = sprintMetrics.phaseTimingsMs.slice(-200);
  }
};

export const recordPipelineCreated = (): void => {
  sprintMetrics.totalPipelinesCreated++;
};

export const recordLoopBack = (): void => {
  sprintMetrics.totalLoopBacks++;
};

export type SprintMetricsSummary = {
  totalPipelinesCreated: number;
  totalPhasesExecuted: number;
  totalPhasesFailed: number;
  totalLoopBacks: number;
  avgPhaseDurationMs: number;
  scaffoldingRatio: number;
  scaffoldingTimeRatio: number;
  deterministicPhasesExecuted: number;
  llmPhasesExecuted: number;
  recentTimings: Array<{ phase: string; durationMs: number; deterministic: boolean; at: string }>;
};

export const getSprintMetrics = (): SprintMetricsSummary => {
  const timings = sprintMetrics.phaseTimingsMs;
  const avg = timings.length > 0
    ? Math.round(timings.reduce((s, t) => s + t.durationMs, 0) / timings.length)
    : 0;
  const totalPhases = sprintMetrics.deterministicPhasesExecuted + sprintMetrics.llmPhasesExecuted;
  const totalTime = sprintMetrics.deterministicTimeMs + sprintMetrics.llmTimeMs;
  return {
    totalPipelinesCreated: sprintMetrics.totalPipelinesCreated,
    totalPhasesExecuted: sprintMetrics.totalPhasesExecuted,
    totalPhasesFailed: sprintMetrics.totalPhasesFailed,
    totalLoopBacks: sprintMetrics.totalLoopBacks,
    avgPhaseDurationMs: avg,
    scaffoldingRatio: totalPhases > 0 ? sprintMetrics.deterministicPhasesExecuted / totalPhases : 0,
    scaffoldingTimeRatio: totalTime > 0 ? sprintMetrics.deterministicTimeMs / totalTime : 0,
    deterministicPhasesExecuted: sprintMetrics.deterministicPhasesExecuted,
    llmPhasesExecuted: sprintMetrics.llmPhasesExecuted,
    recentTimings: timings.slice(-20),
  };
};

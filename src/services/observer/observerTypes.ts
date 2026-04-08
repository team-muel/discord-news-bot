/**
 * Observer Layer — Type definitions for the autonomous observation system.
 *
 * Observations are structured records of environment changes detected by
 * observation channels. They feed into the Intent Formation Engine (Phase G)
 * and are persisted to Supabase for audit and trend analysis.
 */

// ──── Observation Channel Types ───────────────────────────────────────────────

export type ObservationChannelKind =
  | 'error-pattern'
  | 'memory-gap'
  | 'perf-drift'
  | 'code-health'
  | 'convergence-digest'
  | 'discord-pulse'
  | 'harness-gate';

export type ObservationSeverity = 'info' | 'warning' | 'critical';

// ──── Observation Record ──────────────────────────────────────────────────────

export type Observation = {
  id?: string;
  guildId: string;
  channel: ObservationChannelKind;
  severity: ObservationSeverity;
  title: string;
  payload: Record<string, unknown>;
  detectedAt: string;
  consumedAt?: string | null;
  sprintId?: string | null;
};

// ──── Channel-Specific Payloads ───────────────────────────────────────────────

export type ErrorPatternPayload = {
  cluster: string;
  errorCodes: string[];
  frequency: number;
  windowMinutes: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  sampleMessages: string[];
};

export type MemoryGapPayload = {
  gapKind: 'broken-link' | 'stale-memory' | 'orphan-node' | 'low-confidence-cluster';
  affectedCount: number;
  affectedPaths?: string[];
  ageHours?: number;
};

export type PerfDriftPayload = {
  metric: 'p95_latency_ms' | 'avg_latency_ms' | 'token_cost' | 'success_rate';
  current: number;
  baseline: number;
  deltaPercent: number;
  windowHours: number;
};

export type CodeHealthPayload = {
  metric: 'type-errors' | 'test-failures' | 'coverage-delta';
  current: number;
  previous: number;
  delta: number;
  details?: string[];
};

export type ConvergenceDigestPayload = {
  overallVerdict: 'improving' | 'stable' | 'degrading' | 'insufficient-data';
  benchScoreTrend: string;
  qualityScoreTrend: string;
  crossLoopSuccessRate: number | null;
  dataPoints: number;
};

export type DiscordPulsePayload = {
  channelId: string;
  channelName?: string;
  messageVolume24h: number;
  unansweredQuestions: number;
  avgResponseTimeMinutes: number | null;
  sentimentScore?: number | null;
};

export type HarnessGatePayload = {
  /** Which gate check fired (e.g. 'agent-deadletters', 'memory-deadletters', 'session-failure-rate', 'queue-depth') */
  gate: string;
  metric: string;
  current: number;
  threshold: number;
  details?: string[];
};

// ──── Observation Channel Interface ───────────────────────────────────────────

export type ObservationChannelResult = {
  observations: Observation[];
  channelKind: ObservationChannelKind;
  scanDurationMs: number;
  error?: string;
};

export type ObservationChannel = {
  kind: ObservationChannelKind;
  enabled: boolean;
  scan(guildId: string): Promise<ObservationChannelResult>;
};

// ──── Observer Orchestrator Types ─────────────────────────────────────────────

export type ObserverScanResult = {
  guildId: string;
  totalObservations: number;
  byChannel: Record<ObservationChannelKind, number>;
  bySeverity: Record<ObservationSeverity, number>;
  scanDurationMs: number;
  errors: string[];
};

export type ObserverStats = {
  enabled: boolean;
  lastScanAt: string | null;
  totalScans: number;
  totalObservations: number;
  channelStatus: Record<ObservationChannelKind, { enabled: boolean; lastScanAt: string | null; errorCount: number }>;
};

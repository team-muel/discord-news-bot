/**
 * Intent Formation — Type definitions.
 *
 * Intents are structured proposals for autonomous action, generated from
 * observations by rule-based evaluation. They feed into the Sprint
 * Orchestrator for execution.
 */

import type { ObservationChannelKind } from '../observer/observerTypes';

// ──── Intent Status ─────────────────────────────────────────────────────────

export type IntentStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'expired';

// ──── Intent Record ─────────────────────────────────────────────────────────

export type IntentRecord = {
  id?: number;
  guildId: string;
  hypothesis: string;
  objective: string;
  ruleId: string;
  priorityScore: number;
  autonomyLevel: string;
  status: IntentStatus;
  observationIds: string[];
  sprintId?: string | null;
  cooldownKey: string;
  tokenCost: number;
  decidedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// ──── Intent Rule ───────────────────────────────────────────────────────────

export type IntentRule = {
  id: string;
  /** Which observation channel(s) this rule evaluates */
  channels: ObservationChannelKind[];
  /** Default autonomy level for intents created by this rule */
  autonomyLevel: string;
  /** Priority weight (0-1) */
  basePriority: number;
  /** Cooldown key prefix */
  cooldownPrefix: string;
  /** Whether to auto-execute (full-auto) without human approval */
  autoExecute: boolean;
  /** Evaluate observations and return an intent proposal or null */
  evaluate: (ctx: RuleEvaluationContext) => IntentProposal | null;
};

// ──── Rule Evaluation Context ───────────────────────────────────────────────

export type RuleEvaluationContext = {
  guildId: string;
  observations: ObservationSnapshot[];
  metrics: MetricSnapshot;
};

export type ObservationSnapshot = {
  id: string;
  channel: ObservationChannelKind;
  severity: string;
  title: string;
  payload: Record<string, unknown>;
  detectedAt: string;
};

// ──── Intent Proposal (from rule evaluation) ────────────────────────────────

export type IntentProposal = {
  hypothesis: string;
  objective: string;
  priorityScore: number;
  autonomyLevel: string;
  observationIds: string[];
  cooldownKey: string;
};

// ──── Metric Snapshot (aggregated data for rule evaluation) ─────────────────

export type MetricSnapshot = {
  /** Error counts by cluster in the last window */
  errorClusters: Map<string, number>;
  /** Memory gap broken link count */
  brokenLinkCount: number;
  /** P95 latency current vs baseline (percentage delta) */
  p95DeltaPercent: number;
  /** Code health error count */
  codeHealthErrors: number;
  /** Convergence trend: consecutive degrading count */
  convergenceDegradingStreak: number;
  /** Discord activity delta percentage */
  discordActivityDeltaPercent: number;
};

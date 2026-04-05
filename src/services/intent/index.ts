/**
 * Intent Formation — barrel export.
 */

export { evaluateIntents, executeIntent, getIntentRules } from './intentFormationEngine';
export {
  persistIntent,
  updateIntentStatus,
  getIntents,
  getIntentById,
  getPendingIntentCount,
  isCooldownActive,
  getIntentStats,
} from './intentStore';
export { buildMetricSnapshot } from './metricReviewService';
export type {
  IntentRecord,
  IntentStatus,
  IntentRule,
  IntentProposal,
  MetricSnapshot,
  ObservationSnapshot,
  RuleEvaluationContext,
} from './intentTypes';

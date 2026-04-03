// Barrel export — Eval & Reward domain services
// Usage: import { startEvalAutoPromoteLoop, computeRewardSnapshot } from './eval';

export { startEvalAutoPromoteLoop, stopEvalAutoPromoteLoop, getEvalAutoPromoteLoopStatus } from './evalAutoPromoteLoopService';

export { createEvalRun, getPendingEvalRuns, runEvalPipeline, getRecentEvalRuns } from './evalAutoPromoteService';
export type { EvalAbRun } from './evalAutoPromoteService';

export { startRetrievalEvalLoop, stopRetrievalEvalLoop, getRetrievalEvalLoopStats } from './retrievalEvalLoopService';

export {
  createRetrievalEvalSet, upsertRetrievalEvalCase, listRetrievalEvalCases,
  runRetrievalEval, summarizeRetrievalEvalRun, runRetrievalAutoTuning, getRetrievalEvalRun,
} from './retrievalEvalService';
export type { RetrievalShadowVariant } from './retrievalEvalService';

export { startRewardSignalLoop, stopRewardSignalLoop, getRewardSignalLoopStatus } from './rewardSignalLoopService';

export { computeRewardSnapshot, persistRewardSnapshot, getRecentRewardSnapshots, computeRewardTrend } from './rewardSignalService';
export type { RewardSnapshot } from './rewardSignalService';

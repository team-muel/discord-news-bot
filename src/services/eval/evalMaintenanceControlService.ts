import { runEvalAutoPromoteLoopOnce } from './evalAutoPromoteLoopService';
import { runRetrievalEvalLoopOnce } from './retrievalEvalLoopService';
import { runRewardSignalLoopOnce } from './rewardSignalLoopService';

export type EvalMaintenanceExecutor = 'repo-runtime';
export type EvalMaintenanceTask = 'retrieval-eval' | 'reward-signal' | 'auto-promote';

export type EvalMaintenanceControlSurface = {
  executor: EvalMaintenanceExecutor;
  tasks: EvalMaintenanceTask[];
};

const CONTROL_SURFACE: EvalMaintenanceControlSurface = {
  executor: 'repo-runtime',
  tasks: ['retrieval-eval', 'reward-signal', 'auto-promote'],
};

export const getEvalMaintenanceControlSurface = (): EvalMaintenanceControlSurface => ({
  executor: CONTROL_SURFACE.executor,
  tasks: [...CONTROL_SURFACE.tasks],
});

export const executeRetrievalEvalLoop = async (guildIds: Iterable<string>) =>
  runRetrievalEvalLoopOnce(guildIds);

export const executeRewardSignalLoop = async (guildIds: Iterable<string>) =>
  runRewardSignalLoopOnce(guildIds);

export const executeEvalAutoPromoteLoop = async (guildIds: Iterable<string>) =>
  runEvalAutoPromoteLoopOnce(guildIds);
import type { AgentPriority } from '../../agentRuntimeTypes';
import type { SkillId } from '../../skills/types';

export type ExecutionStrategy = 'requested_skill' | 'fast_path' | 'full_review';

export const runSelectExecutionStrategyNode = (params: {
  requestedSkillId: SkillId | null;
  priority: AgentPriority;
  forceFullReview: boolean;
}): {
  strategy: ExecutionStrategy;
  traceNote: string;
} => {
  if (params.forceFullReview) {
    return {
      strategy: 'full_review',
      traceNote: 'forced_full_review:policy_gate=review',
    };
  }

  if (params.requestedSkillId) {
    return {
      strategy: 'requested_skill',
      traceNote: `requested_skill:${params.requestedSkillId}`,
    };
  }

  if (params.priority === 'fast') {
    return {
      strategy: 'fast_path',
      traceNote: 'fast_path:priority=fast',
    };
  }

  return {
    strategy: 'full_review',
    traceNote: `full_review:priority=${params.priority}`,
  };
};
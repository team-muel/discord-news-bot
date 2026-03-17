import type { AgentPriority } from '../../agentRuntimeTypes';
import { appendTrace, type LangGraphState } from '../stateContract';

type NonTaskIntent = 'task' | 'casual_chat' | 'uncertain';

type PolicyGateTransitionResult = {
  deliberationMode: 'direct' | 'plan_act' | 'deliberate' | 'guarded';
  riskScore: number;
  policyGate: {
    decision: 'allow' | 'review' | 'block';
    reasons: string[];
  };
  traceNote: string;
  privacySample: {
    mode: 'direct' | 'plan_act' | 'deliberate' | 'guarded';
    decision: 'allow' | 'review' | 'block';
    riskScore: number;
    reasons: string[];
    goal: string;
  } | null;
  shouldBlock: boolean;
  blockResult: string | null;
};

const toHydrateMemoryMaxItems = (priority: AgentPriority): number => {
  if (priority === 'fast') {
    return 4;
  }
  if (priority === 'precise') {
    return 16;
  }
  return 10;
};

export const runHydrateMemoryNode = async (params: {
  guildId: string;
  goal: string;
  priority: AgentPriority;
  requestedBy: string;
  loadHints: (input: {
    guildId: string;
    goal: string;
    maxItems: number;
    requesterUserId: string;
  }) => Promise<string[]>;
}): Promise<{ maxItems: number; memoryHints: string[] }> => {
  const maxItems = toHydrateMemoryMaxItems(params.priority);
  const memoryHints = await params.loadHints({
    guildId: params.guildId,
    goal: params.goal,
    maxItems,
    requesterUserId: params.requestedBy,
  });
  return {
    maxItems,
    memoryHints,
  };
};

export const runPersistAndEmitNode = (params: {
  shadowGraph: LangGraphState;
  status: string;
  currentResult: string | null;
  currentError: string | null;
  patch?: {
    result?: string | null;
    error?: string | null;
  };
}): {
  shadowGraph: LangGraphState;
  nextResult: string | null;
  nextError: string | null;
  assistantPayload: string;
} => {
  const hasResultPatch = Boolean(params.patch && Object.prototype.hasOwnProperty.call(params.patch, 'result'));
  const hasErrorPatch = Boolean(params.patch && Object.prototype.hasOwnProperty.call(params.patch, 'error'));
  const nextResult = hasResultPatch
    ? (params.patch?.result ?? null)
    : params.currentResult;
  const nextError = hasErrorPatch
    ? (params.patch?.error ?? null)
    : params.currentError;

  const shadowGraph = appendTrace({
    ...params.shadowGraph,
    finalText: nextResult ?? null,
    errorCode: nextError ? String(nextError) : null,
  }, 'persist_and_emit', params.status);

  return {
    shadowGraph,
    nextResult,
    nextError,
    assistantPayload: String(nextResult ?? nextError ?? '').trim(),
  };
};

export const runNonTaskIntentNode = async (params: {
  routedIntent: NonTaskIntent;
  goal: string;
  intentHints: string[];
  generateCasualReply: (goal: string) => Promise<string>;
  generateClarification: (goal: string, intentHints: string[]) => Promise<string>;
}): Promise<null | { traceNote: 'casual_chat' | 'intent_clarification'; result: string }> => {
  if (params.routedIntent === 'casual_chat') {
    const result = await params.generateCasualReply(params.goal);
    return {
      traceNote: 'casual_chat',
      result,
    };
  }

  if (params.routedIntent === 'uncertain') {
    const result = await params.generateClarification(params.goal, params.intentHints);
    return {
      traceNote: 'intent_clarification',
      result,
    };
  }

  return null;
};

export const runTaskPolicyGateTransitionNode = (params: {
  routedIntent: NonTaskIntent;
  guildId: string;
  taskGoal: string;
  evaluateGate: (input: {
    goal: string;
    guildId: string;
  }) => {
    mode: 'direct' | 'plan_act' | 'deliberate' | 'guarded';
    score: number;
    decision: 'allow' | 'review' | 'block';
    reasons: string[];
  };
  buildPolicyBlockMessage: (reasons: string[]) => string;
}): PolicyGateTransitionResult => {
  if (params.routedIntent !== 'task') {
    return {
      deliberationMode: 'direct',
      riskScore: 0,
      policyGate: {
        decision: 'allow',
        reasons: ['non_task_intent'],
      },
      traceNote: 'non_task:allow:0',
      privacySample: null,
      shouldBlock: false,
      blockResult: null,
    };
  }

  const gate = params.evaluateGate({
    goal: params.taskGoal,
    guildId: params.guildId,
  });

  return {
    deliberationMode: gate.mode,
    riskScore: gate.score,
    policyGate: {
      decision: gate.decision,
      reasons: [...gate.reasons],
    },
    traceNote: `${gate.decision}:${gate.score}`,
    privacySample: {
      mode: gate.mode,
      decision: gate.decision,
      riskScore: gate.score,
      reasons: [...gate.reasons],
      goal: params.taskGoal,
    },
    shouldBlock: gate.decision === 'block',
    blockResult: gate.decision === 'block'
      ? params.buildPolicyBlockMessage(gate.reasons)
      : null,
  };
};
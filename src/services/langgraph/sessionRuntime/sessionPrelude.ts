import type { PromptCompileResult } from '../../infra/promptCompiler';
import { buildAgentMemoryHints } from '../../agent/agentMemoryService';
import { recordPrivacyGateSample } from '../../agent/agentPrivacyTuningService';
import {
  buildPolicyBlockMessage,
  generateCasualChatResult,
  generateIntentClarificationResult,
} from '../../agent/agentIntentClassifier';
import { fetchRecentTurnsForUser } from '../../conversationTurnService';
import type { LlmProviderProfile } from '../../llmClient';
import type { AgentSession, AgentSessionStatus, SessionOutcomeEntry } from '../../multiAgentTypes';
import { runClassifyIntentNode, runCompilePromptNode, runPolicyGateNode } from '../nodes/coreNodes';
import { enrichIntentSignals } from '../nodes/intentSignalEnricher';
import { persistIntentExemplar } from '../nodes/intentExemplarStore';
import { runHydrateMemoryNode, runNonTaskIntentNode, runTaskPolicyGateTransitionNode } from '../nodes/runtimeNodes';
import type { ExecutionStrategy } from '../nodes/strategyNodes';
import { ensureSessionBudget, withTimeout } from '../runtimeSupport/runtimeBudget';

type SessionPreludeTraceNode =
  | 'compile_prompt'
  | 'route_intent'
  | 'policy_gate'
  | 'select_execution_strategy'
  | 'hydrate_memory'
  | 'compose_response';

export type SessionPreludeDependencies = {
  agentMemoryHintTimeoutMs: number;
  agentSessionTimeoutMs: number;
  getRecentSessionOutcomes: (guildId: string) => SessionOutcomeEntry[];
  resolveEffectiveSessionProviderProfile: (session: AgentSession) => LlmProviderProfile | undefined;
  ensureShadowGraph: (session: AgentSession) => NonNullable<AgentSession['shadowGraph']>;
  traceShadowNode: (session: AgentSession, node: SessionPreludeTraceNode, note?: string) => void;
  nowIso: () => string;
  cancelAllPendingSteps: (session: AgentSession, timestamp: string) => void;
  markSessionTerminal: (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => void;
  touch: (session: AgentSession) => void;
};

export const resolveComposeResponseState = async (params: {
  session: AgentSession;
  intentHints: string[];
  executionStrategy: ExecutionStrategy | null | undefined;
  finalCandidate: string | null | undefined;
  selectedFinalRaw: string | null | undefined;
  finalText: string | null | undefined;
  errorCode: string | null | undefined;
  deps: SessionPreludeDependencies;
  completeTaskSession: (rawResult: string, traceLabel: string) => AgentSessionStatus;
}): Promise<{
  status: AgentSessionStatus | null;
  finalText: string | null;
  errorCode: string | null;
  selectedFinalRaw: string | null;
}> => {
  const {
    session,
    intentHints,
    executionStrategy,
    finalCandidate,
    selectedFinalRaw,
    finalText,
    errorCode,
    deps,
    completeTaskSession,
  } = params;

  if (session.routedIntent !== 'task') {
    const terminalStatus = await maybeCompleteNonTaskSession({
      session,
      intentHints,
      deps,
    });
    return {
      status: terminalStatus,
      finalText: terminalStatus ? (session.result || finalText || null) : (finalText || null),
      errorCode: terminalStatus && session.error ? session.error : (errorCode ?? null),
      selectedFinalRaw: selectedFinalRaw || null,
    };
  }

  const resolvedFinalRaw = selectedFinalRaw || finalCandidate || finalText;
  if (!String(resolvedFinalRaw || '').trim()) {
    throw new Error('LANGGRAPH_PRIMARY_RESULT_MISSING');
  }

  const traceLabel = executionStrategy === 'requested_skill'
    ? 'single_skill'
    : executionStrategy === 'fast_path'
      ? 'fast_path'
      : 'final_output';
  const status = completeTaskSession(String(resolvedFinalRaw), traceLabel);

  return {
    status,
    finalText: session.result,
    errorCode: errorCode ?? null,
    selectedFinalRaw: String(resolvedFinalRaw),
  };
};

export const applySessionCompiledPrompt = (params: {
  session: AgentSession;
  deps: SessionPreludeDependencies;
}): {
  compiledPrompt: PromptCompileResult;
  taskGoal: string;
} => {
  const { session, deps } = params;
  const compiledPrompt = runCompilePromptNode(session.goal);
  const taskGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || session.goal;

  session.shadowGraph = {
    ...deps.ensureShadowGraph(session),
    compiledPrompt,
    executionGoal: taskGoal,
  };
  deps.traceShadowNode(
    session,
    'compile_prompt',
    compiledPrompt.directives.length > 0 || compiledPrompt.intentTags.length > 0 ? 'structured_directive' : 'plain_goal',
  );

  return {
    compiledPrompt,
    taskGoal,
  };
};

export const hydrateSessionMemory = async (params: {
  session: AgentSession;
  taskGoal: string;
  deps: SessionPreludeDependencies;
}): Promise<{ maxItems: number; memoryHints: string[] }> => {
  const { session, taskGoal, deps } = params;
  const hydrateMemory = await runHydrateMemoryNode({
    guildId: session.guildId,
    goal: taskGoal,
    priority: session.priority,
    requestedBy: session.requestedBy,
    loadHints: (input) => withTimeout(buildAgentMemoryHints({
      ...input,
      personalizationSnapshot: session.personalization,
    }), deps.agentMemoryHintTimeoutMs, 'MEMORY_HINT_TIMEOUT').catch(() => []),
  });

  session.memoryHints = hydrateMemory.memoryHints;
  session.shadowGraph = {
    ...deps.ensureShadowGraph(session),
    memoryHints: [...session.memoryHints],
  };
  deps.traceShadowNode(session, 'hydrate_memory', `count=${session.memoryHints.length}`);
  deps.touch(session);

  return hydrateMemory;
};

export const runSessionIntentClassification = async (params: {
  session: AgentSession;
  taskGoal: string;
  compiledPrompt: PromptCompileResult;
  sessionStartedAtMs: number;
  deps: SessionPreludeDependencies;
}): Promise<{ intentHints: string[] }> => {
  const { session, taskGoal, compiledPrompt, sessionStartedAtMs, deps } = params;

  ensureSessionBudget(sessionStartedAtMs, deps.agentSessionTimeoutMs);
  const intentHints = await withTimeout(buildAgentMemoryHints({
    guildId: session.guildId,
    goal: taskGoal,
    maxItems: 4,
    requesterUserId: session.requestedBy,
    personalizationSnapshot: session.personalization,
  }), deps.agentMemoryHintTimeoutMs, 'INTENT_HINT_TIMEOUT').catch((): string[] => []);

  const outcomes = deps.getRecentSessionOutcomes(session.guildId);
  const recentFailures = outcomes.filter((entry) => entry.status === 'failed' && entry.error);
  if (recentFailures.length > 0) {
    intentHints.push(
      ...recentFailures.slice(0, 2).map((entry) => `[최근 실패] "${entry.goalSnippet}" → ${String(entry.error).slice(0, 80)}`),
    );
  }

  const intentSignals = await withTimeout(enrichIntentSignals({
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    goal: taskGoal,
    compiledPrompt,
    memoryHints: intentHints,
  }), deps.agentMemoryHintTimeoutMs, 'INTENT_ENRICHMENT_TIMEOUT').catch(() => null);

  const intentClassification = await runClassifyIntentNode({
    goal: compiledPrompt.normalizedGoal || taskGoal,
    requestedSkillId: session.requestedSkillId,
    intentHints,
    signals: intentSignals,
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    sessionId: session.id,
    providerProfile: deps.resolveEffectiveSessionProviderProfile(session),
  });

  session.routedIntent = intentClassification.legacyIntent;
  session.intentClassification = intentClassification;

  void persistIntentExemplar({
    guildId: session.guildId,
    message: compiledPrompt.normalizedGoal || taskGoal,
    signalSnapshot: intentSignals ? {
      intentTags: intentSignals.compiledPrompt.intentTags,
      graphClusterHint: intentSignals.graphClusterHint,
      graphNeighborTags: intentSignals.graphNeighborTags.slice(0, 5),
      turnPosition: intentSignals.turnPosition,
    } : {},
    classification: intentClassification,
    sessionId: session.id,
  });

  session.shadowGraph = {
    ...deps.ensureShadowGraph(session),
    intent: session.routedIntent,
  };
  deps.traceShadowNode(
    session,
    'route_intent',
    `${intentClassification.primary}(${intentClassification.confidence.toFixed(2)})→${session.routedIntent}|src=${intentClassification.source}`,
  );

  return { intentHints };
};

export const applySessionPolicyTransition = (params: {
  session: AgentSession;
  taskGoal: string;
  deps: SessionPreludeDependencies;
}) => {
  const { session, taskGoal, deps } = params;
  const policyTransition = runTaskPolicyGateTransitionNode({
    routedIntent: session.routedIntent,
    guildId: session.guildId,
    taskGoal,
    evaluateGate: runPolicyGateNode,
    buildPolicyBlockMessage,
  });

  session.deliberationMode = policyTransition.deliberationMode;
  session.riskScore = policyTransition.riskScore;
  session.policyGate = {
    decision: policyTransition.policyGate.decision,
    reasons: [...policyTransition.policyGate.reasons],
  };
  session.shadowGraph = {
    ...deps.ensureShadowGraph(session),
    policyDecision: policyTransition.policyGate.decision,
  };
  deps.traceShadowNode(session, 'policy_gate', policyTransition.traceNote);
  if (policyTransition.privacySample) {
    void recordPrivacyGateSample({
      guildId: session.guildId,
      sessionId: session.id,
      mode: policyTransition.privacySample.mode,
      decision: policyTransition.privacySample.decision,
      riskScore: policyTransition.privacySample.riskScore,
      reasons: policyTransition.privacySample.reasons,
      goal: policyTransition.privacySample.goal,
    });
  }

  return policyTransition;
};

export const applySessionPolicyGateState = (params: {
  session: AgentSession;
  taskGoal: string;
  deps: SessionPreludeDependencies;
}): {
  status: AgentSessionStatus | null;
  finalText: string | null;
} => {
  const { session, deps } = params;
  const policyTransition = applySessionPolicyTransition(params);

  if (policyTransition.shouldBlock && policyTransition.blockResult) {
    const timestamp = deps.nowIso();
    deps.cancelAllPendingSteps(session, timestamp);
    deps.markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: policyTransition.blockResult,
      error: null,
    });
    return {
      status: session.cancelRequested ? 'cancelled' : 'completed',
      finalText: policyTransition.blockResult,
    };
  }

  deps.touch(session);
  return {
    status: null,
    finalText: null,
  };
};

export const applySessionExecutionStrategy = (params: {
  session: AgentSession;
  selection: {
    strategy: ExecutionStrategy;
    traceNote: string;
  };
  deps: SessionPreludeDependencies;
}): void => {
  const { session, selection, deps } = params;
  session.shadowGraph = {
    ...deps.ensureShadowGraph(session),
    executionStrategy: selection.strategy,
    policyDecision: session.policyGate?.decision || null,
  };
  deps.traceShadowNode(session, 'select_execution_strategy', selection.traceNote);
};

export const maybeCompleteNonTaskSession = async (params: {
  session: AgentSession;
  intentHints: string[];
  deps: SessionPreludeDependencies;
}): Promise<AgentSessionStatus | null> => {
  const { session, intentHints, deps } = params;
  const recentTurns = session.routedIntent === 'casual_chat'
    ? await fetchRecentTurnsForUser({ guildId: session.guildId, requestedBy: session.requestedBy, limit: 4 }).catch(() => [])
    : [];

  const nonTaskOutcome = await runNonTaskIntentNode({
    routedIntent: session.routedIntent,
    goal: session.goal,
    intentHints,
    recentTurns,
    generateCasualReply: generateCasualChatResult,
    generateClarification: generateIntentClarificationResult,
  });
  if (!nonTaskOutcome) {
    return null;
  }

  const timestamp = deps.nowIso();
  deps.cancelAllPendingSteps(session, timestamp);
  deps.traceShadowNode(session, 'compose_response', nonTaskOutcome.traceNote);
  deps.markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: nonTaskOutcome.result,
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};
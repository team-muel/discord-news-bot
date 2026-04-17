import type { AgentSessionStatus, AgentSession } from '../../multiAgentTypes';
import type { TrafficRoutingDecision } from '../../workflow/trafficRoutingService';
import type { LangGraphNodeId } from '../stateContract';
import type { ShadowRunResult } from '../shadowGraphRunner';

export type TerminalSessionFailure = {
  status: 'cancelled' | 'failed';
  error: string;
};

type PersistAndEmitNodeResult = {
  shadowGraph: NonNullable<AgentSession['shadowGraph']>;
  assistantPayload?: string | null;
};

type TerminalConversationTurn = {
  threadId: number | null;
  turnIndex: number | null;
};

type TerminalPromotabilityResult = {
  promotable: boolean;
  reason: string;
};

type TerminalMemoryHintInput = {
  guildId: string;
  goal: string;
  maxItems: number;
  requesterUserId: string;
};

export type MarkSessionTerminalDependencies = {
  langGraphNodeIds: readonly LangGraphNodeId[];
  ensureShadowGraph: (session: AgentSession) => NonNullable<AgentSession['shadowGraph']>;
  runPersistAndEmitNode: (params: {
    shadowGraph: NonNullable<AgentSession['shadowGraph']>;
    status: AgentSessionStatus;
    currentResult: AgentSession['result'];
    currentError: AgentSession['error'];
    patch: {
      result?: AgentSession['result'];
      error?: AgentSession['error'];
    };
  }) => PersistAndEmitNodeResult;
  nowIso: () => string;
  clearSessionCheckpoint: (session: AgentSession) => void;
  touch: (session: AgentSession) => void;
  persistSession: (session: AgentSession) => void;
  persistTrafficRoutingDecision?: (params: {
    sessionId: string;
    guildId: string;
    decision: NonNullable<AgentSession['trafficRoutingDecision']>;
  }) => void | Promise<unknown>;
  recordComplexityMetric: (session: AgentSession) => void;
  recordSessionOutcome: (session: AgentSession, status: AgentSessionStatus) => void;
  precipitateSessionToMemory: (params: {
    sessionId: string;
    guildId: string;
    goal: string;
    result: AgentSession['result'];
    status: AgentSessionStatus;
    stepCount: number;
    requestedBy: string;
  }) => Promise<unknown>;
  attributeAndPersistIntentOutcome: (params: {
    sessionId: string;
    guildId: string;
    intentConfidence: number;
    intentPrimary: string;
    sessionStatus: AgentSessionStatus;
    sessionReward: number | null;
    userClarifiedWithinTurns: boolean;
    stepFailureCount: number;
  }) => Promise<unknown>;
  logIntentAttributionFailure: (sessionId: string, error: unknown) => void;
  bindSessionAssistantTurn: (params: {
    guildId: string;
    requestedBy: string;
    sessionId: string;
    threadId: AgentSession['conversationThreadId'];
    content: string;
    status: AgentSessionStatus;
    error: AgentSession['error'];
  }) => Promise<TerminalConversationTurn | null | undefined>;
  getSession: (sessionId: string) => AgentSession | undefined;
  getSessionExecutionEngine: (session: AgentSession) => string;
  runLangGraphExecutorShadowReplay: (session: AgentSession, status: AgentSessionStatus) => void | Promise<unknown>;
  isShadowRunnerEnabled: () => boolean;
  runShadowGraph: (params: {
    sessionId: string;
    guildId: string;
    requestedBy: string;
    priority: AgentSession['priority'];
    requestedSkillId: AgentSession['requestedSkillId'];
    goal: string;
    mainPathNodes: LangGraphNodeId[];
    loadMemoryHints: (input: TerminalMemoryHintInput) => Promise<string[]>;
  }) => Promise<ShadowRunResult>;
  loadMemoryHints: (input: TerminalMemoryHintInput) => Promise<string[]>;
  persistShadowDivergence: (params: {
    sessionId: string;
    guildId: string;
    result: ShadowRunResult;
    mainFinalStatus: AgentSessionStatus;
  }) => void | Promise<unknown>;
  isShadowResultPromotable: (result: ShadowRunResult, status: AgentSessionStatus) => TerminalPromotabilityResult;
  logShadowPromotable: (sessionId: string, route: string, reason: string) => void;
  logShadowNotPromotable: (sessionId: string, route: string, reason: string) => void;
};

const NETWORK_ERROR_PATTERN = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket hang up/i;

export const isTerminalStatus = (status: AgentSessionStatus): boolean => {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
};

export const markSessionTerminal = (params: {
  session: AgentSession;
  status: AgentSessionStatus;
  patch?: Partial<AgentSession>;
  deps: MarkSessionTerminalDependencies;
}): void => {
  const { session, status, patch, deps } = params;
  const nodeResult = deps.runPersistAndEmitNode({
    shadowGraph: deps.ensureShadowGraph(session),
    status,
    currentResult: session.result,
    currentError: session.error,
    patch: {
      result: patch?.result,
      error: patch?.error,
    },
  });

  session.shadowGraph = nodeResult.shadowGraph;

  session.status = status;
  session.endedAt = deps.nowIso();
  if (patch?.result !== undefined) {
    session.result = patch.result;
  }
  if (patch?.error !== undefined) {
    session.error = patch.error;
  }
  deps.clearSessionCheckpoint(session);
  deps.touch(session);
  deps.persistSession(session);
  if (session.trafficRoutingDecision && deps.persistTrafficRoutingDecision) {
    void deps.persistTrafficRoutingDecision({
      sessionId: session.id,
      guildId: session.guildId,
      decision: session.trafficRoutingDecision,
    });
  }

  deps.recordComplexityMetric(session);
  deps.recordSessionOutcome(session, status);

  void deps.precipitateSessionToMemory({
    sessionId: session.id,
    guildId: session.guildId,
    goal: session.goal,
    result: session.result,
    status,
    stepCount: session.steps.length,
    requestedBy: session.requestedBy,
  }).catch(() => {
    // Best-effort precipitation.
  });

  const intentConfidence = session.intentClassification?.confidence ?? 0.5;
  const intentPrimary = session.intentClassification?.primary || session.shadowGraph?.intent || 'info_seek';
  const failedStepCount = session.steps.filter((step) => step.status === 'failed').length;
  const completedStepCount = session.steps.filter((step) => step.status === 'completed').length;
  const totalSteps = session.steps.length;
  const sessionReward = totalSteps > 0
    ? Math.max(0, Math.min(1, completedStepCount / totalSteps - failedStepCount * 0.2))
    : (status === 'completed' ? 0.6 : status === 'failed' ? 0.2 : null);
  const earlyStepFailureWithLowConfidence = failedStepCount > 0
    && totalSteps >= 2
    && intentConfidence < 0.5;

  void deps.attributeAndPersistIntentOutcome({
    sessionId: session.id,
    guildId: session.guildId,
    intentConfidence,
    intentPrimary,
    sessionStatus: status,
    sessionReward,
    userClarifiedWithinTurns: earlyStepFailureWithLowConfidence,
    stepFailureCount: failedStepCount,
  }).catch((error) => {
    deps.logIntentAttributionFailure(session.id, error);
  });

  const shadowTraceNodes = session.shadowGraph
    ? session.shadowGraph.trace
      .map((entry) => entry.node)
      .filter((node): node is LangGraphNodeId => deps.langGraphNodeIds.includes(node))
    : [];

  session.shadowGraph = null;
  for (const step of session.steps) {
    step.output = null;
  }

  const assistantPayload = nodeResult.assistantPayload;
  if (assistantPayload) {
    void deps.bindSessionAssistantTurn({
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      sessionId: session.id,
      threadId: session.conversationThreadId,
      content: assistantPayload,
      status,
      error: session.error,
    }).then((turn) => {
      if (!turn) {
        return;
      }
      const target = deps.getSession(session.id);
      if (!target) {
        return;
      }
      target.conversationThreadId = turn.threadId;
      target.conversationTurnIndex = turn.turnIndex;
      deps.touch(target);
      deps.persistSession(target);
    }).catch(() => {
      // Best-effort turn logging.
    });
  }

  const executionEngine = deps.getSessionExecutionEngine(session);
  if (executionEngine !== 'langgraphjs') {
    void deps.runLangGraphExecutorShadowReplay(session, status);
  }

  if (executionEngine !== 'langgraphjs' && deps.isShadowRunnerEnabled()) {
    void deps.runShadowGraph({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
      requestedSkillId: session.requestedSkillId,
      goal: session.goal,
      mainPathNodes: shadowTraceNodes,
      loadMemoryHints: deps.loadMemoryHints,
    }).then((result) => {
      void deps.persistShadowDivergence({
        sessionId: session.id,
        guildId: session.guildId,
        result,
        mainFinalStatus: status,
      });

      const routeDecision = session.trafficRoutingDecision;
      if (!routeDecision || routeDecision.route === 'main') {
        return;
      }

      const promotability = deps.isShadowResultPromotable(result, status);
      if (promotability.promotable) {
        deps.logShadowPromotable(session.id, routeDecision.route, promotability.reason);
        return;
      }

      deps.logShadowNotPromotable(session.id, routeDecision.route, promotability.reason);
    }).catch(() => {
      // Best-effort shadow execution.
    });
  }
};

export const buildLangGraphPrimaryFallbackDecision = (
  priorDecision: TrafficRoutingDecision | null | undefined,
  fallbackError: string,
): TrafficRoutingDecision => {
  if (priorDecision) {
    return {
      ...priorDecision,
      route: 'main',
      reason: `langgraph_primary_fallback:${fallbackError}`,
      policySnapshot: {
        ...priorDecision.policySnapshot,
        requestedRoute: priorDecision.route,
        fallbackError,
      },
    };
  }

  return {
    route: 'main',
    reason: `langgraph_primary_fallback:${fallbackError}`,
    gotCutoverAllowed: false,
    rolloutPercentage: 0,
    stableBucket: 0,
    shadowDivergenceRate: null,
    shadowQualityDelta: null,
    readinessRecommended: false,
    policySnapshot: {
      fallbackError,
    },
  };
};

export const applyLangGraphPrimaryFallback = (params: {
  session: AgentSession;
  errorMessage: string;
  applyTrafficRoutingDecisionToSession: (session: AgentSession, decision: TrafficRoutingDecision | null) => void;
  touch: (session: AgentSession) => void;
  persistSession: (session: AgentSession) => void;
}): void => {
  const fallbackDecision = buildLangGraphPrimaryFallbackDecision(
    params.session.trafficRoutingDecision,
    params.errorMessage,
  );

  params.applyTrafficRoutingDecisionToSession(params.session, fallbackDecision);
  params.session.shadowGraph = null;
  params.session.memoryHints = [];
  params.touch(params.session);
  params.persistSession(params.session);
};

export const resolveTerminalSessionFailure = (params: {
  rawErrorMessage: string;
  cancelRequested: boolean;
}): TerminalSessionFailure => {
  const rawErrorMessage = String(params.rawErrorMessage || '');

  if (params.cancelRequested || rawErrorMessage === 'SESSION_CANCELLED') {
    return {
      status: 'cancelled',
      error: '사용자 요청으로 중지되었습니다.',
    };
  }

  if (rawErrorMessage === 'SESSION_TIMEOUT') {
    return {
      status: 'failed',
      error: '처리 시간이 길어져 세션을 종료했습니다. 요청 범위를 줄여 다시 시도해주세요.',
    };
  }

  if (rawErrorMessage.startsWith('STEP_TIMEOUT:')) {
    const role = rawErrorMessage.split(':')[1] || 'unknown';
    return {
      status: 'failed',
      error: `단계 처리 시간이 초과되었습니다(${role}). 잠시 후 다시 시도해주세요.`,
    };
  }

  const isNetworkError = NETWORK_ERROR_PATTERN.test(rawErrorMessage)
    || rawErrorMessage === 'LLM_REQUEST_FAILED'
    || rawErrorMessage === 'LLM_PROVIDER_CHAIN_TIMEOUT'
    || rawErrorMessage === 'LLM_PROVIDER_NOT_CONFIGURED';

  return {
    status: 'failed',
    error: isNetworkError
      ? 'AI 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'
      : rawErrorMessage,
  };
};
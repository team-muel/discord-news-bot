import type { AgentSession } from '../../multiAgentTypes';
import type { TrafficRoutingDecision } from '../../workflow/trafficRoutingService';

export const getSessionExecutionEngine = (session: AgentSession): 'main' | 'langgraphjs' => {
  return session.executionEngine === 'langgraphjs' ? 'langgraphjs' : 'main';
};

export const applyTrafficRoutingDecisionToSession = (
  session: AgentSession,
  decision: TrafficRoutingDecision | null,
  resolvedAt?: string | null,
): void => {
  session.trafficRoutingDecision = decision;
  session.trafficRoute = decision?.route || 'main';
  session.trafficRouteResolvedAt = decision ? (resolvedAt ?? new Date().toISOString()) : null;
  session.executionEngine = decision?.route === 'langgraph' ? 'langgraphjs' : 'main';
};

export const normalizeTrafficRoutingDecision = (
  decision: TrafficRoutingDecision,
  shadowRunnerEnabled: boolean,
): TrafficRoutingDecision => {
  if (decision.route === 'shadow' && !shadowRunnerEnabled) {
    return {
      ...decision,
      route: 'main',
      reason: `shadow_runner_disabled:${decision.reason}`,
      policySnapshot: {
        ...decision.policySnapshot,
        requestedRoute: decision.route,
        shadowRunnerEnabled,
      },
    };
  }

  return {
    ...decision,
    policySnapshot: {
      ...decision.policySnapshot,
      shadowRunnerEnabled,
    },
  };
};

export const buildFallbackTrafficRoutingDecision = (params: {
  error: unknown;
  trafficRoutingEnabled: boolean;
  shadowRunnerEnabled: boolean;
  getErrorMessage: (error: unknown) => string;
}): TrafficRoutingDecision => {
  const resolutionError = params.getErrorMessage(params.error);
  return {
    route: 'main',
    reason: `traffic_routing_resolution_failed:${resolutionError}`,
    gotCutoverAllowed: false,
    rolloutPercentage: 0,
    stableBucket: 0,
    shadowDivergenceRate: null,
    shadowQualityDelta: null,
    readinessRecommended: false,
    policySnapshot: {
      trafficRoutingEnabled: params.trafficRoutingEnabled,
      shadowRunnerEnabled: params.shadowRunnerEnabled,
      resolutionError,
    },
  };
};

export const resolveSessionTrafficRoute = async (params: {
  session: AgentSession;
  trafficRoutingEnabled: boolean;
  isShadowRunnerEnabled: () => boolean;
  getAgentGotCutoverDecision: (params: { guildId: string; sessionId: string }) => Promise<{
    guildId: string;
    allowed: boolean;
    readinessRecommended: boolean;
    rolloutPercentage: number;
    selectedByRollout: boolean;
    reason: string;
    failedReasons: string[];
    evaluatedAt: string;
    windowDays: number;
  }>;
  resolveTrafficRoute: (params: {
    sessionId: string;
    guildId: string;
    priority: AgentSession['priority'];
    gotCutoverDecision: {
      guildId: string;
      allowed: boolean;
      readinessRecommended: boolean;
      rolloutPercentage: number;
      selectedByRollout: boolean;
      reason: string;
      failedReasons: string[];
      evaluatedAt: string;
      windowDays: number;
    };
  }) => Promise<TrafficRoutingDecision>;
  touch: (session: AgentSession) => void;
  persistSession: (session: AgentSession) => void;
  getErrorMessage: (error: unknown) => string;
  nowIso: () => string;
  logInfo: (message: string, ...args: unknown[]) => void;
  logWarn: (message: string, ...args: unknown[]) => void;
}): Promise<TrafficRoutingDecision | null> => {
  const {
    session,
    trafficRoutingEnabled,
    isShadowRunnerEnabled,
    getAgentGotCutoverDecision,
    resolveTrafficRoute,
    touch,
    persistSession,
    getErrorMessage,
    nowIso,
    logInfo,
    logWarn,
  } = params;

  if (!trafficRoutingEnabled) {
    applyTrafficRoutingDecisionToSession(session, null, null);
    return null;
  }

  try {
    const gotDecision = await getAgentGotCutoverDecision({
      guildId: session.guildId,
      sessionId: session.id,
    });
    const resolvedDecision = await resolveTrafficRoute({
      sessionId: session.id,
      guildId: session.guildId,
      priority: session.priority,
      gotCutoverDecision: gotDecision,
    });
    const normalizedDecision = normalizeTrafficRoutingDecision(resolvedDecision, isShadowRunnerEnabled());
    applyTrafficRoutingDecisionToSession(session, normalizedDecision, nowIso());
    touch(session);
    persistSession(session);
    logInfo(
      '[TRAFFIC-ROUTING] session=%s route=%s engine=%s reason=%s',
      session.id,
      normalizedDecision.route,
      getSessionExecutionEngine(session),
      normalizedDecision.reason,
    );
    return normalizedDecision;
  } catch (error) {
    const fallbackDecision = buildFallbackTrafficRoutingDecision({
      error,
      trafficRoutingEnabled,
      shadowRunnerEnabled: isShadowRunnerEnabled(),
      getErrorMessage,
    });
    applyTrafficRoutingDecisionToSession(session, fallbackDecision, nowIso());
    touch(session);
    persistSession(session);
    logWarn(
      '[TRAFFIC-ROUTING] session=%s resolution fallback: %s',
      session.id,
      fallbackDecision.reason,
    );
    return fallbackDecision;
  }
};
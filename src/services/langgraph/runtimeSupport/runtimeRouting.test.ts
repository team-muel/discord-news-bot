import { describe, expect, it, vi } from 'vitest';

import type { AgentSession } from '../../multiAgentTypes';
import {
  applyTrafficRoutingDecisionToSession,
  buildFallbackTrafficRoutingDecision,
  normalizeTrafficRoutingDecision,
  resolveSessionTrafficRoute,
} from './runtimeRouting';

const buildSession = (): AgentSession => ({
  id: 'session-1',
  guildId: 'guild-1',
  requestedBy: 'user-1',
  goal: 'goal',
  conversationThreadId: null,
  conversationTurnIndex: null,
  priority: 'balanced',
  requestedSkillId: null,
  routedIntent: 'task',
  status: 'queued',
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
  startedAt: null,
  endedAt: null,
  result: null,
  error: null,
  cancelRequested: false,
  trafficRoute: 'main',
  trafficRoutingDecision: null,
  trafficRouteResolvedAt: null,
  executionEngine: 'main',
  graphCheckpoint: null,
  hitlState: null,
  personalization: undefined,
  memoryHints: [],
  steps: [],
  shadowGraph: null,
});

describe('runtimeRouting', () => {
  it('applyTrafficRoutingDecisionToSession updates route, engine, and resolved time', () => {
    const session = buildSession();

    applyTrafficRoutingDecisionToSession(session, {
      route: 'langgraph',
      reason: 'test-route',
      gotCutoverAllowed: true,
      rolloutPercentage: 100,
      stableBucket: 42,
      shadowDivergenceRate: 0.1,
      shadowQualityDelta: 0.2,
      readinessRecommended: true,
      policySnapshot: {},
    }, '2026-04-16T12:00:00.000Z');

    expect(session.trafficRoute).toBe('langgraph');
    expect(session.executionEngine).toBe('langgraphjs');
    expect(session.trafficRouteResolvedAt).toBe('2026-04-16T12:00:00.000Z');
  });

  it('normalizeTrafficRoutingDecision rewrites shadow routes when the shadow runner is disabled', () => {
    const normalized = normalizeTrafficRoutingDecision({
      route: 'shadow',
      reason: 'candidate-shadow',
      gotCutoverAllowed: false,
      rolloutPercentage: 10,
      stableBucket: 9,
      shadowDivergenceRate: null,
      shadowQualityDelta: null,
      readinessRecommended: false,
      policySnapshot: {},
    }, false);

    expect(normalized.route).toBe('main');
    expect(normalized.reason).toBe('shadow_runner_disabled:candidate-shadow');
    expect(normalized.policySnapshot).toMatchObject({
      requestedRoute: 'shadow',
      shadowRunnerEnabled: false,
    });
  });

  it('buildFallbackTrafficRoutingDecision captures the resolution error in policy snapshot', () => {
    const decision = buildFallbackTrafficRoutingDecision({
      error: new Error('boom'),
      trafficRoutingEnabled: true,
      shadowRunnerEnabled: false,
      getErrorMessage: (error) => String((error as Error).message),
    });

    expect(decision).toMatchObject({
      route: 'main',
      reason: 'traffic_routing_resolution_failed:boom',
      policySnapshot: {
        trafficRoutingEnabled: true,
        shadowRunnerEnabled: false,
        resolutionError: 'boom',
      },
    });
  });

  it('resolveSessionTrafficRoute normalizes and persists a resolved decision', async () => {
    const session = buildSession();
    const touch = vi.fn();
    const persistSession = vi.fn();
    const logInfo = vi.fn();

    const decision = await resolveSessionTrafficRoute({
      session,
      trafficRoutingEnabled: true,
      isShadowRunnerEnabled: () => false,
      getAgentGotCutoverDecision: vi.fn(async () => ({
        guildId: 'guild-1',
        allowed: true,
        readinessRecommended: true,
        rolloutPercentage: 100,
        selectedByRollout: true,
        reason: 'ready',
        failedReasons: [],
        evaluatedAt: '2026-04-16T12:00:00.000Z',
        windowDays: 14,
      })),
      resolveTrafficRoute: vi.fn(async () => ({
        route: 'shadow' as const,
        reason: 'candidate-shadow',
        gotCutoverAllowed: false,
        rolloutPercentage: 10,
        stableBucket: 5,
        shadowDivergenceRate: null,
        shadowQualityDelta: null,
        readinessRecommended: true,
        policySnapshot: {},
      })),
      touch,
      persistSession,
      getErrorMessage: (error) => String(error),
      nowIso: () => '2026-04-16T12:00:00.000Z',
      logInfo,
      logWarn: vi.fn(),
    });

    expect(decision?.route).toBe('main');
    expect(session.trafficRoute).toBe('main');
    expect(session.executionEngine).toBe('main');
    expect(touch).toHaveBeenCalledWith(session);
    expect(persistSession).toHaveBeenCalledWith(session);
    expect(logInfo).toHaveBeenCalledWith(
      '[TRAFFIC-ROUTING] session=%s route=%s engine=%s reason=%s',
      'session-1',
      'main',
      'main',
      'shadow_runner_disabled:candidate-shadow',
    );
  });
});
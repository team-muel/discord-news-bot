import { describe, expect, it } from 'vitest';

import { buildMultiAgentRuntimeSnapshot, createRecentSessionOutcomeStore } from './multiAgentSnapshot';
import type { AgentSession } from './multiAgentTypes';

const buildSession = (overrides?: Partial<AgentSession>): AgentSession => ({
  id: overrides?.id || 'session-1',
  guildId: overrides?.guildId || 'guild-1',
  requestedBy: overrides?.requestedBy || 'user-1',
  goal: overrides?.goal || 'reduce coupling',
  requestedSkillId: overrides?.requestedSkillId || null,
  routedIntent: overrides?.routedIntent || 'info_seek',
  priority: overrides?.priority || 'balanced',
  status: overrides?.status || 'queued',
  createdAt: overrides?.createdAt || '2026-04-16T00:00:00.000Z',
  updatedAt: overrides?.updatedAt || '2026-04-16T00:00:00.000Z',
  startedAt: overrides?.startedAt || null,
  endedAt: overrides?.endedAt || null,
  result: overrides?.result || null,
  error: overrides?.error || null,
  memoryHints: overrides?.memoryHints || [],
  steps: overrides?.steps || [],
  shadowGraph: overrides?.shadowGraph || null,
  graphCheckpoint: overrides?.graphCheckpoint || null,
  cancelRequested: overrides?.cancelRequested || false,
  executionEngine: overrides?.executionEngine || 'main',
  hitlState: overrides?.hitlState || null,
  conversationThreadId: overrides?.conversationThreadId || null,
  conversationTurnIndex: overrides?.conversationTurnIndex || null,
  trafficRoutingDecision: overrides?.trafficRoutingDecision || null,
  personalization: overrides?.personalization || undefined,
  intentClassification: overrides?.intentClassification || null,
} as AgentSession);

describe('multiAgentSnapshot', () => {
  it('builds runtime snapshot from injected session and queue state', () => {
    const snapshot = buildMultiAgentRuntimeSnapshot({
      sessions: [
        buildSession({ id: 'completed-1', status: 'completed', updatedAt: '2026-04-16T00:01:00.000Z' }),
        buildSession({ id: 'failed-1', status: 'failed', updatedAt: '2026-04-16T00:02:00.000Z' }),
        buildSession({ id: 'cancelled-1', status: 'cancelled', updatedAt: '2026-04-16T00:03:00.000Z' }),
      ],
      queueRuntime: {
        getRunningCount: () => 2,
        getQueuedCount: () => 4,
        getDeadletterCount: () => 1,
      },
    });

    expect(snapshot).toEqual({
      totalSessions: 3,
      runningSessions: 2,
      queuedSessions: 4,
      completedSessions: 1,
      failedSessions: 1,
      cancelledSessions: 1,
      deadletteredSessions: 1,
      latestSessionAt: '2026-04-16T00:03:00.000Z',
    });
  });

  it('tracks and resets recent session outcomes independently from the service host', () => {
    const store = createRecentSessionOutcomeStore({ cacheSize: 10, ttlMs: 60_000, maxPerGuild: 2 });

    store.recordSessionOutcome(buildSession({
      id: 'completed-1',
      status: 'completed',
      goal: 'extract runtime snapshot',
      steps: [{
        id: 'step-1',
        role: 'researcher',
        title: 'snapshot',
        status: 'completed',
        startedAt: '2026-04-16T00:00:00.000Z',
        endedAt: '2026-04-16T00:00:00.000Z',
        output: null,
        error: null,
      }],
    }), 'completed');

    expect(store.getRecentSessionOutcomes('guild-1')).toEqual([
      expect.objectContaining({
        status: 'completed',
        goalSnippet: 'extract runtime snapshot',
        stepCount: 1,
      }),
    ]);

    store.reset();
    expect(store.getRecentSessionOutcomes('guild-1')).toEqual([]);
  });
});
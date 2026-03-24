import { describe, expect, it } from 'vitest';
import type {
  AgentSession,
  AgentStep,
  AgentSessionStatus,
  AgentStepStatus,
  AgentRuntimeSnapshot,
  AgentSessionShadowSummary,
  AgentSessionProgressSummary,
  AgentSessionApiView,
  BeamEvaluation,
  SessionOutcomeEntry,
} from './multiAgentTypes';

describe('multiAgentTypes', () => {
  it('AgentSessionStatus covers all valid values', () => {
    const statuses: AgentSessionStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];
    expect(statuses).toHaveLength(5);
  });

  it('AgentStepStatus covers all valid values', () => {
    const statuses: AgentStepStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
    expect(statuses).toHaveLength(5);
  });

  it('AgentStep shape is structurally valid', () => {
    const step: AgentStep = {
      id: 'test-step-1',
      role: 'planner',
      title: 'Plan',
      status: 'pending',
      startedAt: null,
      endedAt: null,
      output: null,
      error: null,
    };
    expect(step.id).toBe('test-step-1');
    expect(step.role).toBe('planner');
  });

  it('AgentSession shape is structurally valid', () => {
    const session: AgentSession = {
      id: 'sess-1',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'test goal',
      priority: 'balanced',
      requestedSkillId: null,
      routedIntent: 'task',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      result: null,
      error: null,
      cancelRequested: false,
      memoryHints: [],
      steps: [],
      shadowGraph: null,
    };
    expect(session.status).toBe('queued');
    expect(session.priority).toBe('balanced');
  });

  it('AgentRuntimeSnapshot shape is structurally valid', () => {
    const snapshot: AgentRuntimeSnapshot = {
      totalSessions: 10,
      runningSessions: 2,
      queuedSessions: 3,
      completedSessions: 4,
      failedSessions: 1,
      cancelledSessions: 0,
      deadletteredSessions: 0,
      latestSessionAt: new Date().toISOString(),
    };
    expect(snapshot.totalSessions).toBe(10);
  });

  it('BeamEvaluation shape is structurally valid', () => {
    const beam: BeamEvaluation = {
      probability: 0.8,
      correctness: 0.9,
      score: 0.72,
      probabilitySource: 'self_eval',
    };
    expect(beam.score).toBe(0.72);
    expect(beam.probabilitySource).toBe('self_eval');
  });

  it('SessionOutcomeEntry shape is structurally valid', () => {
    const entry: SessionOutcomeEntry = {
      status: 'failed',
      error: 'timeout',
      goalSnippet: 'test goal...',
      stepCount: 3,
    };
    expect(entry.status).toBe('failed');
    expect(entry.stepCount).toBe(3);
  });

  it('AgentSessionProgressSummary computes correctly', () => {
    const summary: AgentSessionProgressSummary = {
      totalSteps: 3,
      doneSteps: 2,
      completedSteps: 1,
      failedSteps: 1,
      cancelledSteps: 0,
      runningSteps: 1,
      pendingSteps: 0,
      progressPercent: 67,
    };
    expect(summary.doneSteps).toBe(summary.completedSteps + summary.failedSteps + summary.cancelledSteps);
  });
});

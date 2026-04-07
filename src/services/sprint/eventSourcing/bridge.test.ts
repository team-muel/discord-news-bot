import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shadowPipelineCreated,
  shadowPhaseCompleted,
  shadowFilesChanged,
  shadowPipelineCancelled,
  shadowPipelineBlocked,
  getEventSourcedEntity,
  rehydrateFromEvents,
  resetEventSourcingRepo,
} from './bridge';

import type { SprintPipeline, SprintPhase } from '../sprintOrchestrator';

// ── Mock supabaseClient so bridge falls back to in-memory adapter ─────────────

vi.mock('../../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('not configured'); },
}));

vi.mock('../../../config', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, SPRINT_DRY_RUN: false };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePipeline(overrides: Partial<SprintPipeline> = {}): SprintPipeline {
  return {
    sprintId: `sprint-test-${Date.now()}`,
    triggerId: 'trigger-1',
    triggerType: 'manual',
    guildId: 'guild-123',
    objective: 'Test objective',
    autonomyLevel: 'approve-ship',
    currentPhase: 'plan',
    phaseResults: {},
    phaseOrder: ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'],
    implementReviewLoopCount: 0,
    maxImplReviewLoops: 3,
    totalPhasesExecuted: 0,
    changedFiles: [],
    rollbackPlan: '',
    loopState: { count: 0, lastSignature: '', maxConsecutive: 5 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as SprintPipeline;
}

const now = () => new Date().toISOString();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventSourcing Bridge (in-memory)', () => {
  beforeEach(() => {
    resetEventSourcingRepo();
  });

  it('should shadow a pipeline creation', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity).toBeDefined();
    expect(entity!.currentPhase).toBe('plan');
    expect(entity!.state.objective).toBe('Test objective');
  });

  it('should shadow phase completion and advance state', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    await shadowPhaseCompleted(pipeline.sprintId, {
      phase: 'plan',
      status: 'success',
      output: 'Plan approved',
      artifacts: ['plan.md'],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity!.currentPhase).toBe('implement');
    expect(entity!.state.totalPhasesExecuted).toBe(1);
  });

  it('should shadow file changes', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    await shadowFilesChanged(pipeline.sprintId, ['src/a.ts', 'src/b.ts']);

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity!.state.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('should shadow cancellation', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    await shadowPipelineCancelled(pipeline.sprintId);

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity!.currentPhase).toBe('cancelled');
    expect(entity!.isTerminal).toBe(true);
  });

  it('should shadow blocking', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    await shadowPipelineBlocked(pipeline.sprintId, 'Crash during execution');

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity!.currentPhase).toBe('blocked');
    expect(entity!.state.error).toBe('Crash during execution');
  });

  it('should rehydrate from event store', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    await shadowPhaseCompleted(pipeline.sprintId, {
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });

    // Simulate restart: rehydrate from events
    const rehydrated = await rehydrateFromEvents(pipeline.sprintId);
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.currentPhase).toBe('implement');
    expect(rehydrated!.state.totalPhasesExecuted).toBe(1);
  });

  it('should silently handle shadow calls for non-existent pipelines', async () => {
    // These should not throw
    await shadowPhaseCompleted('non-existent', {
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    await shadowFilesChanged('non-existent', ['a.ts']);
    await shadowPipelineCancelled('non-existent');
    await shadowPipelineBlocked('non-existent', 'reason');
  });

  it('should shadow full pipeline lifecycle matching orchestrator flow', async () => {
    const pipeline = makePipeline();
    await shadowPipelineCreated(pipeline);

    // Walk through happy path phases
    const phases: SprintPhase[] = ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'];
    for (const phase of phases) {
      await shadowPhaseCompleted(pipeline.sprintId, {
        phase,
        status: 'success',
        output: `${phase} done`,
        artifacts: [],
        startedAt: now(),
        completedAt: now(),
        iterationCount: 1,
      });
    }

    const entity = getEventSourcedEntity(pipeline.sprintId);
    expect(entity!.currentPhase).toBe('complete');
    expect(entity!.isTerminal).toBe(true);
    expect(entity!.state.totalPhasesExecuted).toBe(7);
  });
});

import { describe, it, expect } from 'vitest';
import type { Adapter } from 'ventyd';
import { SprintPipelineEntity, createSprintPipelineRepository } from './sprintPipelineEntity';

// ── In-memory adapter for testing ─────────────────────────────────────────────

function createInMemoryAdapter(): Adapter {
  const store: any[] = [];
  return {
    async getEventsByEntityId({ entityName, entityId }) {
      return store.filter(
        (e) => e.entityName === entityName && e.entityId === entityId,
      );
    },
    async commitEvents({ events }) {
      store.push(...events);
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function createTestPipeline() {
  return SprintPipelineEntity.create({
    body: {
      triggerId: 'trigger-1',
      triggerType: 'manual',
      guildId: 'guild-123',
      objective: 'Fix login timeout bug',
      autonomyLevel: 'approve-ship',
      phaseOrder: ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'],
      maxImplReviewLoops: 3,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SprintPipelineEntity', () => {
  it('should create a pipeline with initial state', () => {
    const pipeline = createTestPipeline();

    expect(pipeline.currentPhase).toBe('plan');
    expect(pipeline.state.triggerId).toBe('trigger-1');
    expect(pipeline.state.guildId).toBe('guild-123');
    expect(pipeline.state.objective).toBe('Fix login timeout bug');
    expect(pipeline.state.autonomyLevel).toBe('approve-ship');
    expect(pipeline.state.implementReviewLoopCount).toBe(0);
    expect(pipeline.state.totalPhasesExecuted).toBe(0);
    expect(pipeline.state.changedFiles).toEqual([]);
    expect(pipeline.state.error).toBeNull();
    expect(pipeline.isTerminal).toBe(false);
  });

  it('should advance through phases on success', () => {
    const pipeline = createTestPipeline();

    // plan → implement
    pipeline.completePhase({
      phase: 'plan',
      status: 'success',
      output: 'Plan approved',
      artifacts: ['plan.md'],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('implement');
    expect(pipeline.state.totalPhasesExecuted).toBe(1);
    expect(pipeline.state.phaseResults['plan']).toBeDefined();
    expect(pipeline.state.phaseResults['plan'].status).toBe('success');

    // implement → review
    pipeline.completePhase({
      phase: 'implement',
      status: 'success',
      output: 'Code written',
      artifacts: ['src/fix.ts'],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('review');

    // review → qa (no security concerns)
    pipeline.completePhase({
      phase: 'review',
      status: 'success',
      output: 'LGTM, no issues found',
      artifacts: [],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('qa');
  });

  it('should route review to security-audit when security concern detected', () => {
    const pipeline = createTestPipeline();

    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Done',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });

    // Review flags a SECURITY_ISSUE
    pipeline.completePhase({
      phase: 'review',
      status: 'success',
      output: 'Found SECURITY_ISSUE with input validation',
      artifacts: [],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('security-audit');
  });

  it('should loop back from review to implement on failure', () => {
    const pipeline = createTestPipeline();

    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Done',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });

    // Review fails → loop back to implement
    pipeline.completePhase({
      phase: 'review',
      status: 'failed',
      output: 'Critical bug found',
      artifacts: [],
      startedAt: now(),
      completedAt: now(),
      iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('implement');
    expect(pipeline.state.implementReviewLoopCount).toBe(1);
    expect(pipeline.canLoopBack).toBe(true);
  });

  it('should block when max loops exceeded', () => {
    const pipeline = SprintPipelineEntity.create({
      body: {
        triggerId: 'trigger-2',
        triggerType: 'manual',
        guildId: 'guild-123',
        objective: 'Stubborn bug',
        autonomyLevel: 'full-auto',
        phaseOrder: ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'],
        maxImplReviewLoops: 1,
      },
    });

    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Done',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });

    // First failure → loops back (loopCount becomes 1, which equals max)
    pipeline.completePhase({
      phase: 'review', status: 'failed', output: 'Bug',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('implement');
    expect(pipeline.state.implementReviewLoopCount).toBe(1);

    // Second attempt
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Retry',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });

    // Second failure → blocked (loopCount 1 >= max 1)
    pipeline.completePhase({
      phase: 'review', status: 'failed', output: 'Still broken',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    expect(pipeline.currentPhase).toBe('blocked');
    expect(pipeline.isTerminal).toBe(true);
  });

  it('should complete full happy path through retro', () => {
    const pipeline = createTestPipeline();
    const phases = ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'] as const;

    for (const phase of phases) {
      pipeline.completePhase({
        phase, status: 'success', output: `${phase} done`,
        artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
      });
    }

    expect(pipeline.currentPhase).toBe('complete');
    expect(pipeline.isTerminal).toBe(true);
    expect(pipeline.state.totalPhasesExecuted).toBe(7);
  });

  it('should record changed files with dedup', () => {
    const pipeline = createTestPipeline();

    pipeline.recordChangedFiles(['src/a.ts', 'src/b.ts']);
    expect(pipeline.state.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);

    pipeline.recordChangedFiles(['src/b.ts', 'src/c.ts']);
    expect(pipeline.state.changedFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('should cancel a pipeline', () => {
    const pipeline = createTestPipeline();
    pipeline.cancel();

    expect(pipeline.currentPhase).toBe('cancelled');
    expect(pipeline.isTerminal).toBe(true);
  });

  it('should throw when mutating a terminal pipeline', () => {
    const pipeline = createTestPipeline();
    pipeline.cancel();

    expect(() => pipeline.cancel()).toThrow(/terminal/);
    expect(() => pipeline.block('reason')).toThrow(/terminal/);
    expect(() => pipeline.completePhase({
      phase: 'plan', status: 'success', output: '', artifacts: [],
      startedAt: now(), completedAt: now(), iterationCount: 1,
    })).toThrow(/terminal/);
  });

  it('should block with reason', () => {
    const pipeline = createTestPipeline();
    pipeline.block('External service unavailable');

    expect(pipeline.currentPhase).toBe('blocked');
    expect(pipeline.state.error).toBe('External service unavailable');
  });
});

// ── Repository persistence tests ──────────────────────────────────────────────

describe('SprintPipelineRepository (in-memory)', () => {
  it('should persist and rehydrate a pipeline from events', async () => {
    const adapter = createInMemoryAdapter();
    const repo = createSprintPipelineRepository(adapter);

    // Create and mutate
    const pipeline = createTestPipeline();
    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'Plan OK',
      artifacts: ['plan.md'], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    pipeline.recordChangedFiles(['src/fix.ts']);

    // Persist
    await repo.commit(pipeline);

    // Rehydrate from events
    const rehydrated = await repo.findOne({
      entityId: pipeline.entityId,
    });

    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.currentPhase).toBe('implement');
    expect(rehydrated!.state.phaseResults['plan']?.status).toBe('success');
    expect(rehydrated!.state.changedFiles).toEqual(['src/fix.ts']);
    expect(rehydrated!.state.guildId).toBe('guild-123');
  });

  it('should support incremental commits', async () => {
    const adapter = createInMemoryAdapter();
    const repo = createSprintPipelineRepository(adapter);

    // First commit
    const pipeline = createTestPipeline();
    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'OK',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    await repo.commit(pipeline);

    // Rehydrate, mutate, re-commit
    const loaded = await repo.findOne({ entityId: pipeline.entityId });
    expect(loaded).not.toBeNull();

    loaded!.completePhase({
      phase: 'implement', status: 'success', output: 'Code done',
      artifacts: [], startedAt: now(), completedAt: now(), iterationCount: 1,
    });
    await repo.commit(loaded!);

    // Verify full state
    const final = await repo.findOne({ entityId: pipeline.entityId });
    expect(final!.currentPhase).toBe('review');
    expect(final!.state.totalPhasesExecuted).toBe(2);
  });

  it('should reconstruct full audit trail via event replay', async () => {
    const adapter = createInMemoryAdapter();
    const repo = createSprintPipelineRepository(adapter);

    const pipeline = createTestPipeline();

    // Run through several phases
    pipeline.completePhase({
      phase: 'plan', status: 'success', output: 'Planned',
      artifacts: [], startedAt: '2026-04-04T10:00:00Z', completedAt: '2026-04-04T10:05:00Z', iterationCount: 1,
    });
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Built',
      artifacts: ['src/fix.ts'], startedAt: '2026-04-04T10:05:00Z', completedAt: '2026-04-04T10:20:00Z', iterationCount: 1,
    });
    pipeline.completePhase({
      phase: 'review', status: 'failed', output: 'Bug in error handling',
      artifacts: [], startedAt: '2026-04-04T10:20:00Z', completedAt: '2026-04-04T10:25:00Z', iterationCount: 1,
    });
    // Looped back, fix, then succeed
    pipeline.completePhase({
      phase: 'implement', status: 'success', output: 'Fixed error handling',
      artifacts: ['src/fix.ts'], startedAt: '2026-04-04T10:25:00Z', completedAt: '2026-04-04T10:35:00Z', iterationCount: 2,
    });

    await repo.commit(pipeline);

    // Rehydrate — state reflects the FULL history
    const rehydrated = await repo.findOne({ entityId: pipeline.entityId });
    expect(rehydrated!.currentPhase).toBe('review');
    expect(rehydrated!.state.implementReviewLoopCount).toBe(1);
    expect(rehydrated!.state.totalPhasesExecuted).toBe(4);
    expect(rehydrated!.state.phaseResults['review']?.output).toBe('Bug in error handling');
    // Second implement result overwrites the first in phaseResults (latest wins)
    expect(rehydrated!.state.phaseResults['implement']?.output).toBe('Fixed error handling');
  });
});

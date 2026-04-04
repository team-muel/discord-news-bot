import { describe, it, expect } from 'vitest';
import {
  executePipeline,
  actionChainToPipelinePlan,
  createPipelineContext,
  type PipelinePlan,
  type PipelineStep,
  type StepExecutor,
  type PipelineReplanner,
  type PipelineContext,
} from './pipelineEngine';
import type { ActionExecutionResult } from './actions/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeOkResult = (name: string, artifacts: string[] = []): ActionExecutionResult => ({
  ok: true,
  name,
  summary: `${name} succeeded`,
  artifacts,
  verification: ['test'],
});

const makeFailResult = (name: string, error: string): ActionExecutionResult => ({
  ok: false,
  name,
  summary: `${name} failed`,
  artifacts: [],
  verification: [],
  error,
});

const makeExecutor = (results: Map<string, ActionExecutionResult>): StepExecutor =>
  async (actionName) => results.get(actionName) || makeFailResult(actionName, 'NOT_FOUND');

const makeCtx = (goal = 'test goal'): PipelineContext => createPipelineContext({
  goal,
  guildId: 'test-guild',
  requestedBy: 'test-user',
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pipelineEngine', () => {
  describe('actionChainToPipelinePlan', () => {
    it('converts flat action list to pipeline steps', () => {
      const plan = actionChainToPipelinePlan([
        { actionName: 'web.search', args: { query: 'test' } },
        { actionName: 'rag.retrieve', args: { topic: 'news' } },
      ]);

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].name).toBe('step-1-web.search');
      expect(plan.steps[0].actionName).toBe('web.search');
      expect(plan.steps[0].type).toBe('action');
      expect(plan.steps[0].pipeOutput).toBe(true);
      expect(plan.steps[0].dependsOn).toBeUndefined();

      expect(plan.steps[1].name).toBe('step-2-rag.retrieve');
      expect(plan.steps[1].dependsOn).toEqual(['step-1-web.search']);
    });

    it('handles empty action list', () => {
      const plan = actionChainToPipelinePlan([]);
      expect(plan.steps).toHaveLength(0);
    });
  });

  describe('createPipelineContext', () => {
    it('creates context with empty state', () => {
      const ctx = makeCtx();
      expect(ctx.stepOutputs.size).toBe(0);
      expect(ctx.lastOutput).toEqual([]);
      expect(ctx.stepCount).toBe(0);
      expect(ctx.replanCount).toBe(0);
      expect(ctx.goal).toBe('test goal');
    });
  });

  describe('executePipeline — sequential actions', () => {
    it('executes single-action pipeline', async () => {
      const results = new Map([
        ['web.search', makeOkResult('web.search', ['result1'])],
      ]);

      const plan: PipelinePlan = {
        steps: [{
          name: 'search',
          type: 'action',
          actionName: 'web.search',
          args: { query: 'test' },
        }],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      expect(result.ok).toBe(true);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].ok).toBe(true);
      expect(result.steps[0].stepName).toBe('search');
      expect(result.finalOutput).toContain('result1');
    });

    it('chains sequential steps with data flow', async () => {
      const executor: StepExecutor = async (actionName, args) => {
        if (actionName === 'web.search') {
          return makeOkResult('web.search', ['search-data']);
        }
        // Check that piped data is available
        const prevData = args.__pipe_prev;
        return makeOkResult('rag.retrieve', [
          `processed: ${Array.isArray(prevData) ? prevData.join(',') : 'none'}`,
        ]);
      };

      const plan: PipelinePlan = {
        steps: [
          { name: 's1', type: 'action', actionName: 'web.search', args: {} },
          { name: 's2', type: 'action', actionName: 'rag.retrieve', args: {}, dependsOn: ['s1'] },
        ],
      };

      const result = await executePipeline(plan, executor, null, makeCtx());

      expect(result.ok).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[1].artifacts).toEqual(['processed: search-data']);
    });

    it('handles failed step without replanner', async () => {
      const results = new Map([
        ['web.search', makeFailResult('web.search', 'TIMEOUT')],
      ]);

      const plan: PipelinePlan = {
        steps: [{ name: 's1', type: 'action', actionName: 'web.search', args: {} }],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      expect(result.ok).toBe(false);
      expect(result.steps[0].ok).toBe(false);
      expect(result.steps[0].error).toBe('TIMEOUT');
    });

    it('handles missing action name', async () => {
      const plan: PipelinePlan = {
        steps: [{ name: 'bad', type: 'action', args: {} }],
      };

      const result = await executePipeline(plan, makeExecutor(new Map()), null, makeCtx());

      expect(result.ok).toBe(false);
      expect(result.steps[0].error).toBe('MISSING_ACTION_NAME');
    });
  });

  describe('executePipeline — branching', () => {
    it('takes then-branch when condition is true', async () => {
      const results = new Map([
        ['action.a', makeOkResult('action.a', ['a-output'])],
        ['action.then', makeOkResult('action.then', ['then-output'])],
      ]);

      const plan: PipelinePlan = {
        steps: [
          { name: 's1', type: 'action', actionName: 'action.a', args: {} },
          {
            name: 'branch1',
            type: 'branch',
            condition: (ctx) => ctx.stepOutputs.get('s1')?.ok === true,
            thenSteps: [
              { name: 'then-action', type: 'action', actionName: 'action.then', args: {} },
            ],
            elseSteps: [],
          },
        ],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      expect(result.ok).toBe(true);
      const stepNames = result.steps.map((s) => s.stepName);
      expect(stepNames).toContain('then-action');
    });

    it('takes else-branch when condition is false', async () => {
      const results = new Map([
        ['action.a', makeFailResult('action.a', 'FAILED')],
        ['action.else', makeOkResult('action.else', ['else-output'])],
      ]);

      const plan: PipelinePlan = {
        steps: [
          { name: 's1', type: 'action', actionName: 'action.a', args: {} },
          {
            name: 'branch1',
            type: 'branch',
            condition: (ctx) => ctx.stepOutputs.get('s1')?.ok === true,
            thenSteps: [],
            elseSteps: [
              { name: 'else-action', type: 'action', actionName: 'action.else', args: {} },
            ],
          },
        ],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      const stepNames = result.steps.map((s) => s.stepName);
      expect(stepNames).toContain('else-action');
      expect(stepNames).not.toContain('then-action');
    });
  });

  describe('executePipeline — parallel', () => {
    it('executes parallel steps concurrently', async () => {
      const results = new Map([
        ['action.a', makeOkResult('action.a', ['a-out'])],
        ['action.b', makeOkResult('action.b', ['b-out'])],
      ]);

      const plan: PipelinePlan = {
        steps: [{
          name: 'fan-out',
          type: 'parallel',
          parallelSteps: [
            { name: 'p1', type: 'action', actionName: 'action.a', args: {} },
            { name: 'p2', type: 'action', actionName: 'action.b', args: {} },
          ],
        }],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      expect(result.steps).toHaveLength(2);
      expect(result.steps.every((s) => s.ok)).toBe(true);
      expect(result.finalOutput).toContain('a-out');
      expect(result.finalOutput).toContain('b-out');
    });

    it('handles partial failure in parallel steps', async () => {
      const results = new Map([
        ['action.a', makeOkResult('action.a', ['a-out'])],
        ['action.b', makeFailResult('action.b', 'FAIL_B')],
      ]);

      const plan: PipelinePlan = {
        steps: [{
          name: 'fan-out',
          type: 'parallel',
          parallelSteps: [
            { name: 'p1', type: 'action', actionName: 'action.a', args: {} },
            { name: 'p2', type: 'action', actionName: 'action.b', args: {} },
          ],
        }],
      };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      expect(result.ok).toBe(false);
      expect(result.steps.some((s) => s.ok)).toBe(true);
      expect(result.steps.some((s) => !s.ok)).toBe(true);
    });
  });

  describe('executePipeline — replanning', () => {
    it('replans on failure when replanner is provided', async () => {
      let callCount = 0;
      const executor: StepExecutor = async (actionName) => {
        callCount++;
        if (actionName === 'action.fail') return makeFailResult('action.fail', 'FIRST_FAIL');
        if (actionName === 'action.recovery') return makeOkResult('action.recovery', ['recovered']);
        return makeFailResult(actionName, 'UNKNOWN');
      };

      const replanner: PipelineReplanner = async () => [
        { name: 'recovery', type: 'action', actionName: 'action.recovery', args: {} },
      ];

      const plan: PipelinePlan = {
        steps: [{ name: 's1', type: 'action', actionName: 'action.fail', args: {} }],
      };

      const result = await executePipeline(plan, executor, replanner, makeCtx());

      expect(result.replanned).toBe(true);
      expect(result.replanCount).toBe(1);
      expect(result.steps.some((s) => s.stepName === 'recovery' && s.ok)).toBe(true);
    });

    it('respects max replan attempts', async () => {
      let replanCalls = 0;
      const executor: StepExecutor = async (actionName) => {
        return makeFailResult(actionName, 'ALWAYS_FAIL');
      };

      const replanner: PipelineReplanner = async () => {
        replanCalls++;
        return [{ name: `retry-${replanCalls}`, type: 'action', actionName: 'action.retry', args: {} }];
      };

      const plan: PipelinePlan = {
        steps: [{ name: 's1', type: 'action', actionName: 'action.fail', args: {} }],
      };

      const result = await executePipeline(plan, executor, replanner, makeCtx());

      // PIPELINE_MAX_REPLAN_ATTEMPTS defaults to 2
      expect(result.replanCount).toBeLessThanOrEqual(2);
      expect(result.ok).toBe(false);
    });
  });

  describe('executePipeline — step count limit', () => {
    it('stops at PIPELINE_MAX_STEPS', async () => {
      const results = new Map([
        ['action.a', makeOkResult('action.a', ['out'])],
      ]);

      // Create a plan with more steps than the limit
      const steps: PipelineStep[] = Array.from({ length: 50 }, (_, i) => ({
        name: `s${i + 1}`,
        type: 'action' as const,
        actionName: 'action.a',
        args: {},
      }));

      const plan: PipelinePlan = { steps };

      const result = await executePipeline(plan, makeExecutor(results), null, makeCtx());

      // PIPELINE_MAX_STEPS defaults to 20
      expect(result.steps.length).toBeLessThanOrEqual(20);
    });
  });
});

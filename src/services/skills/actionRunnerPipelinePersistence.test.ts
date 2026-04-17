import { beforeEach, describe, expect, it, vi } from 'vitest';

const workflowMocks = vi.hoisted(() => ({
  createWorkflowSession: vi.fn().mockResolvedValue(undefined),
  generateSessionId: vi.fn(() => 'session-1'),
  inferWorkflowRuntimeLane: vi.fn(() => 'lane-1'),
  insertWorkflowStep: vi.fn().mockResolvedValue(undefined),
  recordWorkflowArtifactRefs: vi.fn().mockResolvedValue(undefined),
  recordWorkflowCapabilityDemands: vi.fn().mockResolvedValue(undefined),
  recordWorkflowDecisionDistillate: vi.fn().mockResolvedValue(undefined),
  recordWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  recordWorkflowRecallRequest: vi.fn().mockResolvedValue(undefined),
  updateWorkflowSessionStatus: vi.fn().mockResolvedValue(undefined),
}));

const logMocks = vi.hoisted(() => ({
  logActionExecutionEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../workflow', () => workflowMocks);
vi.mock('./actionExecutionLogService', () => logMocks);

import {
  finalizeGoalPipelineSession,
  initializeGoalPipelineSession,
  persistPlannerEmptyPipelineCloseout,
  transitionGoalPipelineToExecuting,
} from './actionRunnerPipelinePersistence';

beforeEach(() => {
  for (const mock of Object.values(workflowMocks)) {
    mock.mockClear();
  }
  logMocks.logActionExecutionEvent.mockClear();
});

describe('initializeGoalPipelineSession', () => {
  it('creates the workflow session and start event', async () => {
    const result = await initializeGoalPipelineSession({
      goal: 'stabilize pipeline state',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      runtimeLane: 'operator-personal',
    });

    expect(result).toEqual({ sessionId: 'session-1', workflowRuntimeLane: 'lane-1' });
    expect(workflowMocks.createWorkflowSession).toHaveBeenCalledTimes(1);
    expect(workflowMocks.recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      eventType: 'session_start',
      toState: 'proposed',
    }));
  });
});

describe('transitionGoalPipelineToExecuting', () => {
  it('records the executing transition', async () => {
    await transitionGoalPipelineToExecuting({ sessionId: 'session-1', plannedActionCount: 3 });

    expect(workflowMocks.updateWorkflowSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
    expect(workflowMocks.recordWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      eventType: 'state_transition',
      toState: 'executing',
      decisionReason: 'Planned 3 actions',
    }));
  });
});

describe('pipeline closeout persistence', () => {
  it('records planner-empty recall artifacts', async () => {
    const closeoutArtifacts = {
      decisionDistillate: {
        summary: 'Planner could not produce any executable actions inside the current boundary.',
        nextAction: 'clarify the goal or expand the approved action surface before retrying',
        sourceEvent: 'recall_request' as const,
        promoteAs: 'requirement' as const,
        tags: ['goal-pipeline', 'planner-empty'],
        payload: { planner_action_count: 0 },
      },
      capabilityDemands: [{
        summary: 'Planner produced no executable actions inside the current boundary.',
        objective: 'goal',
        missingCapability: 'executable plan inside current boundary',
        failedOrInsufficientRoute: 'planActions',
        cheapestEnablementPath: 'clarify the goal or expand the approved action surface before retrying',
        proposedOwner: 'gpt' as const,
        recallCondition: 'Planner produced no executable actions; GPT recall required',
        tags: ['goal-pipeline', 'planner-empty'],
      }],
      capabilityDemandPayload: { planner_action_count: 0 },
    };

    await persistPlannerEmptyPipelineCloseout({
      sessionId: 'session-1',
      workflowRuntimeLane: 'lane-1',
      requestedBy: 'user-1',
      closeoutArtifacts,
    });

    expect(workflowMocks.updateWorkflowSessionStatus).toHaveBeenCalledWith('session-1', 'failed', true);
    expect(workflowMocks.recordWorkflowRecallRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      blockedAction: 'planActions',
      runtimeLane: 'lane-1',
    }));
  });

  it('records recall details when the pipeline fails after execution', async () => {
    const closeoutArtifacts = {
      decisionDistillate: {
        summary: 'Pipeline failed before release and now needs GPT boundary review.',
        nextAction: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
        sourceEvent: 'session_complete' as const,
        promoteAs: 'development_slice' as const,
        tags: ['goal-pipeline', 'failed'],
        payload: { final_status: 'failed' },
      },
      capabilityDemands: [{
        summary: 'Pipeline step failed before release and still needs enablement.',
        objective: 'goal',
        missingCapability: 'ACTION_TIMEOUT',
        failedOrInsufficientRoute: 'step-1',
        cheapestEnablementPath: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
        proposedOwner: 'gpt' as const,
        recallCondition: 'Pipeline failed; GPT recall required',
        tags: ['goal-pipeline', 'failed'],
      }],
      capabilityDemandPayload: { final_status: 'failed' },
    };

    const finalStatus = await finalizeGoalPipelineSession({
      sessionId: 'session-1',
      workflowRuntimeLane: 'lane-1',
      requestedBy: 'user-1',
      goal: 'repair pipeline',
      pipelineResult: {
        ok: false,
        sessionId: 'session-1',
        steps: [],
        finalOutput: '',
        totalDurationMs: 120,
        replanned: true,
        replanCount: 1,
      },
      failedSteps: [{
        stepName: 'step-1',
        stepType: 'action',
        ok: false,
        output: [],
        artifacts: [],
        durationMs: 100,
        agentRole: 'operate',
        error: 'ACTION_TIMEOUT',
      }],
      closeoutArtifacts,
    });

    expect(finalStatus).toBe('failed');
    expect(workflowMocks.recordWorkflowRecallRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      failedStepNames: ['step-1'],
      runtimeLane: 'lane-1',
    }));
  });
});
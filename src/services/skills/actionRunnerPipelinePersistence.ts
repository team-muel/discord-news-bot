import type { WorkflowArtifactRef } from '../workflow';
import {
  createWorkflowSession,
  generateSessionId,
  inferWorkflowRuntimeLane,
  insertWorkflowStep,
  recordWorkflowArtifactRefs,
  recordWorkflowCapabilityDemands,
  recordWorkflowDecisionDistillate,
  recordWorkflowEvent,
  recordWorkflowRecallRequest,
  updateWorkflowSessionStatus,
} from '../workflow';
import { logActionExecutionEvent } from './actionExecutionLogService';
import type { PipelineResult, PipelineStepResult } from './pipelineEngine';
import type { WorkflowCloseoutArtifacts } from './actionRunnerWorkflowCloseout';

export const initializeGoalPipelineSession = async (params: {
  goal: string;
  guildId: string;
  requestedBy: string;
  runtimeLane?: string;
}): Promise<{ sessionId: string; workflowRuntimeLane: string }> => {
  const sessionId = generateSessionId();
  const workflowRuntimeLane = inferWorkflowRuntimeLane({
    workflowName: 'goal-pipeline',
    scope: params.guildId,
    metadata: params.runtimeLane ? { runtime_lane: params.runtimeLane } : undefined,
  });

  await createWorkflowSession({
    sessionId,
    workflowName: 'goal-pipeline',
    stage: 'planning',
    scope: params.guildId,
    status: 'proposed',
    metadata: {
      runtime_lane: workflowRuntimeLane,
      requested_by: params.requestedBy,
    },
  });

  await recordWorkflowEvent({
    sessionId,
    eventType: 'session_start',
    toState: 'proposed',
    decisionReason: `Goal: ${params.goal.slice(0, 200)}`,
    payload: {
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      runtime_lane: workflowRuntimeLane,
    },
  });

  return { sessionId, workflowRuntimeLane };
};

export const transitionGoalPipelineToExecuting = async (params: {
  sessionId: string;
  plannedActionCount: number;
}): Promise<void> => {
  await updateWorkflowSessionStatus(params.sessionId, 'executing');
  await recordWorkflowEvent({
    sessionId: params.sessionId,
    eventType: 'state_transition',
    fromState: 'proposed',
    toState: 'executing',
    decisionReason: `Planned ${params.plannedActionCount} actions`,
  });
};

export const recordGoalPipelineReplan = async (params: {
  sessionId: string;
  replanGoal: string;
  newActionCount: number;
}): Promise<void> => {
  await recordWorkflowEvent({
    sessionId: params.sessionId,
    eventType: 'replan',
    decisionReason: params.replanGoal.slice(0, 500),
    payload: { newActionCount: params.newActionCount },
  });
};

export const persistPlannerEmptyPipelineCloseout = async (params: {
  sessionId: string;
  workflowRuntimeLane: string;
  requestedBy: string;
  closeoutArtifacts: WorkflowCloseoutArtifacts;
}): Promise<void> => {
  await updateWorkflowSessionStatus(params.sessionId, 'failed', true);
  await recordWorkflowRecallRequest({
    sessionId: params.sessionId,
    decisionReason: 'Planner produced no executable actions; GPT recall required',
    blockedAction: 'planActions',
    nextAction: params.closeoutArtifacts.decisionDistillate.nextAction,
    requestedBy: params.requestedBy,
    runtimeLane: params.workflowRuntimeLane,
    payload: params.closeoutArtifacts.capabilityDemandPayload,
  });
  await recordWorkflowDecisionDistillate({
    sessionId: params.sessionId,
    runtimeLane: params.workflowRuntimeLane,
    ...params.closeoutArtifacts.decisionDistillate,
  });
  await recordWorkflowCapabilityDemands({
    sessionId: params.sessionId,
    runtimeLane: params.workflowRuntimeLane,
    sourceEvent: params.closeoutArtifacts.decisionDistillate.sourceEvent,
    demands: params.closeoutArtifacts.capabilityDemands,
    payload: params.closeoutArtifacts.capabilityDemandPayload,
  });
};

export const persistGoalPipelineSteps = async (params: {
  sessionId: string;
  workflowRuntimeLane: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  steps: PipelineStepResult[];
  extractArtifactRefs: (artifacts: string[]) => WorkflowArtifactRef[];
}): Promise<void> => {
  for (let i = 0; i < params.steps.length; i += 1) {
    const step = params.steps[i];
    const artifactRefs = params.extractArtifactRefs(step.artifacts);

    await insertWorkflowStep({
      sessionId: params.sessionId,
      stepOrder: i + 1,
      stepName: step.stepName,
      agentRole: step.agentRole,
      status: step.ok ? 'passed' : 'failed',
      durationMs: step.durationMs,
      details: {
        type: step.stepType,
        error: step.error,
        outputCount: step.output.length,
        artifactCount: step.artifacts.length,
      },
    });

    await logActionExecutionEvent({
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      goal: params.goal,
      actionName: step.stepName,
      ok: step.ok,
      summary: step.ok ? 'Pipeline step passed' : `Pipeline step failed: ${step.error || 'unknown'}`,
      artifacts: step.artifacts,
      verification: [`pipeline_session=${params.sessionId}`, `step_type=${step.stepType}`],
      durationMs: step.durationMs,
      retryCount: 0,
      circuitOpen: false,
      error: step.error,
      estimatedCostUsd: 0,
      finopsMode: 'normal',
      agentRole: step.agentRole,
    });

    await recordWorkflowArtifactRefs({
      sessionId: params.sessionId,
      refs: artifactRefs,
      runtimeLane: params.workflowRuntimeLane,
      sourceStepName: step.stepName,
      sourceEvent: step.ok ? 'step_passed' : 'step_failed',
      payload: {
        step_type: step.stepType,
        agent_role: step.agentRole,
      },
    });
  }
};

export const finalizeGoalPipelineSession = async (params: {
  sessionId: string;
  workflowRuntimeLane: string;
  requestedBy: string;
  goal: string;
  pipelineResult: PipelineResult;
  failedSteps: PipelineStepResult[];
  closeoutArtifacts: WorkflowCloseoutArtifacts;
}): Promise<'released' | 'failed'> => {
  const finalStatus = params.pipelineResult.ok ? 'released' : 'failed';

  await updateWorkflowSessionStatus(params.sessionId, finalStatus, true);
  await recordWorkflowEvent({
    sessionId: params.sessionId,
    eventType: 'session_complete',
    fromState: 'executing',
    toState: finalStatus,
    decisionReason: params.pipelineResult.ok
      ? `Pipeline completed: ${params.pipelineResult.steps.length} steps`
      : `Pipeline failed: ${params.failedSteps.length} failed steps`,
    payload: {
      totalDurationMs: params.pipelineResult.totalDurationMs,
      replanned: params.pipelineResult.replanned,
      replanCount: params.pipelineResult.replanCount,
    },
  });

  await recordWorkflowDecisionDistillate({
    sessionId: params.sessionId,
    runtimeLane: params.workflowRuntimeLane,
    ...params.closeoutArtifacts.decisionDistillate,
  });
  await recordWorkflowCapabilityDemands({
    sessionId: params.sessionId,
    runtimeLane: params.workflowRuntimeLane,
    sourceEvent: params.closeoutArtifacts.decisionDistillate.sourceEvent,
    demands: params.closeoutArtifacts.capabilityDemands,
    payload: params.closeoutArtifacts.capabilityDemandPayload,
  });

  if (!params.pipelineResult.ok) {
    await recordWorkflowRecallRequest({
      sessionId: params.sessionId,
      decisionReason: params.pipelineResult.replanned
        ? 'Pipeline failed after replanning; GPT recall required'
        : 'Pipeline failed; GPT recall required',
      blockedAction: params.failedSteps[0]?.stepName,
      nextAction: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
      requestedBy: params.requestedBy,
      runtimeLane: params.workflowRuntimeLane,
      failedStepNames: params.failedSteps.map((step) => step.stepName),
      payload: {
        goal: params.goal.slice(0, 500),
        replanned: params.pipelineResult.replanned,
        replan_count: params.pipelineResult.replanCount,
        failed_steps: params.failedSteps.map((step) => ({
          step_name: step.stepName,
          error: step.error || null,
        })),
      },
    });
  }

  return finalStatus;
};
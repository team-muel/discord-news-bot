import type { WorkflowArtifactRef, WorkflowCapabilityDemandBatch, WorkflowDecisionDistillate } from '../workflow';
import type { PipelineStepResult } from './pipelineEngine';

export type WorkflowCloseoutArtifacts = {
  decisionDistillate: Omit<WorkflowDecisionDistillate, 'sessionId' | 'runtimeLane'>;
  capabilityDemands: WorkflowCapabilityDemandBatch['demands'];
  capabilityDemandPayload: Record<string, unknown>;
};

type WorkflowCloseoutParams = {
  goal: string;
  guildId: string;
  finalStatus: 'released' | 'failed';
  sourceEvent: 'recall_request' | 'session_complete';
  plannerActionCount?: number;
  stepCount?: number;
  failedSteps?: PipelineStepResult[];
  replanned?: boolean;
  replanCount?: number;
};

type ExtractEvidenceRefs = (artifacts: string[]) => WorkflowArtifactRef[];

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const buildCapabilityDemandEvidence = (
  steps: Pick<PipelineStepResult, 'artifacts'>[],
  extractEvidenceRefs: ExtractEvidenceRefs,
): { evidenceRefs: string[]; evidenceRefDetails: WorkflowArtifactRef[] } => {
  const seen = new Set<string>();
  const evidenceRefs: string[] = [];
  const evidenceRefDetails: WorkflowArtifactRef[] = [];

  for (const step of steps) {
    for (const ref of extractEvidenceRefs(step.artifacts || [])) {
      const locator = compact(ref?.locator);
      if (!locator || seen.has(locator)) {
        continue;
      }
      seen.add(locator);
      evidenceRefs.push(locator);
      evidenceRefDetails.push({
        locator,
        refKind: ref.refKind,
        title: ref.title,
        artifactPlane: ref.artifactPlane,
        githubSettlementKind: ref.githubSettlementKind,
      });
      if (evidenceRefs.length >= 4) {
        return { evidenceRefs, evidenceRefDetails };
      }
    }
  }

  return { evidenceRefs, evidenceRefDetails };
};

const inferCloseoutCapabilityDemandOwner = (step: Pick<PipelineStepResult, 'error'> | null): 'operator' | 'gpt' => {
  const error = compact(step?.error).toUpperCase();
  if (error === 'ACTION_NOT_ALLOWED' || error === 'CIRCUIT_OPEN') {
    return 'operator';
  }
  return 'gpt';
};

export const buildWorkflowCloseoutArtifacts = (
  params: WorkflowCloseoutParams,
  extractEvidenceRefs: ExtractEvidenceRefs = () => [],
): WorkflowCloseoutArtifacts => {
  const normalizedGoal = compact(params.goal).slice(0, 500);
  const failedSteps = Array.isArray(params.failedSteps) ? params.failedSteps.filter((step) => !step.ok) : [];
  const isPlannerEmpty = Number(params.plannerActionCount ?? -1) === 0;

  if (isPlannerEmpty) {
    return {
      decisionDistillate: {
        summary: 'Planner could not produce any executable actions inside the current boundary.',
        nextAction: 'clarify the goal or expand the approved action surface before retrying',
        sourceEvent: params.sourceEvent,
        promoteAs: 'requirement',
        tags: ['goal-pipeline', 'planner-empty'],
        payload: {
          goal: normalizedGoal,
          guild_id: params.guildId,
          planner_action_count: 0,
        },
      },
      capabilityDemands: [{
        summary: 'Planner produced no executable actions inside the current boundary.',
        objective: normalizedGoal,
        missingCapability: 'executable plan inside current boundary',
        missingSource: 'planner',
        failedOrInsufficientRoute: 'planActions',
        cheapestEnablementPath: 'clarify the goal or expand the approved action surface before retrying',
        proposedOwner: 'gpt',
        recallCondition: 'Planner produced no executable actions; GPT recall required',
        tags: ['goal-pipeline', 'planner-empty'],
      }],
      capabilityDemandPayload: {
        goal: normalizedGoal,
        guild_id: params.guildId,
        planner_action_count: 0,
      },
    };
  }

  const nextAction = params.finalStatus === 'released'
    ? 'promote durable operator-visible outcomes into Obsidian if the result should persist'
    : 'inspect the failed steps and revise the objective, policy boundary, or execution plan';
  const recallCondition = params.replanned
    ? 'Pipeline failed after replanning; GPT recall required'
    : 'Pipeline failed; GPT recall required';
  const failureTags = params.replanned ? ['goal-pipeline', 'failed', 'replanned'] : ['goal-pipeline', 'failed'];
  const capabilityDemands = params.finalStatus === 'released'
    ? []
    : failedSteps.length > 0
      ? failedSteps.slice(0, 3).map((step) => ({
        ...buildCapabilityDemandEvidence([step], extractEvidenceRefs),
        summary: compact(step.error) === 'ACTION_NOT_ALLOWED'
          ? `Pipeline step ${step.stepName} was blocked by policy and needs a narrower route or approval.`
          : compact(step.error) === 'ACTION_NOT_IMPLEMENTED'
            ? `Pipeline step ${step.stepName} has no executable implementation on the current action surface.`
            : `Pipeline step ${step.stepName} failed before release and still needs enablement.`,
        objective: normalizedGoal,
        missingCapability: compact(step.error) || step.stepName,
        missingSource: compact(step.error) === 'ACTION_NOT_IMPLEMENTED' ? 'action-surface' : undefined,
        failedOrInsufficientRoute: step.stepName,
        cheapestEnablementPath: nextAction,
        proposedOwner: inferCloseoutCapabilityDemandOwner(step),
        recallCondition,
        tags: failureTags,
      }))
      : [{
        summary: 'Pipeline failed before release and still needs a narrower or better enabled route.',
        objective: normalizedGoal,
        missingCapability: 'bounded route stability',
        failedOrInsufficientRoute: 'goal-pipeline',
        cheapestEnablementPath: nextAction,
        proposedOwner: 'gpt',
        recallCondition,
        tags: failureTags,
      }];

  return {
    decisionDistillate: {
      summary: params.finalStatus === 'released'
        ? `Pipeline released after ${params.stepCount ?? 0} bounded steps.`
        : params.replanned
          ? 'Pipeline failed after replanning and now needs GPT boundary review.'
          : 'Pipeline failed before release and now needs GPT boundary review.',
      nextAction,
      sourceEvent: params.sourceEvent,
      promoteAs: 'development_slice',
      tags: params.finalStatus === 'released' ? ['goal-pipeline', 'released'] : ['goal-pipeline', 'failed'],
      payload: {
        goal: normalizedGoal,
        guild_id: params.guildId,
        final_status: params.finalStatus,
        replanned: Boolean(params.replanned),
        replan_count: params.replanCount ?? 0,
        step_count: params.stepCount ?? 0,
        failed_step_names: failedSteps.map((step) => step.stepName),
      },
    },
    capabilityDemands,
    capabilityDemandPayload: {
      goal: normalizedGoal,
      guild_id: params.guildId,
      final_status: params.finalStatus,
      replanned: Boolean(params.replanned),
      replan_count: params.replanCount ?? 0,
      step_count: params.stepCount ?? 0,
      failed_step_names: failedSteps.map((step) => step.stepName),
    },
  };
};
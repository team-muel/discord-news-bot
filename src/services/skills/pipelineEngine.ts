/**
 * Execution Pipeline Engine — judgment loop with chaining, branching, and replanning.
 *
 * This is the "brain" layer that wraps the existing actionRunner's per-action
 * execution with inter-action data flow, conditional branching, mid-execution
 * replanning, and parallel fan-out.
 *
 * Design principles:
 * - Backward compatible: existing `runGoalActions` still works as before
 * - Opt-in: `runPipeline` is the new entry point for pipeline-aware execution
 * - Composable: each step produces typed output that feeds into the next
 * - Observable: every step transition is recorded via workflowPersistenceService
 */
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { inferAgentRoleByActionName, type ActionExecutionResult, type ActionPlan, type AgentRoleName } from './actions/types';
import logger from '../../logger';

// ─── Configuration ────────────────────────────────────────────────────────────

const PIPELINE_MAX_STEPS = Math.max(3, parseIntegerEnv(process.env.PIPELINE_MAX_STEPS, 20));
const PIPELINE_MAX_REPLAN_ATTEMPTS = Math.max(0, parseIntegerEnv(process.env.PIPELINE_MAX_REPLAN_ATTEMPTS, 2));
const PIPELINE_PARALLEL_ENABLED = parseBooleanEnv(process.env.PIPELINE_PARALLEL_ENABLED, true);
const PIPELINE_DATA_FLOW_ENABLED = parseBooleanEnv(process.env.PIPELINE_DATA_FLOW_ENABLED, true);

// ─── Pipeline Types ───────────────────────────────────────────────────────────

export type PipelineStepType = 'action' | 'branch' | 'parallel' | 'replan';

export type PipelineStepResult = {
  stepName: string;
  stepType: PipelineStepType;
  ok: boolean;
  output: string[];
  artifacts: string[];
  durationMs: number;
  agentRole: AgentRoleName;
  error?: string;
};

export type PipelineContext = {
  /** Accumulated data from previous steps — keyed by step name */
  stepOutputs: Map<string, PipelineStepResult>;
  /** Latest output array for piping into next step */
  lastOutput: string[];
  /** Current pipeline execution goal */
  goal: string;
  guildId: string;
  requestedBy: string;
  /** Total steps executed so far */
  stepCount: number;
  /** Replan attempts used so far */
  replanCount: number;
};

/** A pipeline step definition — produced by the planner or branching logic */
export type PipelineStep = {
  name: string;
  type: PipelineStepType;
  actionName?: string;
  args?: Record<string, unknown>;
  reason?: string;
  /** For 'branch' type: condition function evaluated against pipeline context */
  condition?: (ctx: PipelineContext) => boolean;
  /** For 'branch' type: steps to execute if condition is true */
  thenSteps?: PipelineStep[];
  /** For 'branch' type: steps to execute if condition is false */
  elseSteps?: PipelineStep[];
  /** For 'parallel' type: steps to execute concurrently */
  parallelSteps?: PipelineStep[];
  /** For 'replan' type: replanning goal override */
  replanGoal?: string;
  /** Whether this step's output should be piped as input to the next */
  pipeOutput?: boolean;
  /** Dependency: names of steps whose output this step needs */
  dependsOn?: string[];
};

export type PipelinePlan = {
  steps: PipelineStep[];
  metadata?: Record<string, unknown>;
};

export type PipelineResult = {
  ok: boolean;
  sessionId: string;
  steps: PipelineStepResult[];
  finalOutput: string;
  totalDurationMs: number;
  replanned: boolean;
  replanCount: number;
};

// ─── Pipeline Execution Engine ────────────────────────────────────────────────

export type StepExecutor = (
  actionName: string,
  args: Record<string, unknown>,
  ctx: PipelineContext,
) => Promise<ActionExecutionResult>;

export type PipelineReplanner = (
  goal: string,
  ctx: PipelineContext,
) => Promise<PipelineStep[]>;

/**
 * Execute a pipeline plan with chaining, branching, and replanning support.
 *
 * @param plan - The pipeline plan (steps to execute)
 * @param executor - Function that executes a single action (wraps existing actionRunner logic)
 * @param replanner - Function that re-invokes the planner for mid-execution replanning
 * @param ctx - Initial pipeline context
 */
export const executePipeline = async (
  plan: PipelinePlan,
  executor: StepExecutor,
  replanner: PipelineReplanner | null,
  ctx: PipelineContext,
): Promise<PipelineResult> => {
  const startTime = Date.now();
  const results: PipelineStepResult[] = [];
  let overallOk = true;
  let replanned = false;

  const executeSteps = async (steps: PipelineStep[]): Promise<void> => {
    for (const step of steps) {
      if (ctx.stepCount >= PIPELINE_MAX_STEPS) {
        logger.warn('[PIPELINE] max steps (%d) reached, stopping', PIPELINE_MAX_STEPS);
        break;
      }

      const stepStart = Date.now();

      switch (step.type) {
        case 'action': {
          if (!step.actionName) {
            results.push({
              stepName: step.name,
              stepType: 'action',
              ok: false,
              output: [],
              artifacts: [],
              durationMs: 0,
              agentRole: 'operate',
              error: 'MISSING_ACTION_NAME',
            });
            overallOk = false;
            continue;
          }

          // Merge piped data from dependencies if data flow is enabled
          const mergedArgs = { ...(step.args || {}) };
          if (PIPELINE_DATA_FLOW_ENABLED && step.dependsOn) {
            for (const dep of step.dependsOn) {
              const depResult = ctx.stepOutputs.get(dep);
              if (depResult) {
                mergedArgs[`__pipe_${dep}`] = depResult.output;
                mergedArgs[`__artifacts_${dep}`] = depResult.artifacts;
              }
            }
          }
          // Always inject last output as __pipe_prev if data flow is enabled
          if (PIPELINE_DATA_FLOW_ENABLED && ctx.lastOutput.length > 0) {
            mergedArgs.__pipe_prev = ctx.lastOutput;
          }

          const result = await executor(step.actionName, mergedArgs, ctx);
          const stepResult: PipelineStepResult = {
            stepName: step.name,
            stepType: 'action',
            ok: result.ok,
            output: result.artifacts || [],
            artifacts: result.artifacts || [],
            durationMs: Date.now() - stepStart,
            agentRole: result.agentRole || inferAgentRoleByActionName(step.actionName),
            error: result.error,
          };

          results.push(stepResult);
          ctx.stepOutputs.set(step.name, stepResult);
          ctx.stepCount += 1;

          if (step.pipeOutput !== false) {
            ctx.lastOutput = stepResult.output;
          }

          if (!result.ok) {
            overallOk = false;
            // Attempt replanning on failure if replanner is available
            if (replanner && ctx.replanCount < PIPELINE_MAX_REPLAN_ATTEMPTS) {
              ctx.replanCount += 1;
              replanned = true;
              logger.info(
                '[PIPELINE] step "%s" failed, attempting replan (%d/%d)',
                step.name, ctx.replanCount, PIPELINE_MAX_REPLAN_ATTEMPTS,
              );
              const replanSteps = await replanner(
                `Previous step "${step.name}" (${step.actionName}) failed with: ${result.error || 'unknown'}. Original goal: ${ctx.goal}. Replan remaining steps.`,
                ctx,
              );
              if (replanSteps.length > 0) {
                await executeSteps(replanSteps);
              }
              return; // Stop current step sequence after replan
            }
          }
          break;
        }

        case 'branch': {
          const conditionMet = step.condition ? step.condition(ctx) : false;
          const branchResult: PipelineStepResult = {
            stepName: step.name,
            stepType: 'branch',
            ok: true,
            output: [`branch_taken=${conditionMet ? 'then' : 'else'}`],
            artifacts: [],
            durationMs: 0,
            agentRole: 'architect',
          };
          results.push(branchResult);
          ctx.stepOutputs.set(step.name, branchResult);
          ctx.stepCount += 1;

          if (conditionMet && step.thenSteps) {
            await executeSteps(step.thenSteps);
          } else if (!conditionMet && step.elseSteps) {
            await executeSteps(step.elseSteps);
          }
          break;
        }

        case 'parallel': {
          if (!PIPELINE_PARALLEL_ENABLED || !step.parallelSteps || step.parallelSteps.length === 0) {
            // Fall back to sequential if parallel is disabled
            if (step.parallelSteps) {
              await executeSteps(step.parallelSteps);
            }
            break;
          }

          const parallelResults = await Promise.allSettled(
            step.parallelSteps.map(async (pStep) => {
              if (pStep.type !== 'action' || !pStep.actionName) return null;
              const pArgs = { ...(pStep.args || {}) };
              if (PIPELINE_DATA_FLOW_ENABLED && ctx.lastOutput.length > 0) {
                pArgs.__pipe_prev = ctx.lastOutput;
              }
              return executor(pStep.actionName, pArgs, ctx);
            }),
          );

          const parallelOutputs: string[] = [];
          for (let i = 0; i < parallelResults.length; i++) {
            const settled = parallelResults[i];
            const pStep = step.parallelSteps[i];
            const pStart = stepStart;

            if (settled.status === 'fulfilled' && settled.value) {
              const r = settled.value;
              const sr: PipelineStepResult = {
                stepName: pStep.name,
                stepType: 'action',
                ok: r.ok,
                output: r.artifacts || [],
                artifacts: r.artifacts || [],
                durationMs: Date.now() - pStart,
                agentRole: r.agentRole || inferAgentRoleByActionName(pStep.actionName || ''),
                error: r.error,
              };
              results.push(sr);
              ctx.stepOutputs.set(pStep.name, sr);
              ctx.stepCount += 1;
              if (r.ok) parallelOutputs.push(...(r.artifacts || []));
              if (!r.ok) overallOk = false;
            } else {
              const errorMsg = settled.status === 'rejected'
                ? (settled.reason instanceof Error ? settled.reason.message : String(settled.reason))
                : 'null_result';
              results.push({
                stepName: pStep.name,
                stepType: 'action',
                ok: false,
                output: [],
                artifacts: [],
                durationMs: Date.now() - pStart,
                agentRole: inferAgentRoleByActionName(pStep.actionName || ''),
                error: errorMsg,
              });
              ctx.stepCount += 1;
              overallOk = false;
            }
          }
          ctx.lastOutput = parallelOutputs;
          break;
        }

        case 'replan': {
          if (!replanner || ctx.replanCount >= PIPELINE_MAX_REPLAN_ATTEMPTS) {
            results.push({
              stepName: step.name,
              stepType: 'replan',
              ok: false,
              output: ['replan_skipped=max_attempts_reached'],
              artifacts: [],
              durationMs: 0,
              agentRole: 'architect',
              error: 'MAX_REPLAN_ATTEMPTS',
            });
            ctx.stepCount += 1;
            break;
          }

          ctx.replanCount += 1;
          replanned = true;
          const replanGoal = step.replanGoal || ctx.goal;
          const newSteps = await replanner(replanGoal, ctx);
          results.push({
            stepName: step.name,
            stepType: 'replan',
            ok: true,
            output: [`replanned_steps=${newSteps.length}`],
            artifacts: [],
            durationMs: Date.now() - stepStart,
            agentRole: 'architect',
          });
          ctx.stepOutputs.set(step.name, results[results.length - 1]);
          ctx.stepCount += 1;

          if (newSteps.length > 0) {
            await executeSteps(newSteps);
          }
          break;
        }
      }
    }
  };

  await executeSteps(plan.steps);

  const finalOutput = results
    .filter((r) => r.ok)
    .flatMap((r) => r.output)
    .filter(Boolean)
    .join('\n');

  return {
    ok: overallOk,
    sessionId: ctx.goal, // caller should set proper sessionId
    steps: results,
    finalOutput,
    totalDurationMs: Date.now() - startTime,
    replanned,
    replanCount: ctx.replanCount,
  };
};

// ─── Plan Conversion Helpers ──────────────────────────────────────────────────

/**
 * Convert a flat ActionPlan[] (from existing planner) to a PipelinePlan
 * with sequential data flow. This bridges the old planner output format
 * to the new pipeline execution engine.
 */
export const actionChainToPipelinePlan = (actions: ActionPlan[]): PipelinePlan => {
  const steps: PipelineStep[] = actions.map((action, index) => ({
    name: `step-${index + 1}-${action.actionName}`,
    type: 'action' as const,
    actionName: action.actionName,
    args: action.args,
    reason: action.reason,
    pipeOutput: true,
    dependsOn: index > 0 ? [`step-${index}-${actions[index - 1].actionName}`] : undefined,
  }));

  return { steps };
};

/**
 * Create a pipeline context for a new execution.
 */
export const createPipelineContext = (params: {
  goal: string;
  guildId: string;
  requestedBy: string;
}): PipelineContext => ({
  stepOutputs: new Map(),
  lastOutput: [],
  goal: params.goal,
  guildId: params.guildId,
  requestedBy: params.requestedBy,
  stepCount: 0,
  replanCount: 0,
});

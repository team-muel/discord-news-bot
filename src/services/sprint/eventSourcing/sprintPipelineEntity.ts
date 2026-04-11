/**
 * Sprint Pipeline — Ventyd Event Sourcing PoC
 *
 * Models the SprintPipeline lifecycle as an event-sourced entity.
 * Every state transition (phase start, complete, loop-back, block, cancel)
 * is captured as an immutable event, enabling full audit trail and time-travel.
 */
import { defineSchema, defineReducer, Entity, mutation, createRepository, type Adapter } from 'ventyd';
import { valibot, v } from 'ventyd/valibot';
import { buildPhaseResultKey } from '../phaseResultKey';

// ──── Domain value types (matching sprintOrchestrator.ts) ─────────────────────

const SprintPhaseEnum = v.picklist([
  'plan', 'implement', 'review', 'qa',
  'security-audit', 'ops-validate', 'ship', 'retro',
  'complete', 'blocked', 'cancelled',
] as const);

const TriggerTypeEnum = v.picklist([
  'error-detection', 'cs-ticket', 'feature-request',
  'scheduled', 'manual', 'self-improvement', 'observation',
] as const);

const AutonomyLevelEnum = v.picklist([
  'full-auto', 'approve-ship', 'approve-impl', 'manual',
] as const);

const PhaseStatusEnum = v.picklist([
  'success', 'failed', 'blocked', 'skipped', 'awaiting-approval', 'approved',
] as const);

// ──── Schema ──────────────────────────────────────────────────────────────────

export const sprintPipelineSchema = defineSchema('sprint_pipeline', {
  schema: valibot({
    event: {
      // Pipeline created
      created: v.object({
        triggerId: v.string(),
        triggerType: TriggerTypeEnum,
        guildId: v.string(),
        objective: v.string(),
        autonomyLevel: AutonomyLevelEnum,
        phaseOrder: v.array(SprintPhaseEnum),
        maxImplReviewLoops: v.number(),
      }),

      // A phase completed execution
      phase_completed: v.object({
        phase: SprintPhaseEnum,
        status: PhaseStatusEnum,
        output: v.string(),
        artifacts: v.array(v.string()),
        startedAt: v.string(),
        completedAt: v.string(),
        iterationCount: v.number(),
      }),

      // Review/QA sent pipeline back to implement
      looped_back: v.object({
        fromPhase: SprintPhaseEnum,
        toPhase: SprintPhaseEnum,
        loopCount: v.number(),
      }),

      // Phase advanced (next phase determined by transition logic)
      phase_advanced: v.object({
        nextPhase: SprintPhaseEnum,
      }),

      // Changed files recorded
      files_changed: v.object({
        files: v.array(v.string()),
      }),

      // Pipeline blocked
      blocked: v.object({
        reason: v.string(),
      }),

      // Pipeline cancelled
      cancelled: v.object({}),

      // Pipeline completed successfully
      completed: v.object({}),
    },
    state: v.object({
      triggerId: v.string(),
      triggerType: TriggerTypeEnum,
      guildId: v.string(),
      objective: v.string(),
      autonomyLevel: AutonomyLevelEnum,
      currentPhase: SprintPhaseEnum,
      phaseOrder: v.array(SprintPhaseEnum),
      phaseResults: v.record(v.string(), v.object({
        phase: SprintPhaseEnum,
        status: PhaseStatusEnum,
        output: v.string(),
        artifacts: v.array(v.string()),
        startedAt: v.string(),
        completedAt: v.string(),
        iterationCount: v.number(),
      })),
      implementReviewLoopCount: v.number(),
      maxImplReviewLoops: v.number(),
      totalPhasesExecuted: v.number(),
      changedFiles: v.array(v.string()),
      error: v.nullable(v.string()),
    }),
  }),
  initialEventName: 'sprint_pipeline:created',
});

// ──── Reducer ─────────────────────────────────────────────────────────────────
//
// Type-cast note: ventyd v1.19 + valibot StandardSchemaV1 integration widens
// event body string-literal types (e.g. picklist values) to `string` at the
// TypeScript level, even though `as const` arrays are used for the schema.
// The `as typeof prevState.X` casts below are safe — they only re-assert the
// literal union that the schema already guarantees at runtime.

export const sprintPipelineReducer = defineReducer(sprintPipelineSchema, (prevState, event) => {
  switch (event.eventName) {
    case 'sprint_pipeline:created':
      return {
        triggerId: event.body.triggerId,
        triggerType: event.body.triggerType as typeof prevState.triggerType,
        guildId: event.body.guildId,
        objective: event.body.objective,
        autonomyLevel: event.body.autonomyLevel as typeof prevState.autonomyLevel,
        currentPhase: (event.body.phaseOrder[0] ?? 'plan') as typeof prevState.currentPhase,
        phaseOrder: [...event.body.phaseOrder] as typeof prevState.phaseOrder,
        phaseResults: {} as typeof prevState.phaseResults,
        implementReviewLoopCount: 0,
        maxImplReviewLoops: event.body.maxImplReviewLoops,
        totalPhasesExecuted: 0,
        changedFiles: [] as string[],
        error: null,
      };

    case 'sprint_pipeline:phase_completed': {
      const resultKey = buildPhaseResultKey(event.body.phase, prevState.totalPhasesExecuted);
      return {
        ...prevState,
        phaseResults: {
          ...prevState.phaseResults,
          [resultKey]: {
            phase: event.body.phase as typeof prevState.currentPhase,
            status: event.body.status as typeof prevState.phaseResults[string]['status'],
            output: event.body.output,
            artifacts: event.body.artifacts,
            startedAt: event.body.startedAt,
            completedAt: event.body.completedAt,
            iterationCount: event.body.iterationCount,
          },
        },
        totalPhasesExecuted: prevState.totalPhasesExecuted + 1,
      };
    }

    case 'sprint_pipeline:looped_back':
      return {
        ...prevState,
        currentPhase: event.body.toPhase as typeof prevState.currentPhase,
        implementReviewLoopCount: event.body.loopCount,
      };

    case 'sprint_pipeline:phase_advanced':
      return {
        ...prevState,
        currentPhase: event.body.nextPhase as typeof prevState.currentPhase,
      };

    case 'sprint_pipeline:files_changed':
      return {
        ...prevState,
        changedFiles: [...new Set([...prevState.changedFiles, ...event.body.files])],
      };

    case 'sprint_pipeline:blocked':
      return {
        ...prevState,
        currentPhase: 'blocked' as typeof prevState.currentPhase,
        error: event.body.reason,
      };

    case 'sprint_pipeline:cancelled':
      return {
        ...prevState,
        currentPhase: 'cancelled' as typeof prevState.currentPhase,
      };

    case 'sprint_pipeline:completed':
      return {
        ...prevState,
        currentPhase: 'complete' as typeof prevState.currentPhase,
      };

    default:
      return prevState;
  }
});

// ──── Phase transition logic (ported from sprintOrchestrator.ts) ──────────────

type PhaseStatus = 'success' | 'failed' | 'blocked' | 'skipped' | 'awaiting-approval' | 'approved';
type Phase =
  | 'plan' | 'implement' | 'review' | 'qa'
  | 'security-audit' | 'ops-validate' | 'ship' | 'retro'
  | 'complete' | 'blocked' | 'cancelled';

function resolveNextPhase(
  phase: Phase,
  status: PhaseStatus,
  output: string,
  loopCount: number,
  maxLoops: number,
): Phase {
  switch (phase) {
    case 'plan':
      return status === 'success' ? 'implement' : 'blocked';
    case 'implement':
      return status === 'success' ? 'review' : 'blocked';
    case 'review':
      if (status === 'success') {
        if (/\bSECURITY[_\s]?(ISSUE|CONCERN|VULN|RISK|FINDING)/i.test(output) ||
            /\bsecurity concern\b/i.test(output)) {
          return 'security-audit';
        }
        return 'qa';
      }
      return loopCount < maxLoops ? 'implement' : 'blocked';
    case 'qa':
      if (status === 'success') return 'ops-validate';
      return loopCount < maxLoops ? 'implement' : 'blocked';
    case 'security-audit':
      if (status === 'success') return 'qa';
      return loopCount < maxLoops ? 'implement' : 'blocked';
    case 'ops-validate':
      if (status === 'success') return 'ship';
      return loopCount < maxLoops ? 'implement' : 'blocked';
    case 'ship':
      return status === 'success' ? 'retro' : 'blocked';
    case 'retro':
      return 'complete';
    default:
      return 'blocked';
  }
}

// ──── Entity ──────────────────────────────────────────────────────────────────

export class SprintPipelineEntity extends Entity(sprintPipelineSchema, sprintPipelineReducer) {
  // ── Getters ──

  get currentPhase() { return this.state.currentPhase; }
  get guildId() { return this.state.guildId; }
  get objective() { return this.state.objective; }
  get isTerminal() {
    return ['complete', 'blocked', 'cancelled'].includes(this.state.currentPhase);
  }
  get canLoopBack() {
    return this.state.implementReviewLoopCount < this.state.maxImplReviewLoops;
  }

  // ── Mutations ──

  /** Record a phase completion and determine the next phase. */
  completePhase = mutation(this, (dispatch, params: {
    phase: Phase;
    status: PhaseStatus;
    output: string;
    artifacts: string[];
    startedAt: string;
    completedAt: string;
    iterationCount: number;
  }) => {
    if (this.isTerminal) {
      throw new Error(`Cannot complete phase on terminal pipeline (current: ${this.state.currentPhase})`);
    }

    dispatch('sprint_pipeline:phase_completed', params);

    const nextPhase = resolveNextPhase(
      params.phase,
      params.status,
      params.output,
      this.state.implementReviewLoopCount,
      this.state.maxImplReviewLoops,
    );

    // Loop-back detection
    if (nextPhase === 'implement' && params.phase !== 'plan') {
      const newLoopCount = this.state.implementReviewLoopCount + 1;
      dispatch('sprint_pipeline:looped_back', {
        fromPhase: params.phase,
        toPhase: 'implement',
        loopCount: newLoopCount,
      });
    } else if (nextPhase === 'complete') {
      dispatch('sprint_pipeline:completed', {});
    } else if (nextPhase === 'blocked') {
      dispatch('sprint_pipeline:blocked', {
        reason: `Phase ${params.phase} ${params.status} — max loops reached or unrecoverable`,
      });
    } else {
      dispatch('sprint_pipeline:phase_advanced', { nextPhase });
    }
  });

  /** Record changed files. */
  recordChangedFiles = mutation(this, (dispatch, files: string[]) => {
    if (files.length === 0) return;
    dispatch('sprint_pipeline:files_changed', { files });
  });

  /** Cancel the pipeline. */
  cancel = mutation(this, (dispatch) => {
    if (this.isTerminal) {
      throw new Error(`Cannot cancel terminal pipeline (current: ${this.state.currentPhase})`);
    }
    dispatch('sprint_pipeline:cancelled', {});
  });

  /** Block the pipeline with a reason. */
  block = mutation(this, (dispatch, reason: string) => {
    if (this.isTerminal) {
      throw new Error(`Cannot block terminal pipeline (current: ${this.state.currentPhase})`);
    }
    dispatch('sprint_pipeline:blocked', { reason });
  });
}

// ──── Repository factory ──────────────────────────────────────────────────────

export function createSprintPipelineRepository(adapter: Adapter) {
  return createRepository(SprintPipelineEntity, { adapter });
}

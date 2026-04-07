/**
 * Ventyd Plugins for Sprint Pipeline side effects.
 *
 * Replaces scattered hook/metric/journal calls in sprintOrchestrator
 * with composable, isolated plugin handlers that run after event commit.
 */
import type { Plugin, InferEventFromSchema, InferStateFromSchema } from 'ventyd';
import logger from '../../../logger';
import { sprintPipelineSchema } from './sprintPipelineEntity';
import { logCatchError } from '../../../utils/errorMessage';
import { getErrorMessage } from '../../../utils/errorMessage';

export type SprintPlugin = Plugin<typeof sprintPipelineSchema>;
type SprintEvent = InferEventFromSchema<typeof sprintPipelineSchema>;
type SprintState = InferStateFromSchema<typeof sprintPipelineSchema>;

// ──── Metrics Plugin ──────────────────────────────────────────────────────────

/**
 * Records sprint metrics (phase durations, loop-backs) after events are committed.
 * Replaces manual recordPhaseMetric/recordLoopBack calls in the orchestrator.
 */
export function createMetricsPlugin(opts: {
  recordPhaseMetric: (phase: string, durationMs: number, failed: boolean, deterministic?: boolean) => void;
  recordLoopBack: () => void;
  recordPipelineCreated: () => void;
}): SprintPlugin {
  return {
    async onCommitted({ events }) {
      for (const event of events) {
        switch (event.eventName) {
          case 'sprint_pipeline:created':
            opts.recordPipelineCreated();
            break;

          case 'sprint_pipeline:phase_completed': {
            const start = new Date(event.body.startedAt).getTime();
            const end = new Date(event.body.completedAt).getTime();
            const durationMs = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
            const failed = event.body.status === 'failed';
            opts.recordPhaseMetric(event.body.phase, durationMs, failed);
            break;
          }

          case 'sprint_pipeline:looped_back':
            opts.recordLoopBack();
            break;
        }
      }
    },
  };
}

// ──── Lifecycle Hooks Plugin ──────────────────────────────────────────────────

/**
 * Fires sprint lifecycle hooks (SprintStart, SprintComplete, PhaseComplete)
 * after events commit. Replaces executeHooks() calls scattered in orchestrator.
 */
export function createLifecycleHooksPlugin(opts: {
  executeHooks: (payload: {
    hookPoint: string;
    sprintId: string;
    phase?: string;
    meta?: Record<string, unknown>;
  }) => Promise<unknown>;
}): SprintPlugin {
  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        switch (event.eventName) {
          case 'sprint_pipeline:created':
            await opts.executeHooks({
              hookPoint: 'SprintStart',
              sprintId: entityId,
              meta: {
                triggerType: event.body.triggerType,
                objective: event.body.objective,
                guildId: event.body.guildId,
              },
            }).catch(() => {});
            break;

          case 'sprint_pipeline:phase_completed':
            await opts.executeHooks({
              hookPoint: 'PhaseComplete',
              sprintId: entityId,
              phase: event.body.phase,
              meta: {
                status: event.body.status,
              },
            }).catch(() => {});
            break;

          case 'sprint_pipeline:completed':
            await opts.executeHooks({
              hookPoint: 'SprintComplete',
              sprintId: entityId,
              meta: {
                objective: state.objective,
                changedFiles: state.changedFiles,
                totalPhasesExecuted: state.totalPhasesExecuted,
              },
            }).catch(() => {});
            break;
        }
      }
    },
  };
}

// ──── Audit Log Plugin ────────────────────────────────────────────────────────

/**
 * Logs all sprint events for observability. Replaces logger.info() calls.
 */
export const auditLogPlugin: SprintPlugin = {
  async onCommitted({ entityId, events }) {
    for (const event of events) {
      logger.info('[VENTYD] entity=%s event=%s body=%j', entityId, event.eventName, event.body);
    }
  },
};

// ──── Signal Bus Plugin ───────────────────────────────────────────────────────

/**
 * Emits signal bus events for cross-system integration
 * (workflow.phase.looping, workflow.sprint.completed, workflow.sprint.failed).
 */
export function createSignalBusPlugin(): SprintPlugin {
  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        try {
          const { emitSignal } = await import('../../runtime/signalBus');

          switch (event.eventName) {
            case 'sprint_pipeline:looped_back':
              if (event.body.loopCount >= 2) {
                emitSignal('workflow.phase.looping', 'sprintOrchestrator', state.guildId, {
                  sprintId: entityId,
                  loopCount: event.body.loopCount,
                  fromPhase: event.body.fromPhase,
                  toPhase: event.body.toPhase,
                });
              }
              break;

            case 'sprint_pipeline:completed':
              emitSignal('workflow.sprint.completed', 'sprintOrchestrator', state.guildId, {
                sprintId: entityId,
                triggerType: state.triggerType,
                phasesExecuted: state.totalPhasesExecuted,
                changedFiles: state.changedFiles,
              });
              break;

            case 'sprint_pipeline:blocked':
              emitSignal('workflow.sprint.failed', 'sprintOrchestrator', state.guildId, {
                sprintId: entityId,
                triggerType: state.triggerType,
                phasesExecuted: state.totalPhasesExecuted,
                changedFiles: state.changedFiles,
              });
              break;
          }
        } catch (err) {
          logger.debug('[VENTYD] signal-emit failed: %s', getErrorMessage(err));
        }
      }
    },
  };
}

// ──── Workflow Event Plugin ───────────────────────────────────────────────────

/**
 * Records workflow events for sprint↔workflow cross-reference.
 * Replaces recordWorkflowEvent() calls in orchestrator.
 */
export function createWorkflowEventPlugin(opts: {
  recordWorkflowEvent: (params: Record<string, unknown>) => Promise<void>;
  getPhaseLeadAgent: (phase: string) => string | undefined;
}): SprintPlugin {
  const recordTransition = async (entityId: string, toPhase: string, state: SprintState) => {
    await opts.recordWorkflowEvent({
      sessionId: `sprint-${entityId}`,
      eventType: 'sprint_phase_transition',
      toState: toPhase,
      handoffTo: opts.getPhaseLeadAgent(toPhase),
      evidenceId: entityId,
      payload: {
        sprintId: entityId,
        guildId: state.guildId,
        objective: state.objective?.slice(0, 200),
        totalPhasesExecuted: state.totalPhasesExecuted,
        changedFilesCount: state.changedFiles?.length ?? 0,
      },
    }).catch(logCatchError(logger, '[VENTYD] recordWorkflowEvent'));
  };

  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        switch (event.eventName) {
          case 'sprint_pipeline:phase_advanced':
            await recordTransition(entityId, event.body.nextPhase, state);
            break;
          case 'sprint_pipeline:looped_back':
            await recordTransition(entityId, event.body.toPhase, state);
            break;
          case 'sprint_pipeline:completed':
          case 'sprint_pipeline:blocked':
            await recordTransition(entityId, state.currentPhase, state);
            break;
        }
      }
    },
  };
}

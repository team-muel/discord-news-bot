/**
 * Ventyd Plugins for Sprint Pipeline side effects.
 *
 * Replaces scattered hook/metric/journal calls in sprintOrchestrator
 * with composable, isolated plugin handlers that run after event commit.
 */
import type { Plugin } from 'ventyd';
import logger from '../../../logger';

// ──── Metrics Plugin ──────────────────────────────────────────────────────────

/**
 * Records sprint metrics (phase durations, loop-backs) after events are committed.
 * Replaces manual recordPhaseMetric/recordLoopBack calls in the orchestrator.
 */
export function createMetricsPlugin(opts: {
  recordPhaseMetric: (phase: string, durationMs: number, failed: boolean, deterministic?: boolean) => void;
  recordLoopBack: () => void;
  recordPipelineCreated: () => void;
}): Plugin {
  return {
    async onCommitted({ events }) {
      for (const event of events) {
        const e = event as any;
        switch (e.eventName) {
          case 'sprint_pipeline:created':
            opts.recordPipelineCreated();
            break;

          case 'sprint_pipeline:phase_completed': {
            const start = new Date(e.body.startedAt).getTime();
            const end = new Date(e.body.completedAt).getTime();
            const durationMs = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
            const failed = e.body.status === 'failed';
            opts.recordPhaseMetric(e.body.phase, durationMs, failed);
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
}): Plugin {
  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        const e = event as any;
        switch (e.eventName) {
          case 'sprint_pipeline:created':
            await opts.executeHooks({
              hookPoint: 'SprintStart',
              sprintId: entityId,
              meta: {
                triggerType: e.body.triggerType,
                objective: e.body.objective,
                guildId: e.body.guildId,
              },
            }).catch(() => {});
            break;

          case 'sprint_pipeline:phase_completed':
            await opts.executeHooks({
              hookPoint: 'PhaseComplete',
              sprintId: entityId,
              phase: e.body.phase,
              meta: {
                status: e.body.status,
              },
            }).catch(() => {});
            break;

          case 'sprint_pipeline:completed':
            await opts.executeHooks({
              hookPoint: 'SprintComplete',
              sprintId: entityId,
              meta: {
                objective: (state as any).objective,
                changedFiles: (state as any).changedFiles,
                totalPhasesExecuted: (state as any).totalPhasesExecuted,
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
export const auditLogPlugin: Plugin = {
  async onCommitted({ entityId, events }) {
    for (const event of events) {
      const e = event as any;
      logger.info('[VENTYD] entity=%s event=%s body=%j', entityId, e.eventName, e.body);
    }
  },
};

// ──── Signal Bus Plugin ───────────────────────────────────────────────────────

/**
 * Emits signal bus events for cross-system integration
 * (workflow.phase.looping, workflow.sprint.completed, workflow.sprint.failed).
 */
export function createSignalBusPlugin(): Plugin {
  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        const e = event as any;
        const s = state as any;

        try {
          const { emitSignal } = await import('../../runtime/signalBus');

          switch (e.eventName) {
            case 'sprint_pipeline:looped_back':
              if (e.body.loopCount >= 2) {
                emitSignal('workflow.phase.looping', 'sprintOrchestrator', s.guildId, {
                  sprintId: entityId,
                  loopCount: e.body.loopCount,
                  fromPhase: e.body.fromPhase,
                  toPhase: e.body.toPhase,
                });
              }
              break;

            case 'sprint_pipeline:completed':
              emitSignal('workflow.sprint.completed', 'sprintOrchestrator', s.guildId, {
                sprintId: entityId,
                triggerType: s.triggerType,
                phasesExecuted: s.totalPhasesExecuted,
                changedFiles: s.changedFiles,
              });
              break;

            case 'sprint_pipeline:blocked':
              emitSignal('workflow.sprint.failed', 'sprintOrchestrator', s.guildId, {
                sprintId: entityId,
                triggerType: s.triggerType,
                phasesExecuted: s.totalPhasesExecuted,
                changedFiles: s.changedFiles,
              });
              break;
          }
        } catch (err) {
          logger.debug('[VENTYD] signal-emit failed: %s', err instanceof Error ? err.message : String(err));
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
}): Plugin {
  return {
    async onCommitted({ entityId, events, state }) {
      for (const event of events) {
        const e = event as any;
        const s = state as any;

        if (e.eventName === 'sprint_pipeline:phase_advanced' ||
            e.eventName === 'sprint_pipeline:completed' ||
            e.eventName === 'sprint_pipeline:blocked' ||
            e.eventName === 'sprint_pipeline:looped_back') {
          const toPhase = e.body.nextPhase ?? e.body.toPhase ?? s.currentPhase;
          await opts.recordWorkflowEvent({
            sessionId: `sprint-${entityId}`,
            eventType: 'sprint_phase_transition',
            toState: toPhase,
            handoffTo: opts.getPhaseLeadAgent(toPhase),
            evidenceId: entityId,
            payload: {
              sprintId: entityId,
              guildId: s.guildId,
              objective: s.objective?.slice(0, 200),
              totalPhasesExecuted: s.totalPhasesExecuted,
              changedFilesCount: s.changedFiles?.length ?? 0,
            },
          }).catch(() => {});
        }
      }
    },
  };
}

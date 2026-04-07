/**
 * Sprint Event Sourcing Bridge — dual-write integration layer.
 *
 * Maintains backward compatibility with the existing sprintOrchestrator
 * by shadowing all state mutations as Ventyd events. The legacy
 * `persistPipeline()` (snapshot upsert) continues to work; this layer
 * adds the event log alongside it.
 *
 * Migration path:
 *   Phase A (current): dual-write — legacy snapshot + event append
 *   Phase B (future):  read from events, deprecate snapshot upsert
 *   Phase C (final):   remove legacy persistence, Entity becomes source of truth
 */
import logger from '../../../logger';
import { type Adapter, createRepository } from 'ventyd';
import { SprintPipelineEntity, createSprintPipelineRepository } from './sprintPipelineEntity';
import { createSupabaseAdapter } from './supabaseAdapter';
import { auditLogPlugin, type SprintPlugin } from './plugins';
import { isSupabaseConfigured, getSupabaseClient } from '../../supabaseClient';
import { SPRINT_DRY_RUN, VENTYD_EVENTS_TABLE, VENTYD_ENABLED } from '../../../config';

import type { SprintPipeline, SprintPhase, PhaseResult } from '../sprintOrchestrator';

// ──── In-memory adapter (fallback when Supabase unavailable) ──────────────────

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

// ──── Singleton repository ────────────────────────────────────────────────────

let _repo: ReturnType<typeof createSprintPipelineRepository> | null = null;
let _adapter: Adapter | null = null;

function getAdapter(): Adapter {
  if (_adapter) return _adapter;

  if (isSupabaseConfigured() && !SPRINT_DRY_RUN) {
    _adapter = createSupabaseAdapter({
      client: getSupabaseClient(),
      eventsTable: VENTYD_EVENTS_TABLE,
    });
  } else {
    _adapter = createInMemoryAdapter();
    if (SPRINT_DRY_RUN) {
      logger.debug('[VENTYD] dry-run mode — using in-memory adapter');
    }
  }
  return _adapter;
}

function buildPlugins(): SprintPlugin[] {
  const plugins: SprintPlugin[] = [auditLogPlugin];
  // Additional plugins (metrics, hooks, signal bus) can be added here
  // once Phase B migration replaces legacy metric/hook calls.
  return plugins;
}

export function getEventSourcingRepo() {
  if (_repo) return _repo;
  _repo = createRepository(SprintPipelineEntity, {
    adapter: getAdapter(),
    plugins: buildPlugins(),
    onPluginError: (error) => {
      logger.debug('[VENTYD] plugin error: %s', error instanceof Error ? error.message : String(error));
    },
  });
  return _repo;
}

/** Reset for testing. */
export function resetEventSourcingRepo() {
  _repo = null;
  _adapter = null;
}

// ──── Entity shadow map (sprintId → entity) ──────────────────────────────────

const entityMap = new Map<string, SprintPipelineEntity>();

// ──── Bridge functions (called from sprintOrchestrator) ──────────────────────

/**
 * Shadow a pipeline creation as a Ventyd event.
 * Call after createSprintPipeline() in the orchestrator.
 */
export async function shadowPipelineCreated(pipeline: SprintPipeline): Promise<void> {
  if (!VENTYD_ENABLED) return;
  try {
    const entity = SprintPipelineEntity.create({
      entityId: pipeline.sprintId,
      body: {
        triggerId: pipeline.triggerId,
        triggerType: pipeline.triggerType,
        guildId: pipeline.guildId,
        objective: pipeline.objective,
        autonomyLevel: pipeline.autonomyLevel,
        phaseOrder: [...pipeline.phaseOrder],
        maxImplReviewLoops: pipeline.maxImplReviewLoops,
      },
    });

    entityMap.set(pipeline.sprintId, entity);
    const repo = getEventSourcingRepo();
    await repo.commit(entity);

    logger.debug('[VENTYD] shadowed pipeline creation: %s', pipeline.sprintId);
  } catch (err) {
    logger.debug('[VENTYD] shadow creation failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Shadow a phase completion event.
 * Call after recording phaseResult in the orchestrator.
 */
export async function shadowPhaseCompleted(sprintId: string, params: {
  phase: SprintPhase;
  status: PhaseResult['status'];
  output: string;
  artifacts: string[];
  startedAt: string;
  completedAt: string;
  iterationCount: number;
}): Promise<void> {
  if (!VENTYD_ENABLED) return;
  try {
    const entity = entityMap.get(sprintId);
    if (!entity) return;

    entity.completePhase({
      phase: params.phase,
      status: params.status,
      output: params.output.slice(0, 5000), // cap to avoid oversized events
      artifacts: params.artifacts,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      iterationCount: params.iterationCount,
    });

    const repo = getEventSourcingRepo();
    await repo.commit(entity);

    logger.debug('[VENTYD] shadowed phase completion: %s/%s → %s', sprintId, params.phase, entity.currentPhase);
  } catch (err) {
    logger.debug('[VENTYD] shadow phase-complete failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Shadow changed files recording.
 */
export async function shadowFilesChanged(sprintId: string, files: string[]): Promise<void> {
  if (!VENTYD_ENABLED) return;
  try {
    const entity = entityMap.get(sprintId);
    if (!entity || files.length === 0) return;

    entity.recordChangedFiles(files);

    const repo = getEventSourcingRepo();
    await repo.commit(entity);
  } catch (err) {
    logger.debug('[VENTYD] shadow files-changed failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Shadow a pipeline cancellation.
 */
export async function shadowPipelineCancelled(sprintId: string): Promise<void> {
  if (!VENTYD_ENABLED) return;
  try {
    const entity = entityMap.get(sprintId);
    if (!entity || entity.isTerminal) return;

    entity.cancel();

    const repo = getEventSourcingRepo();
    await repo.commit(entity);
  } catch (err) {
    logger.debug('[VENTYD] shadow cancel failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Shadow a pipeline block.
 */
export async function shadowPipelineBlocked(sprintId: string, reason: string): Promise<void> {
  if (!VENTYD_ENABLED) return;
  try {
    const entity = entityMap.get(sprintId);
    if (!entity || entity.isTerminal) return;

    entity.block(reason);

    const repo = getEventSourcingRepo();
    await repo.commit(entity);
  } catch (err) {
    logger.debug('[VENTYD] shadow block failed: %s', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Get the event-sourced entity for diagnostics / time-travel queries.
 */
export function getEventSourcedEntity(sprintId: string): SprintPipelineEntity | undefined {
  return entityMap.get(sprintId);
}

/**
 * Rehydrate a pipeline from the event store (for diagnostics / audit).
 * Unlike the legacy snapshot rehydration, this replays all events.
 */
export async function rehydrateFromEvents(sprintId: string): Promise<SprintPipelineEntity | null> {
  try {
    const repo = getEventSourcingRepo();
    const entity = await repo.findOne({ entityId: sprintId });
    if (entity) {
      entityMap.set(sprintId, entity);
    }
    return entity;
  } catch (err) {
    logger.debug('[VENTYD] rehydrate failed: %s', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Fetch raw event timeline for a sprint pipeline from the adapter.
 */
export async function getEventTimeline(sprintId: string): Promise<unknown[]> {
  try {
    const adapter = getAdapter();
    return await adapter.getEventsByEntityId({
      entityName: 'sprint_pipeline',
      entityId: sprintId,
    });
  } catch {
    return [];
  }
}

/**
 * Bulk-rehydrate event-sourced entities for a set of sprint IDs.
 * Called at startup after legacy pipeline rehydration so the entityMap
 * is populated and subsequent shadow calls don't silently skip.
 */
export async function rehydrateEventSourcingEntities(sprintIds: string[]): Promise<number> {
  if (!VENTYD_ENABLED || sprintIds.length === 0) return 0;
  let count = 0;
  for (const id of sprintIds) {
    try {
      const entity = await rehydrateFromEvents(id);
      if (entity) count++;
    } catch {
      // individual failures don't block the others
    }
  }
  logger.info('[VENTYD] rehydrated %d/%d entities from event store', count, sprintIds.length);
  return count;
}

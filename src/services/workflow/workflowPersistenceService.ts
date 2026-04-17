/**
 * Workflow persistence service — records workflow sessions, steps, and events
 * into Supabase workflow_sessions / workflow_steps / workflow_events tables.
 *
 * Used by the upgraded actionRunner judgment loop to record execution history
 * for observability, decision audit trail, and replanning intelligence.
 */
import crypto from 'crypto';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  buildWorkflowArtifactRefEvent,
  buildWorkflowCapabilityDemandEvent,
  buildWorkflowDecisionDistillatePayload,
  buildWorkflowRecallRequestPayload,
  DEFAULT_WORKFLOW_RUNTIME_LANE as RAW_DEFAULT_WORKFLOW_RUNTIME_LANE,
  inferWorkflowRuntimeLane as rawInferWorkflowRuntimeLane,
  normalizeWorkflowRuntimeLane as rawNormalizeWorkflowRuntimeLane,
  parseWorkflowArtifactRefSummaries,
  parseWorkflowCapabilityDemandSummaries,
  parseWorkflowDecisionDistillateSummary,
  parseWorkflowRecallRequestSummary,
} from './workflowPersistenceTransforms';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'proposed'
  | 'classified'
  | 'routed'
  | 'executing'
  | 'verifying'
  | 'approving'
  | 'released'
  | 'recovering'
  | 'failed';

export type WorkflowStepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export type WorkflowRuntimeLane = 'operator-personal' | 'public-guild' | 'system-internal' | 'system-sprint' | (string & {});

export type WorkflowSession = {
  sessionId: string;
  workflowName: string;
  stage: string;
  scope?: string;
  status: WorkflowStatus;
  metadata?: Record<string, unknown>;
};

export type WorkflowStep = {
  sessionId: string;
  stepOrder: number;
  stepName: string;
  agentRole?: string;
  status: WorkflowStepStatus;
  durationMs?: number;
  details?: Record<string, unknown>;
};

export type WorkflowEvent = {
  sessionId: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  handoffFrom?: string;
  handoffTo?: string;
  decisionReason?: string;
  evidenceId?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowRecallRequest = {
  sessionId: string;
  decisionReason: string;
  evidenceId?: string;
  blockedAction?: string;
  nextAction?: string;
  requestedBy?: string;
  runtimeLane?: WorkflowRuntimeLane;
  failedStepNames?: string[];
  payload?: Record<string, unknown>;
};

export type WorkflowRecallRequestSummary = {
  createdAt: string | null;
  decisionReason: string | null;
  evidenceId: string | null;
  blockedAction: string | null;
  nextAction: string | null;
  requestedBy: string | null;
  runtimeLane: WorkflowRuntimeLane;
  failedStepNames: string[];
};

export type WorkflowArtifactRefKind = 'repo-file' | 'vault-note' | 'log' | 'url' | 'git-ref' | 'workflow-session' | 'other';
export type WorkflowArtifactPlane = 'github' | 'obsidian' | 'hot-state' | 'external' | 'other';
export type WorkflowGithubSettlementKind = 'repo-file' | 'branch' | 'commit' | 'pull-request' | 'issue' | 'ci-run' | 'review' | 'release' | 'other';

export type WorkflowArtifactRef = {
  locator: string;
  refKind: WorkflowArtifactRefKind;
  title?: string;
  artifactPlane?: WorkflowArtifactPlane;
  githubSettlementKind?: WorkflowGithubSettlementKind;
};

export type WorkflowArtifactRefBatch = {
  sessionId: string;
  refs: WorkflowArtifactRef[];
  runtimeLane?: WorkflowRuntimeLane;
  sourceStepName?: string;
  sourceEvent?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowArtifactRefSummary = {
  createdAt: string | null;
  locator: string;
  refKind: WorkflowArtifactRefKind;
  title: string | null;
  artifactPlane: WorkflowArtifactPlane | null;
  githubSettlementKind: WorkflowGithubSettlementKind | null;
  runtimeLane: WorkflowRuntimeLane;
  sourceStepName: string | null;
  sourceEvent: string | null;
};

export type WorkflowDecisionDistillate = {
  sessionId: string;
  summary: string;
  evidenceId?: string;
  nextAction?: string;
  runtimeLane?: WorkflowRuntimeLane;
  sourceEvent?: string;
  promoteAs?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
};

export type WorkflowDecisionDistillateSummary = {
  createdAt: string | null;
  summary: string | null;
  evidenceId: string | null;
  nextAction: string | null;
  runtimeLane: WorkflowRuntimeLane;
  sourceEvent: string | null;
  promoteAs: string | null;
  tags: string[];
};

export type WorkflowCapabilityDemand = {
  summary: string;
  objective?: string;
  missingCapability?: string;
  missingSource?: string;
  failedOrInsufficientRoute?: string;
  cheapestEnablementPath?: string;
  proposedOwner?: string;
  evidenceRefs?: string[];
  evidenceRefDetails?: WorkflowArtifactRef[];
  recallCondition?: string;
  runtimeLane?: WorkflowRuntimeLane;
  sourceEvent?: string;
  tags?: string[];
};

export type WorkflowCapabilityDemandBatch = {
  sessionId: string;
  demands: WorkflowCapabilityDemand[];
  runtimeLane?: WorkflowRuntimeLane;
  sourceEvent?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
};

export type WorkflowCapabilityDemandSummary = {
  createdAt: string | null;
  summary: string | null;
  objective: string | null;
  missingCapability: string | null;
  missingSource: string | null;
  failedOrInsufficientRoute: string | null;
  cheapestEnablementPath: string | null;
  proposedOwner: string | null;
  evidenceRefs: string[];
  evidenceRefDetails: WorkflowArtifactRefSummary[];
  recallCondition: string | null;
  runtimeLane: WorkflowRuntimeLane;
  sourceEvent: string | null;
  tags: string[];
};

export type WorkflowSessionSummary = {
  sessionId: string;
  workflowName: string;
  status: WorkflowStatus;
  runtimeLane: WorkflowRuntimeLane;
  lastRecallRequest: WorkflowRecallRequestSummary | null;
  lastDecisionDistillate: WorkflowDecisionDistillateSummary | null;
  lastCapabilityDemands: WorkflowCapabilityDemandSummary[];
  lastArtifactRefs: WorkflowArtifactRefSummary[];
  stepCount: number;
  passedSteps: number;
  failedSteps: number;
  totalDurationMs: number;
};

export const DEFAULT_WORKFLOW_RUNTIME_LANE: WorkflowRuntimeLane = RAW_DEFAULT_WORKFLOW_RUNTIME_LANE as WorkflowRuntimeLane;

export const normalizeWorkflowRuntimeLane = (value: unknown): WorkflowRuntimeLane =>
  rawNormalizeWorkflowRuntimeLane(value, DEFAULT_WORKFLOW_RUNTIME_LANE) as WorkflowRuntimeLane;

export const inferWorkflowRuntimeLane = (params: {
  workflowName?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}): WorkflowRuntimeLane =>
  rawInferWorkflowRuntimeLane(params, DEFAULT_WORKFLOW_RUNTIME_LANE) as WorkflowRuntimeLane;

// ─── Session ID Generation ────────────────────────────────────────────────────

export const generateSessionId = (): string => {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex');
  return `wf-${ts}-${rand}`;
};

// ─── Session Operations ───────────────────────────────────────────────────────

export const createWorkflowSession = async (session: WorkflowSession): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const metadata = {
      ...(session.metadata || {}),
      runtime_lane: inferWorkflowRuntimeLane({
        workflowName: session.workflowName,
        scope: session.scope,
        metadata: session.metadata,
      }),
    };
    const { error } = await client.from('workflow_sessions').insert({
      session_id: session.sessionId,
      workflow_name: session.workflowName,
      stage: session.stage,
      scope: session.scope || null,
      status: session.status,
      metadata,
    });
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] createSession failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    logger.warn('[WORKFLOW-PERSIST] createSession exception: %s', msg);
    return { ok: false, error: msg };
  }
};

export const updateWorkflowSessionStatus = async (
  sessionId: string,
  status: WorkflowStatus,
  completedAt?: boolean,
): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const update: Record<string, unknown> = { status };
    if (completedAt) {
      update.completed_at = new Date().toISOString();
    }
    const { error } = await client
      .from('workflow_sessions')
      .update(update)
      .eq('session_id', sessionId);
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] updateSessionStatus failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ok: false, error: msg };
  }
};

// ─── Step Operations ──────────────────────────────────────────────────────────

export const insertWorkflowStep = async (step: WorkflowStep): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const { error } = await client.from('workflow_steps').insert({
      session_id: step.sessionId,
      step_order: step.stepOrder,
      step_name: step.stepName,
      agent_role: step.agentRole || null,
      status: step.status,
      duration_ms: step.durationMs || null,
      details: step.details || {},
    });
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] insertStep failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ok: false, error: msg };
  }
};

export const updateWorkflowStep = async (
  sessionId: string,
  stepOrder: number,
  update: { status: WorkflowStepStatus; durationMs?: number; details?: Record<string, unknown> },
): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const row: Record<string, unknown> = { status: update.status };
    if (update.durationMs != null) row.duration_ms = update.durationMs;
    if (update.details) row.details = update.details;
    if (update.status === 'passed' || update.status === 'failed') {
      row.completed_at = new Date().toISOString();
    }
    const { error } = await client
      .from('workflow_steps')
      .update(row)
      .eq('session_id', sessionId)
      .eq('step_order', stepOrder);
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] updateStep failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ok: false, error: msg };
  }
};

// ─── Event Recording ──────────────────────────────────────────────────────────

type WorkflowEventSummaryRow = {
  created_at?: unknown;
  decision_reason?: unknown;
  evidence_id?: unknown;
  payload?: unknown;
};

const WORKFLOW_EVENT_SELECT_WITH_EVIDENCE = 'created_at, decision_reason, evidence_id, payload';
const WORKFLOW_EVENT_SELECT_WITH_REASON = 'created_at, decision_reason, payload';
const WORKFLOW_EVENT_SELECT_PAYLOAD_ONLY = 'created_at, payload';

const recordBuiltWorkflowEvent = async (
  sessionId: string,
  eventType: string,
  event: { payload: Record<string, unknown>; decisionReason: string } | null,
): Promise<{ ok: boolean; error?: string }> => {
  if (!event) {
    return { ok: true };
  }

  return recordWorkflowEvent({
    sessionId,
    eventType,
    decisionReason: event.decisionReason,
    payload: event.payload,
  });
};

const getLatestWorkflowEventRow = async (
  sessionId: string,
  eventType: string,
  selectClause: string,
): Promise<WorkflowEventSummaryRow | null> => {
  const client = getSupabaseClient();
  const { data } = await client
    .from('workflow_events')
    .select(selectClause)
    .eq('session_id', sessionId)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data && typeof data === 'object'
    ? data as WorkflowEventSummaryRow
    : null;
};

const getParsedLatestWorkflowEvent = async <T>(params: {
  sessionId: string;
  eventType: string;
  selectClause: string;
  fallbackValue: T;
  fallbackLane: WorkflowRuntimeLane;
  parser: (row: WorkflowEventSummaryRow | null, fallbackLane: WorkflowRuntimeLane) => T;
}): Promise<T> => {
  if (!isSupabaseConfigured()) {
    return params.fallbackValue;
  }

  try {
    const row = await getLatestWorkflowEventRow(params.sessionId, params.eventType, params.selectClause);
    return params.parser(row, params.fallbackLane);
  } catch {
    return params.fallbackValue;
  }
};

export const recordWorkflowEvent = async (event: WorkflowEvent): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const { error } = await client.from('workflow_events').insert({
      session_id: event.sessionId,
      event_type: event.eventType,
      from_state: event.fromState || null,
      to_state: event.toState || null,
      handoff_from: event.handoffFrom || null,
      handoff_to: event.handoffTo || null,
      decision_reason: event.decisionReason || null,
      evidence_id: event.evidenceId || null,
      payload: event.payload || {},
    });
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] recordEvent failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { ok: false, error: msg };
  }
};

export const recordWorkflowRecallRequest = async (
  request: WorkflowRecallRequest,
): Promise<{ ok: boolean; error?: string }> => {
  return recordWorkflowEvent({
    sessionId: request.sessionId,
    eventType: 'recall_request',
    decisionReason: request.decisionReason,
    evidenceId: request.evidenceId,
    payload: buildWorkflowRecallRequestPayload(request),
  });
};

export const recordWorkflowDecisionDistillate = async (
  distillate: WorkflowDecisionDistillate,
): Promise<{ ok: boolean; error?: string }> => {
  return recordWorkflowEvent({
    sessionId: distillate.sessionId,
    eventType: 'decision_distillate',
    decisionReason: distillate.summary,
    evidenceId: distillate.evidenceId,
    payload: buildWorkflowDecisionDistillatePayload(distillate),
  });
};

export const recordWorkflowCapabilityDemands = async (
  batch: WorkflowCapabilityDemandBatch,
): Promise<{ ok: boolean; error?: string }> => {
  return recordBuiltWorkflowEvent(
    batch.sessionId,
    'capability_demand',
    buildWorkflowCapabilityDemandEvent({
      payload: batch.payload,
      demands: batch.demands as Array<Record<string, unknown>>,
      runtimeLane: batch.runtimeLane,
      sourceEvent: batch.sourceEvent,
      tags: batch.tags,
    }),
  );
};

export const recordWorkflowArtifactRefs = async (
  batch: WorkflowArtifactRefBatch,
): Promise<{ ok: boolean; error?: string }> => {
  return recordBuiltWorkflowEvent(
    batch.sessionId,
    'artifact_ref',
    buildWorkflowArtifactRefEvent({
      payload: batch.payload,
      refs: batch.refs as Array<Record<string, unknown>>,
      runtimeLane: batch.runtimeLane,
      sourceStepName: batch.sourceStepName,
      sourceEvent: batch.sourceEvent,
    }),
  );
};

export const getLatestWorkflowRecallRequest = async (
  sessionId: string,
  fallbackLane: WorkflowRuntimeLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
): Promise<WorkflowRecallRequestSummary | null> => {
  return getParsedLatestWorkflowEvent({
    sessionId,
    eventType: 'recall_request',
    selectClause: WORKFLOW_EVENT_SELECT_WITH_EVIDENCE,
    fallbackValue: null,
    fallbackLane,
    parser: (row, lane) => (parseWorkflowRecallRequestSummary(row, lane) || null) as WorkflowRecallRequestSummary | null,
  });
};

export const getLatestWorkflowDecisionDistillate = async (
  sessionId: string,
  fallbackLane: WorkflowRuntimeLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
): Promise<WorkflowDecisionDistillateSummary | null> => {
  return getParsedLatestWorkflowEvent({
    sessionId,
    eventType: 'decision_distillate',
    selectClause: WORKFLOW_EVENT_SELECT_WITH_EVIDENCE,
    fallbackValue: null,
    fallbackLane,
    parser: (row, lane) => (parseWorkflowDecisionDistillateSummary(row, lane) || null) as WorkflowDecisionDistillateSummary | null,
  });
};

export const getLatestWorkflowCapabilityDemands = async (
  sessionId: string,
  fallbackLane: WorkflowRuntimeLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
): Promise<WorkflowCapabilityDemandSummary[]> => {
  return getParsedLatestWorkflowEvent({
    sessionId,
    eventType: 'capability_demand',
    selectClause: WORKFLOW_EVENT_SELECT_WITH_REASON,
    fallbackValue: [],
    fallbackLane,
    parser: (row, lane) => parseWorkflowCapabilityDemandSummaries(row, lane) as WorkflowCapabilityDemandSummary[],
  });
};

export const getLatestWorkflowArtifactRefs = async (
  sessionId: string,
  fallbackLane: WorkflowRuntimeLane = DEFAULT_WORKFLOW_RUNTIME_LANE,
): Promise<WorkflowArtifactRefSummary[]> => {
  return getParsedLatestWorkflowEvent({
    sessionId,
    eventType: 'artifact_ref',
    selectClause: WORKFLOW_EVENT_SELECT_PAYLOAD_ONLY,
    fallbackValue: [],
    fallbackLane,
    parser: (row, lane) => parseWorkflowArtifactRefSummaries(row, lane) as WorkflowArtifactRefSummary[],
  });
};

// ─── Query / Summary ──────────────────────────────────────────────────────────

export const getWorkflowSessionSummary = async (sessionId: string): Promise<WorkflowSessionSummary | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { data: session } = await client
      .from('workflow_sessions')
      .select('session_id, workflow_name, status, scope, metadata')
      .eq('session_id', sessionId)
      .single();
    if (!session) return null;

    const { data: steps } = await client
      .from('workflow_steps')
      .select('status, duration_ms')
      .eq('session_id', sessionId);

    const stepList = steps || [];
    const runtimeLane = inferWorkflowRuntimeLane({
      workflowName: session.workflow_name,
      scope: session.scope as string | undefined,
      metadata: session.metadata as Record<string, unknown> | undefined,
    });
    const [lastRecallRequest, lastDecisionDistillate, lastCapabilityDemands, lastArtifactRefs] = await Promise.all([
      getLatestWorkflowRecallRequest(sessionId, runtimeLane),
      getLatestWorkflowDecisionDistillate(sessionId, runtimeLane),
      getLatestWorkflowCapabilityDemands(sessionId, runtimeLane),
      getLatestWorkflowArtifactRefs(sessionId, runtimeLane),
    ]);
    return {
      sessionId: session.session_id,
      workflowName: session.workflow_name,
      status: session.status as WorkflowStatus,
      runtimeLane,
      lastRecallRequest,
      lastDecisionDistillate,
      lastCapabilityDemands,
      lastArtifactRefs,
      stepCount: stepList.length,
      passedSteps: stepList.filter((s: { status: string }) => s.status === 'passed').length,
      failedSteps: stepList.filter((s: { status: string }) => s.status === 'failed').length,
      totalDurationMs: stepList.reduce((sum: number, s: { duration_ms: number | null }) => sum + (s.duration_ms || 0), 0),
    };
  } catch {
    return null;
  }
};

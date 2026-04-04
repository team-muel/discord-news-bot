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

export type WorkflowSessionSummary = {
  sessionId: string;
  workflowName: string;
  status: WorkflowStatus;
  stepCount: number;
  passedSteps: number;
  failedSteps: number;
  totalDurationMs: number;
};

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
    const { error } = await client.from('workflow_sessions').insert({
      session_id: session.sessionId,
      workflow_name: session.workflowName,
      stage: session.stage,
      scope: session.scope || null,
      status: session.status,
      metadata: session.metadata || {},
    });
    if (error) {
      logger.warn('[WORKFLOW-PERSIST] createSession failed: %s', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
    const msg = err instanceof Error ? err.message : String(err);
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
    const msg = err instanceof Error ? err.message : String(err);
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
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
};

// ─── Event Recording ──────────────────────────────────────────────────────────

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
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
};

// ─── Query / Summary ──────────────────────────────────────────────────────────

export const getWorkflowSessionSummary = async (sessionId: string): Promise<WorkflowSessionSummary | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    const client = getSupabaseClient();
    const { data: session } = await client
      .from('workflow_sessions')
      .select('session_id, workflow_name, status')
      .eq('session_id', sessionId)
      .single();
    if (!session) return null;

    const { data: steps } = await client
      .from('workflow_steps')
      .select('status, duration_ms')
      .eq('session_id', sessionId);

    const stepList = steps || [];
    return {
      sessionId: session.session_id,
      workflowName: session.workflow_name,
      status: session.status as WorkflowStatus,
      stepCount: stepList.length,
      passedSteps: stepList.filter((s: { status: string }) => s.status === 'passed').length,
      failedSteps: stepList.filter((s: { status: string }) => s.status === 'failed').length,
      totalDurationMs: stepList.reduce((sum: number, s: { duration_ms: number | null }) => sum + (s.duration_ms || 0), 0),
    };
  } catch {
    return null;
  }
};

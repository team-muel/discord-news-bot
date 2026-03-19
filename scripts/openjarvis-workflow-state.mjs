/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'tmp', 'autonomy');
const SESSIONS_DIR = path.join(TMP_DIR, 'workflow-sessions');

const ALLOWED_TRANSITIONS = {
  proposed: ['classified', 'recovering', 'failed'],
  classified: ['routed', 'recovering', 'failed'],
  routed: ['executing', 'recovering', 'failed'],
  executing: ['verifying', 'recovering', 'failed'],
  verifying: ['approving', 'recovering', 'failed'],
  approving: ['released', 'recovering', 'failed'],
  recovering: ['failed', 'released'],
  released: [],
  failed: [],
};

const nowIso = () => new Date().toISOString();

const makeSessionId = () => {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `openjarvis-${seed}`;
};

const sanitize = (value, fallback = '') => String(value || fallback).trim();

const writeSession = (sessionPath, session) => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
};

export const createWorkflowSession = (params = {}) => {
  const sessionId = sanitize(params.sessionId) || makeSessionId();
  const now = nowIso();
  const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  const session = {
    session_id: sessionId,
    workflow_name: 'openjarvis.unattended',
    stage: sanitize(params.stage, 'A') || 'A',
    scope: sanitize(params.scope, 'weekly:auto') || 'weekly:auto',
    status: 'proposed',
    metadata: {
      dry_run: Boolean(params.dryRun),
      auto_deploy: Boolean(params.autoDeploy),
      strict: Boolean(params.strict),
      created_by: 'run-openjarvis-unattended',
    },
    started_at: now,
    completed_at: null,
    steps: [],
    events: [
      {
        event_type: 'session.created',
        from_state: null,
        to_state: 'proposed',
        handoff_from: null,
        handoff_to: 'openjarvis',
        decision_reason: 'workflow initialized',
        evidence_id: null,
        payload: {
          script: 'run-openjarvis-unattended',
        },
        created_at: now,
      },
    ],
  };

  writeSession(sessionPath, session);
  return { sessionId, sessionPath, session };
};

const ensureTransitionAllowed = (fromState, toState) => {
  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  if (allowed.includes(toState)) {
    return;
  }
  throw new Error(`INVALID_WORKFLOW_TRANSITION:${fromState}->${toState}`);
};

const readSession = (sessionPath) => {
  const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.steps) || !Array.isArray(parsed.events)) {
    throw new Error('INVALID_WORKFLOW_SESSION_FILE');
  }
  return parsed;
};

export const transitionWorkflow = (sessionPath, params) => {
  const session = readSession(sessionPath);
  const fromState = sanitize(session.status, 'proposed') || 'proposed';
  const toState = sanitize(params.toState);

  if (!toState) {
    throw new Error('WORKFLOW_TO_STATE_REQUIRED');
  }

  ensureTransitionAllowed(fromState, toState);

  const event = {
    event_type: sanitize(params.eventType, 'state.transition') || 'state.transition',
    from_state: fromState,
    to_state: toState,
    handoff_from: sanitize(params.handoffFrom) || null,
    handoff_to: sanitize(params.handoffTo) || null,
    decision_reason: sanitize(params.reason) || null,
    evidence_id: sanitize(params.evidenceId) || null,
    payload: params.payload && typeof params.payload === 'object' ? params.payload : {},
    created_at: nowIso(),
  };

  session.status = toState;
  if (toState === 'released' || toState === 'failed') {
    session.completed_at = event.created_at;
  }
  session.events.push(event);

  writeSession(sessionPath, session);
  return session;
};

export const beginWorkflowStep = (sessionPath, params) => {
  const session = readSession(sessionPath);
  const stepName = sanitize(params.stepName);

  if (!stepName) {
    throw new Error('WORKFLOW_STEP_NAME_REQUIRED');
  }

  const nextOrder = session.steps.length + 1;
  const step = {
    step_order: nextOrder,
    step_name: stepName,
    agent_role: sanitize(params.agentRole, 'openjarvis') || 'openjarvis',
    status: 'running',
    started_at: nowIso(),
    completed_at: null,
    duration_ms: null,
    details: params.details && typeof params.details === 'object' ? params.details : {},
  };

  session.steps.push(step);
  session.events.push({
    event_type: 'step.started',
    from_state: session.status,
    to_state: session.status,
    handoff_from: sanitize(params.handoffFrom) || null,
    handoff_to: sanitize(params.handoffTo, step.agent_role) || step.agent_role,
    decision_reason: sanitize(params.reason, `started ${stepName}`) || `started ${stepName}`,
    evidence_id: sanitize(params.evidenceId) || null,
    payload: {
      step_order: step.step_order,
      step_name: step.step_name,
      agent_role: step.agent_role,
    },
    created_at: step.started_at,
  });

  writeSession(sessionPath, session);
  return step.step_order;
};

export const finishWorkflowStep = (sessionPath, params) => {
  const session = readSession(sessionPath);
  const stepOrder = Number(params.stepOrder || 0);
  const step = session.steps.find((item) => Number(item.step_order) === stepOrder);

  if (!step) {
    throw new Error('WORKFLOW_STEP_NOT_FOUND');
  }

  if (step.status !== 'running') {
    throw new Error('WORKFLOW_STEP_ALREADY_FINISHED');
  }

  const completedAt = nowIso();
  const startedAtMs = Date.parse(step.started_at);
  const completedAtMs = Date.parse(completedAt);
  const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
    ? Math.max(0, completedAtMs - startedAtMs)
    : null;

  const status = sanitize(params.status, 'passed');
  if (!['passed', 'failed', 'skipped'].includes(status)) {
    throw new Error(`INVALID_WORKFLOW_STEP_STATUS:${status}`);
  }

  step.status = status;
  step.completed_at = completedAt;
  step.duration_ms = durationMs;
  step.details = {
    ...step.details,
    ...(params.details && typeof params.details === 'object' ? params.details : {}),
  };

  session.events.push({
    event_type: 'step.finished',
    from_state: session.status,
    to_state: session.status,
    handoff_from: sanitize(params.handoffFrom) || null,
    handoff_to: sanitize(params.handoffTo, step.agent_role) || step.agent_role,
    decision_reason: sanitize(params.reason, `finished ${step.step_name}`) || `finished ${step.step_name}`,
    evidence_id: sanitize(params.evidenceId) || null,
    payload: {
      step_order: step.step_order,
      step_name: step.step_name,
      step_status: step.status,
      duration_ms: step.duration_ms,
    },
    created_at: completedAt,
  });

  writeSession(sessionPath, session);
  return step;
};

export const loadWorkflowSession = (sessionPath) => readSession(sessionPath);

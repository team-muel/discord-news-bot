/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

import { SUPABASE_KEY, SUPABASE_URL, createScriptClient, isMissingRelationError } from './lib/supabaseClient.mjs';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'tmp', 'autonomy');
const SESSIONS_DIR = path.join(TMP_DIR, 'workflow-sessions');
const WORKFLOW_SESSIONS_TABLE = 'workflow_sessions';
const WORKFLOW_STEPS_TABLE = 'workflow_steps';
const WORKFLOW_EVENTS_TABLE = 'workflow_events';
const DEFAULT_WAIT_FOR_NEXT_OBJECTIVE = 'wait for the next gpt objective or human approval boundary';
const DEFAULT_RUNTIME_LANE = 'operator-personal';

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
const sanitizeRuntimeLane = (value) => sanitize(value, DEFAULT_RUNTIME_LANE) || DEFAULT_RUNTIME_LANE;

const canUseSupabaseWorkflowPlane = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

const safeQueueDefaults = () => ([
  'continue the current workflow if runner and workstream state stay healthy',
  'keep workflow session, launch state, and summary aligned',
  'refresh the active continuity packet only as a briefing artifact, not as the sole runtime owner',
]);

const buildAutoRestartNextAction = () => 'restart the next bounded automation cycle from the active objective';

const stepFailed = (step) => ['fail', 'failed'].includes(sanitize(step?.status).toLowerCase());
const stepRunning = (step) => sanitize(step?.status).toLowerCase() === 'running';

const listLatestLocalSessionPath = () => {
  try {
    const entries = fs.readdirSync(SESSIONS_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(SESSIONS_DIR, name);
        const stat = fs.statSync(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return entries[0]?.fullPath || null;
  } catch {
    return null;
  }
};

const writeSession = (sessionPath, session) => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
};

const buildRemoteSessionRow = (session) => ({
  session_id: session.session_id,
  workflow_name: session.workflow_name,
  stage: session.stage,
  scope: session.scope || null,
  status: session.status,
  metadata: session.metadata || {},
  started_at: session.started_at,
  completed_at: session.completed_at || null,
});

const applyRuntimeLaneFilter = (query, runtimeLane) => query.contains('metadata', {
  runtime_lane: sanitizeRuntimeLane(runtimeLane),
});

const buildRemoteStepRow = (step, sessionId) => ({
  session_id: sessionId,
  step_order: step.step_order,
  step_name: step.step_name,
  agent_role: step.agent_role || null,
  status: step.status,
  started_at: step.started_at,
  completed_at: step.completed_at || null,
  duration_ms: step.duration_ms || null,
  details: step.details || {},
});

const buildRemoteEventRow = (event, sessionId) => ({
  session_id: sessionId,
  event_type: event.event_type,
  from_state: event.from_state || null,
  to_state: event.to_state || null,
  handoff_from: event.handoff_from || null,
  handoff_to: event.handoff_to || null,
  decision_reason: event.decision_reason || null,
  evidence_id: event.evidence_id || null,
  payload: event.payload || {},
  created_at: event.created_at || nowIso(),
});

const swallowSupabaseWorkflowError = (error) => {
  if (!error) {
    return false;
  }
  return isMissingRelationError(error, WORKFLOW_SESSIONS_TABLE)
    || isMissingRelationError(error, WORKFLOW_STEPS_TABLE)
    || isMissingRelationError(error, WORKFLOW_EVENTS_TABLE);
};

const withWorkflowClient = async (work) => {
  if (!canUseSupabaseWorkflowPlane()) {
    return { ok: false, reason: 'supabase_not_configured' };
  }
  try {
    const client = createScriptClient();
    return await work(client);
  } catch (error) {
    if (swallowSupabaseWorkflowError(error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return {
      ok: false,
      reason: sanitize(error?.message || error, 'supabase_workflow_error') || 'supabase_workflow_error',
    };
  }
};

const persistWorkflowSessionRemote = async (session) => withWorkflowClient(async (client) => {
  const { error } = await client.from(WORKFLOW_SESSIONS_TABLE).upsert(buildRemoteSessionRow(session), {
    onConflict: 'session_id',
  });
  if (error) {
    if (swallowSupabaseWorkflowError(error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return { ok: false, reason: sanitize(error.message, 'workflow_session_upsert_failed') };
  }
  return { ok: true, reason: 'persisted' };
});

const persistWorkflowStepRemote = async (sessionId, step) => withWorkflowClient(async (client) => {
  const { error } = await client.from(WORKFLOW_STEPS_TABLE).upsert(buildRemoteStepRow(step, sessionId), {
    onConflict: 'session_id,step_order',
  });
  if (error) {
    if (swallowSupabaseWorkflowError(error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return { ok: false, reason: sanitize(error.message, 'workflow_step_upsert_failed') };
  }
  return { ok: true, reason: 'persisted' };
});

const persistWorkflowEventRemote = async (sessionId, event) => withWorkflowClient(async (client) => {
  const { error } = await client.from(WORKFLOW_EVENTS_TABLE).insert(buildRemoteEventRow(event, sessionId));
  if (error) {
    if (swallowSupabaseWorkflowError(error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return { ok: false, reason: sanitize(error.message, 'workflow_event_insert_failed') };
  }
  return { ok: true, reason: 'persisted' };
});

const readRemoteWorkflowState = async (params = {}) => withWorkflowClient(async (client) => {
  const requestedSessionId = sanitize(params.sessionId);
  const requestedScope = sanitize(params.scope);
  const requestedWorkflowName = sanitize(params.workflowName, 'openjarvis.unattended') || 'openjarvis.unattended';
  const requestedStage = sanitize(params.stage);
  const requestedRuntimeLane = sanitizeRuntimeLane(params.runtimeLane);

  let sessionQuery = applyRuntimeLaneFilter(client.from(WORKFLOW_SESSIONS_TABLE).select('*'), requestedRuntimeLane);
  if (requestedSessionId) {
    sessionQuery = sessionQuery.eq('session_id', requestedSessionId);
  } else {
    sessionQuery = sessionQuery.eq('workflow_name', requestedWorkflowName);
    if (requestedScope) {
      sessionQuery = sessionQuery.eq('scope', requestedScope);
    }
    if (requestedStage) {
      sessionQuery = sessionQuery.eq('stage', requestedStage);
    }
  }

  const sessionResult = requestedSessionId
    ? await sessionQuery.maybeSingle()
    : await sessionQuery.order('started_at', { ascending: false }).limit(1).maybeSingle();

  if (sessionResult.error) {
    if (swallowSupabaseWorkflowError(sessionResult.error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return { ok: false, reason: sanitize(sessionResult.error.message, 'workflow_session_query_failed') };
  }

  const session = sessionResult.data || null;
  if (!session) {
    return { ok: false, reason: 'not_found' };
  }

  const [stepsResult, eventsResult] = await Promise.all([
    client
      .from(WORKFLOW_STEPS_TABLE)
      .select('*')
      .eq('session_id', session.session_id)
      .order('step_order', { ascending: true }),
    client
      .from(WORKFLOW_EVENTS_TABLE)
      .select('*')
      .eq('session_id', session.session_id)
      .order('created_at', { ascending: true }),
  ]);

  if (stepsResult.error || eventsResult.error) {
    const error = stepsResult.error || eventsResult.error;
    if (swallowSupabaseWorkflowError(error)) {
      return { ok: false, reason: 'workflow_tables_missing' };
    }
    return { ok: false, reason: sanitize(error?.message, 'workflow_detail_query_failed') };
  }

  return {
    ok: true,
    reason: 'loaded',
    source: 'supabase',
    sessionPath: null,
    session: {
      ...session,
      steps: stepsResult.data || [],
      events: eventsResult.data || [],
    },
  };
});

export const createWorkflowSession = async (params = {}) => {
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
      route_mode: sanitize(params.routeMode, 'operations') || 'operations',
      runtime_lane: sanitizeRuntimeLane(params.runtimeLane),
      objective: sanitize(params.objective, 'weekly unattended autonomy cycle') || 'weekly unattended autonomy cycle',
      auto_restart_on_release: Boolean(params.autoRestartOnRelease),
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
  const remote = await persistWorkflowSessionRemote(session);
  if (remote.ok) {
    await persistWorkflowEventRemote(session.session_id, session.events[0]);
  }
  return {
    sessionId,
    sessionPath,
    session,
    source: remote.ok ? 'supabase+local-mirror' : 'local-mirror',
    remote,
  };
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

export const transitionWorkflow = async (sessionPath, params) => {
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
  await persistWorkflowSessionRemote(session);
  await persistWorkflowEventRemote(session.session_id, event);
  return session;
};

export const beginWorkflowStep = async (sessionPath, params) => {
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
  await persistWorkflowStepRemote(session.session_id, step);
  await persistWorkflowEventRemote(session.session_id, session.events[session.events.length - 1]);
  return step.step_order;
};

export const finishWorkflowStep = async (sessionPath, params) => {
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
  await persistWorkflowStepRemote(session.session_id, step);
  await persistWorkflowEventRemote(session.session_id, session.events[session.events.length - 1]);
  return step;
};

export const appendWorkflowEvent = async (params = {}) => {
  const explicitPath = sanitize(params.sessionPath);
  const localSessionPath = explicitPath
    ? (path.isAbsolute(explicitPath) ? explicitPath : path.resolve(ROOT, explicitPath))
    : null;
  const hasLocalSession = Boolean(localSessionPath && fs.existsSync(localSessionPath));
  const localSession = hasLocalSession ? readSession(localSessionPath) : null;

  let resolvedSessionPath = hasLocalSession ? localSessionPath : null;
  let resolvedSessionId = sanitize(params.sessionId) || sanitize(localSession?.session_id);
  let resolvedSession = localSession;
  let readState = null;

  if (!resolvedSessionId || (!resolvedSession && !resolvedSessionPath)) {
    readState = await readLatestWorkflowState({
      sessionPath: localSessionPath,
      sessionId: resolvedSessionId || undefined,
      scope: params.scope,
      workflowName: params.workflowName,
      stage: params.stage,
      runtimeLane: params.runtimeLane,
    });
    if (readState?.ok && readState.session) {
      resolvedSession = resolvedSession || readState.session;
      resolvedSessionId = resolvedSessionId || sanitize(readState.session.session_id);
      resolvedSessionPath = resolvedSessionPath || readState.sessionPath || null;
    }
  }

  if (!resolvedSessionId) {
    throw new Error('WORKFLOW_SESSION_NOT_FOUND');
  }

  const eventType = sanitize(params.eventType);
  if (!eventType) {
    throw new Error('WORKFLOW_EVENT_TYPE_REQUIRED');
  }

  const event = {
    event_type: eventType,
    from_state: sanitize(params.fromState) || null,
    to_state: sanitize(params.toState) || null,
    handoff_from: sanitize(params.handoffFrom) || null,
    handoff_to: sanitize(params.handoffTo) || null,
    decision_reason: sanitize(params.decisionReason) || null,
    evidence_id: sanitize(params.evidenceId) || null,
    payload: params.payload && typeof params.payload === 'object' ? params.payload : {},
    created_at: sanitize(params.createdAt) || nowIso(),
  };

  let localUpdated = false;
  if (resolvedSessionPath && fs.existsSync(resolvedSessionPath)) {
    const nextSession = resolvedSession && resolvedSessionPath === localSessionPath
      ? resolvedSession
      : readSession(resolvedSessionPath);
    nextSession.events.push(event);
    writeSession(resolvedSessionPath, nextSession);
    localUpdated = true;
  }

  const remote = await persistWorkflowEventRemote(resolvedSessionId, event);
  if (!localUpdated && !remote.ok) {
    throw new Error(remote.reason || 'WORKFLOW_EVENT_PERSIST_FAILED');
  }

  return {
    sessionId: resolvedSessionId,
    sessionPath: resolvedSessionPath,
    event,
    source: localUpdated
      ? (remote.ok ? 'supabase+local-mirror' : 'local-mirror')
      : (remote.ok ? 'supabase' : 'unavailable'),
    remote,
  };
};

export const loadWorkflowSession = (sessionPath) => readSession(sessionPath);

export const readLatestWorkflowState = async (params = {}) => {
  const explicitPath = sanitize(params.sessionPath);
  const localSessionPath = explicitPath
    ? (path.isAbsolute(explicitPath) ? explicitPath : path.resolve(ROOT, explicitPath))
    : listLatestLocalSessionPath();
  const explicitLocalSession = localSessionPath && fs.existsSync(localSessionPath)
    ? readSession(localSessionPath)
    : null;

  const remote = await readRemoteWorkflowState({
    sessionId: params.sessionId || explicitLocalSession?.session_id,
    scope: params.scope,
    workflowName: params.workflowName,
    stage: params.stage,
    runtimeLane: params.runtimeLane,
  });
  if (remote.ok && remote.session) {
    return remote;
  }

  if (localSessionPath && fs.existsSync(localSessionPath)) {
    return {
      ok: true,
      reason: 'loaded',
      source: 'local-file',
      sessionPath: localSessionPath,
      session: readSession(localSessionPath),
    };
  }

  return {
    ok: false,
    reason: remote.reason || 'not_found',
    source: 'unavailable',
    sessionPath: null,
    session: null,
  };
};

export const deriveResumeStateFromWorkflowSession = (session, params = {}) => {
  const status = sanitize(session?.status).toLowerCase();
  const steps = Array.isArray(session?.steps) ? session.steps : [];
  const objective = sanitize(session?.metadata?.objective) || null;
  const autoRestartOnRelease = Boolean(session?.metadata?.auto_restart_on_release || params.autoRestartOnRelease);
  const failedSteps = steps.filter(stepFailed);
  const runningSteps = steps.filter(stepRunning);
  const gcpCapacityRecoveryRequested = Boolean(params.gcpCapacityRecoveryRequested);
  const capacityTarget = Number(params.capacityTarget || 0) || null;
  const waitBoundaryAction = sanitize(params.waitBoundaryAction, DEFAULT_WAIT_FOR_NEXT_OBJECTIVE) || DEFAULT_WAIT_FOR_NEXT_OBJECTIVE;
  const safeQueue = Array.isArray(params.safeQueue) && params.safeQueue.length > 0
    ? params.safeQueue.map((item) => sanitize(item)).filter(Boolean)
    : [
      ...safeQueueDefaults(),
      ...(autoRestartOnRelease ? ['restart the next bounded automation cycle after release unless an escalation boundary appears'] : []),
    ];

  let owner = 'hermes';
  let mode = 'observing';
  let escalationStatus = 'none';

  if (status === 'failed') {
    owner = 'gpt';
    mode = 'blocked';
    escalationStatus = 'pending-gpt';
  } else if (status === 'released' && autoRestartOnRelease) {
    owner = 'hermes';
    mode = 'observing';
  } else if (status === 'released') {
    owner = 'human';
    mode = 'waiting';
  } else if (['executing', 'verifying', 'approving', 'recovering'].includes(status) || runningSteps.length > 0) {
    owner = 'hermes';
    mode = 'executing';
  }

  let nextAction = 'refresh workstream state and decide whether a new continuity cycle is needed';
  if (failedSteps.length > 0) {
    nextAction = `recover ${sanitize(failedSteps[0]?.step_name, 'failed step') || 'failed step'} and refresh workstream state`;
  } else if (runningSteps.length > 0) {
    nextAction = `continue ${sanitize(runningSteps[0]?.step_name, 'current step') || 'current step'}`;
  } else if (status === 'released') {
    nextAction = gcpCapacityRecoveryRequested && capacityTarget
      ? `resume bounded GCP capacity recovery until capacity reaches ${capacityTarget}`
      : (autoRestartOnRelease ? buildAutoRestartNextAction() : waitBoundaryAction);
  }

  const waitBoundary = sanitize(nextAction).toLowerCase() === sanitize(waitBoundaryAction).toLowerCase();
  const resumable = Boolean(objective) && escalationStatus === 'none' && (!waitBoundary || gcpCapacityRecoveryRequested);

  let reason = null;
  if (!objective) {
    reason = 'missing_workstream_objective';
  } else if (escalationStatus !== 'none') {
    reason = `escalation_${escalationStatus}`;
  } else if (status === 'released' && autoRestartOnRelease) {
    reason = 'workstream_auto_restart_ready';
  } else if (status === 'released' && gcpCapacityRecoveryRequested) {
    reason = 'operator_gcp_capacity_recovery_requested';
  } else if (waitBoundary) {
    reason = 'workstream_waiting_for_next_gpt_objective';
  }

  return {
    source: sanitize(params.source, 'workflow-session') || 'workflow-session',
    runtime_lane: sanitize(session?.metadata?.runtime_lane, sanitizeRuntimeLane(params.runtimeLane)),
    available: Boolean(objective),
    objective,
    next_action: nextAction,
    escalation_status: escalationStatus,
    owner,
    mode,
    resumable,
    reason,
    fingerprint: [
      objective || '',
      nextAction || '',
      escalationStatus || '',
      owner || '',
      mode || '',
      ...safeQueue,
    ].join('|') || null,
    capacity: {
      target: capacityTarget,
      current: null,
      gap: null,
      reached: null,
      state: status || null,
      loop_action: null,
      continue_recommended: !waitBoundary && escalationStatus === 'none',
      primary_reason: reason,
    },
    gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    auto_restart_on_release: autoRestartOnRelease,
    safe_queue: safeQueue,
    handoff_packet_path: null,
    handoff_packet_relative_path: null,
    progress_packet_path: null,
    progress_packet_relative_path: null,
    session_id: sanitize(session?.session_id) || null,
    workflow_status: status || null,
  };
};

import { spawnSync } from 'node:child_process';

import { BackgroundLoop } from '../../utils/backgroundLoop';
import {
  buildDoctorReport,
  buildManagedServicePlan,
  runUp,
} from '../../../scripts/local-ai-stack-control.mjs';
import { syncOpenJarvisContinuityPackets } from '../../../scripts/sync-openjarvis-continuity-packets.ts';
import { getOpenJarvisAutopilotStatus } from '../openjarvis/openjarvisAutopilotStatusService';
import { runOpenJarvisHermesRuntimeRemediation } from '../openjarvis/openjarvisHermesRuntimeControlService';
import { recordWorkflowCapabilityDemands } from '../workflow/workflowPersistenceService';

const LOCAL_AUTONOMY_PROFILE = 'local-nemoclaw-max-delegation';
const LOCAL_AUTONOMY_RUNTIME_LANE = 'operator-personal';
const LOCAL_AUTONOMY_SUPERVISOR_INTERVAL_MS = 5 * 60 * 1000;

type QueueLaunchMode = 'manual' | 'chat' | 'swarm';

const LOCAL_AUTONOMY_DEFAULT_QUEUE_LAUNCH_MODE: QueueLaunchMode = 'chat';

type ManagedPlan = ReturnType<typeof buildManagedServicePlan>;

type LocalAutonomySupervisorState = {
  enabled: boolean;
  plan: ManagedPlan;
  lastDoctorOk: boolean | null;
  lastDoctorFailures: string[];
  lastDoctorNextSteps: string[];
  lastUpOk: boolean | null;
  lastUpAt: string | null;
  lastHermesReadiness: string | null;
  lastQueuedObjectivesAvailable: boolean | null;
  lastSupervisorAlive: boolean | null;
  lastSupervisorAutoLaunchQueuedChat: boolean | null;
  lastSupervisorAutoLaunchQueuedSwarm: boolean | null;
  lastSupervisorQueueLaunchMode: QueueLaunchMode | null;
  lastAwaitingReentryAcknowledgment: boolean | null;
  lastAwaitingReentryAcknowledgmentStale: boolean | null;
  lastAwaitingReentrySyncKey: string | null;
  lastStaleReentryPromotionKey: string | null;
  lastSupervisorAction: string | null;
  lastSupervisorQueuedAt: string | null;
  lastSupervisorPid: number | null;
};

const createEmptyState = (): LocalAutonomySupervisorState => ({
  enabled: false,
  plan: buildManagedServicePlan({}),
  lastDoctorOk: null,
  lastDoctorFailures: [],
  lastDoctorNextSteps: [],
  lastUpOk: null,
  lastUpAt: null,
  lastHermesReadiness: null,
  lastQueuedObjectivesAvailable: null,
  lastSupervisorAlive: null,
  lastSupervisorAutoLaunchQueuedChat: null,
  lastSupervisorAutoLaunchQueuedSwarm: null,
  lastSupervisorQueueLaunchMode: null,
  lastAwaitingReentryAcknowledgment: null,
  lastAwaitingReentryAcknowledgmentStale: null,
  lastAwaitingReentrySyncKey: null,
  lastStaleReentryPromotionKey: null,
  lastSupervisorAction: null,
  lastSupervisorQueuedAt: null,
  lastSupervisorPid: null,
});

const buildStaleReentryPromotionKey = (params: {
  sessionId: unknown;
  startedAt: unknown;
}): string | null => {
  const sessionId = String(params.sessionId || '').trim();
  const startedAt = String(params.startedAt || '').trim();
  if (!sessionId || !startedAt) {
    return null;
  }
  return `${sessionId}:${startedAt}`;
};

const buildAwaitingReentrySyncKey = (params: {
  sessionId: unknown;
  sessionPath: unknown;
  startedAt: unknown;
}): string | null => {
  const sessionId = String(params.sessionId || '').trim();
  const sessionPath = String(params.sessionPath || '').trim();
  const startedAt = String(params.startedAt || '').trim() || 'awaiting';
  const sessionRef = sessionId || sessionPath;
  if (!sessionRef) {
    return null;
  }
  return `${sessionRef}:${startedAt}`;
};

const hasRecordedStaleReentryDemand = (autopilot: Awaited<ReturnType<typeof getOpenJarvisAutopilotStatus>>, recallCondition: string | null): boolean => {
  const demands = Array.isArray(autopilot.workflow?.lastCapabilityDemands)
    ? autopilot.workflow.lastCapabilityDemands
    : [];
  return demands.some((entry) => entry?.missingCapability === 'stale_reentry_acknowledgment'
    && (!recallCondition || entry?.recallCondition === recallCondition));
};

const state = createEmptyState();

const hasManagedLocalSurface = (plan: ManagedPlan): boolean => Boolean(
  plan.litellm
  || plan.n8n
  || plan.openjarvis
  || plan.opencodeWorker,
);

const resolveManagedPlan = (): ManagedPlan => buildManagedServicePlan(process.env);

const isProcessAlive = (pid: unknown): boolean => {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }

  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
};

const resolveObservedQueueLaunchMode = (supervisor: Record<string, unknown> | null | undefined): QueueLaunchMode => {
  if (supervisor?.auto_launch_queued_swarm === true) {
    return 'swarm';
  }
  if (supervisor?.auto_launch_queued_chat === true) {
    return 'chat';
  }
  return 'manual';
};

const resolveDesiredQueueLaunchMode = (observedMode: QueueLaunchMode): QueueLaunchMode => (
  observedMode === 'swarm'
    ? 'swarm'
    : LOCAL_AUTONOMY_DEFAULT_QUEUE_LAUNCH_MODE
);

const formatQueueLaunchModeSummary = (mode: QueueLaunchMode | null): string => {
  if (mode === 'swarm') {
    return 'swarm';
  }
  if (mode === 'chat') {
    return 'chat';
  }
  return 'manual';
};

const formatSupervisorActionMode = (mode: QueueLaunchMode): string => {
  if (mode === 'swarm') {
    return 'swarm';
  }
  if (mode === 'chat') {
    return 'auto-chat';
  }
  return 'manual-chat';
};

const stopRunningProcess = (pid: unknown): boolean => {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0 || !isProcessAlive(numericPid)) {
    return false;
  }

  if (process.platform === 'win32') {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'taskkill', '/PID', String(numericPid), '/T', '/F'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      env: process.env,
    });
    return result.status === 0;
  }

  try {
    process.kill(numericPid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
};

export const runLocalAutonomySupervisorCycle = async (): Promise<string> => {
  const plan = resolveManagedPlan();
  state.plan = plan;
  state.enabled = hasManagedLocalSurface(plan);

  if (!state.enabled) {
    state.lastSupervisorAction = 'skipped:no-local-managed-surfaces';
    return 'local autonomy supervisor skipped: no local managed surfaces configured';
  }

  let doctor = await buildDoctorReport({ profile: LOCAL_AUTONOMY_PROFILE });
  state.lastDoctorOk = doctor.ok;
  state.lastDoctorFailures = [...doctor.failures];
  state.lastDoctorNextSteps = [...doctor.nextSteps];

  const actions: string[] = [];

  if (!doctor.ok) {
    const up = await runUp({
      profile: LOCAL_AUTONOMY_PROFILE,
      applyProfileFirst: false,
      dryRun: false,
    });
    state.lastUpOk = up.ok;
    state.lastUpAt = up.checkedAt;
    doctor = up.doctor || await buildDoctorReport({ profile: LOCAL_AUTONOMY_PROFILE });
    state.lastDoctorOk = doctor.ok;
    state.lastDoctorFailures = [...doctor.failures];
    state.lastDoctorNextSteps = [...doctor.nextSteps];
    actions.push(up.ok ? 'stack-heal:ok' : 'stack-heal:failed');
  }

  if (!doctor.ok) {
    state.lastSupervisorAction = actions[0] || 'stack-heal:failed';
    return `doctor=false failures=${doctor.failures.length} action=${state.lastSupervisorAction}`;
  }

  const runtimeLane = String(doctor.workflowState?.runtimeLane || LOCAL_AUTONOMY_RUNTIME_LANE).trim()
    || LOCAL_AUTONOMY_RUNTIME_LANE;
  const autopilot = await getOpenJarvisAutopilotStatus({ runtimeLane });
  const queuedObjectivesAvailable = autopilot.hermes_runtime.queued_objectives_available === true;
  const supervisorAlive = autopilot.hermes_runtime.supervisor_alive === true;
  const supervisorPid = Number(autopilot.supervisor?.supervisor_pid);
  const workflowStatus = String(autopilot.workflow?.status || '').trim().toLowerCase();
  const observedQueueLaunchMode = resolveObservedQueueLaunchMode(autopilot.supervisor as Record<string, unknown> | null);
  const desiredQueueLaunchMode = resolveDesiredQueueLaunchMode(observedQueueLaunchMode);
  const awaitingReentryAcknowledgment = autopilot.supervisor?.awaiting_reentry_acknowledgment === true;
  const awaitingReentryAcknowledgmentStale = autopilot.hermes_runtime.awaiting_reentry_acknowledgment_stale === true
    || autopilot.supervisor?.awaiting_reentry_acknowledgment_stale === true;
  state.lastHermesReadiness = autopilot.hermes_runtime.readiness || null;
  state.lastQueuedObjectivesAvailable = queuedObjectivesAvailable;
  state.lastSupervisorAlive = supervisorAlive;
  state.lastSupervisorAutoLaunchQueuedChat = observedQueueLaunchMode === 'chat';
  state.lastSupervisorAutoLaunchQueuedSwarm = observedQueueLaunchMode === 'swarm';
  state.lastSupervisorQueueLaunchMode = observedQueueLaunchMode;
  state.lastAwaitingReentryAcknowledgment = awaitingReentryAcknowledgment;
  state.lastAwaitingReentryAcknowledgmentStale = awaitingReentryAcknowledgmentStale;
  state.lastSupervisorPid = Number.isInteger(supervisorPid) && supervisorPid > 0 ? supervisorPid : null;

  if (!awaitingReentryAcknowledgment) {
    state.lastAwaitingReentrySyncKey = null;
  }

  if (!awaitingReentryAcknowledgmentStale) {
    state.lastStaleReentryPromotionKey = null;
  }

  if (awaitingReentryAcknowledgment) {
    const startedAt = autopilot.supervisor?.awaiting_reentry_acknowledgment_started_at || null;
    const sessionId = autopilot.workflow?.session_id || null;
    const sessionPath = autopilot.workflow?.session_path || null;
    const awaitingSyncKey = buildAwaitingReentrySyncKey({ sessionId, sessionPath, startedAt });

    if (!awaitingReentryAcknowledgmentStale && awaitingSyncKey && state.lastAwaitingReentrySyncKey !== awaitingSyncKey) {
      try {
        await syncOpenJarvisContinuityPackets({
          sessionPath: sessionPath || undefined,
          sessionId: sessionId || undefined,
          runtimeLane,
          reason: 'local-autonomy-awaiting-reentry-ack',
        });
        actions.push('awaiting-packet:refreshed');
      } catch (error) {
        actions.push(`awaiting-packet:error:${error instanceof Error ? error.message : String(error)}`);
      }
      state.lastAwaitingReentrySyncKey = awaitingSyncKey;
    }

    if (awaitingReentryAcknowledgmentStale) {
      const promotionKey = buildStaleReentryPromotionKey({ sessionId, startedAt });
      const recallCondition = startedAt ? `awaiting-reentry-ack:${startedAt}` : 'awaiting-reentry-ack';

      if (promotionKey && state.lastStaleReentryPromotionKey !== promotionKey) {
        const promotionActions: string[] = [];
        const alreadyRecorded = hasRecordedStaleReentryDemand(autopilot, recallCondition);

        if (!alreadyRecorded && sessionId) {
          const result = await recordWorkflowCapabilityDemands({
            sessionId,
            runtimeLane,
            sourceEvent: 'local_autonomy_stale_reentry_ack',
            tags: ['hermes', 'reentry-ack', 'stale', 'local-autonomy'],
            payload: {
              objective: autopilot.workflow?.objective || null,
              session_path: sessionPath,
              runtime_lane: runtimeLane,
              source: 'local-autonomy-supervisor',
            },
            demands: [{
              summary: 'Queued GPT handoff has been waiting more than 15 minutes for reentry acknowledgment and is blocking the next autonomous cycle.',
              objective: autopilot.workflow?.objective || undefined,
              missingCapability: 'stale_reentry_acknowledgment',
              missingSource: startedAt ? `waiting-since:${startedAt}` : 'queued_gpt_handoff_launched',
              failedOrInsufficientRoute: 'queued_gpt_handoff_launched -> reentry_acknowledged',
              cheapestEnablementPath: 'inspect the pending queued VS Code GPT handoff and run openjarvis:hermes:runtime:reentry-ack before allowing the next autonomous cycle',
              proposedOwner: 'hermes',
              evidenceRefs: ['plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
              recallCondition,
              runtimeLane,
              sourceEvent: 'local_autonomy_stale_reentry_ack',
              tags: ['hermes', 'reentry-ack', 'stale', 'local-autonomy'],
            }],
          });
          promotionActions.push(result.ok ? 'stale-demand:recorded' : `stale-demand:error:${result.error || 'unknown'}`);
        } else if (alreadyRecorded) {
          promotionActions.push('stale-demand:already-recorded');
        }

        try {
          await syncOpenJarvisContinuityPackets({
            sessionPath: sessionPath || undefined,
            sessionId: sessionId || undefined,
            runtimeLane,
            reason: 'local-autonomy-stale-reentry-ack',
          });
          promotionActions.push('stale-packet:refreshed');
        } catch (error) {
          promotionActions.push(`stale-packet:error:${error instanceof Error ? error.message : String(error)}`);
        }

        state.lastStaleReentryPromotionKey = promotionKey;
        actions.push(...promotionActions);
      }
    }

    state.lastSupervisorAction = awaitingReentryAcknowledgmentStale
      ? 'supervisor:awaiting-reentry-ack:stale'
      : 'supervisor:awaiting-reentry-ack';
    actions.push(state.lastSupervisorAction);
    return `doctor=true failures=0 hermes=${state.lastHermesReadiness || 'unknown'} queue=${queuedObjectivesAvailable ? 'ready' : 'empty'} mode=${formatQueueLaunchModeSummary(state.lastSupervisorQueueLaunchMode)} reentry=${awaitingReentryAcknowledgmentStale ? 'stale-ack' : 'awaiting-ack'} ${actions.join(' ')}`.trim();
  }

  const needsSupervisorModeUpgrade = supervisorAlive
    && observedQueueLaunchMode !== desiredQueueLaunchMode
    && workflowStatus !== 'executing';

  if (!supervisorAlive || needsSupervisorModeUpgrade) {
    const canStartSupervisor = !supervisorAlive
      ? autopilot.hermes_runtime.remediation_actions
        .some((action) => action.action_id === 'start-supervisor-loop')
      : true;
    if (needsSupervisorModeUpgrade) {
      const stopped = stopRunningProcess(supervisorPid);
      if (!stopped) {
        state.lastSupervisorAction = `supervisor:upgrade-failed:${formatSupervisorActionMode(observedQueueLaunchMode)}`;
        actions.push(state.lastSupervisorAction);
        return `doctor=true failures=0 hermes=${state.lastHermesReadiness || 'unknown'} queue=${queuedObjectivesAvailable ? 'ready' : 'empty'} mode=${formatQueueLaunchModeSummary(state.lastSupervisorQueueLaunchMode)} ${actions.join(' ')}`.trim();
      }
      actions.push(`supervisor:${formatSupervisorActionMode(observedQueueLaunchMode)}-stopped`);
    }

    if (canStartSupervisor) {
      const remediation = await runOpenJarvisHermesRuntimeRemediation({
        runtimeLane,
        actionId: 'start-supervisor-loop',
        dryRun: false,
        visibleTerminal: false,
        autoLaunchQueuedChat: desiredQueueLaunchMode === 'chat',
        autoLaunchQueuedSwarm: desiredQueueLaunchMode === 'swarm',
        autoLaunchQueuedSwarmIncludeDistiller: autopilot.supervisor?.auto_launch_queued_swarm_include_distiller === true,
        autoLaunchQueuedSwarmExecutorWorktreePath: typeof autopilot.supervisor?.auto_launch_queued_swarm_executor_worktree_path === 'string'
          ? autopilot.supervisor.auto_launch_queued_swarm_executor_worktree_path
          : null,
        autoLaunchQueuedSwarmExecutorArtifactBudget: Array.isArray(autopilot.supervisor?.auto_launch_queued_swarm_executor_artifact_budget)
          ? autopilot.supervisor.auto_launch_queued_swarm_executor_artifact_budget.map((entry) => String(entry || '').trim()).filter(Boolean)
          : [],
      });
      if (remediation.ok) {
        state.lastSupervisorAutoLaunchQueuedChat = desiredQueueLaunchMode === 'chat';
        state.lastSupervisorAutoLaunchQueuedSwarm = desiredQueueLaunchMode === 'swarm';
        state.lastSupervisorQueueLaunchMode = desiredQueueLaunchMode;
      }
      state.lastSupervisorAction = remediation.ok
        ? `supervisor:${needsSupervisorModeUpgrade ? 'upgraded' : remediation.completion}:${formatSupervisorActionMode(desiredQueueLaunchMode)}`
        : `supervisor:error:${remediation.errorCode || 'unknown'}`;
      state.lastSupervisorQueuedAt = remediation.startedAt;
      state.lastSupervisorPid = remediation.pid;
      actions.push(state.lastSupervisorAction);
    } else {
      state.lastSupervisorAction = 'supervisor:remediation-unavailable';
      actions.push(state.lastSupervisorAction);
    }
  } else {
    state.lastSupervisorAction = `supervisor:alive:${formatSupervisorActionMode(observedQueueLaunchMode)}`;
    actions.push(state.lastSupervisorAction);
  }

  return `doctor=true failures=0 hermes=${state.lastHermesReadiness || 'unknown'} queue=${queuedObjectivesAvailable ? 'ready' : 'empty'} mode=${formatQueueLaunchModeSummary(state.lastSupervisorQueueLaunchMode)} ${actions.join(' ')}`.trim();
};

const loop = new BackgroundLoop(runLocalAutonomySupervisorCycle, {
  name: '[LOCAL-AUTONOMY-SUPERVISOR]',
  intervalMs: LOCAL_AUTONOMY_SUPERVISOR_INTERVAL_MS,
  runOnStart: true,
});

export const startLocalAutonomySupervisorLoop = (): void => {
  const plan = resolveManagedPlan();
  state.plan = plan;
  state.enabled = hasManagedLocalSurface(plan);
  if (!state.enabled) {
    return;
  }
  loop.start();
};

export const stopLocalAutonomySupervisorLoop = (): void => {
  loop.stop();
};

export const getLocalAutonomySupervisorLoopStats = () => ({
  ...loop.getStats(),
  enabled: state.enabled,
  profile: LOCAL_AUTONOMY_PROFILE,
  plan: state.plan,
  lastDoctorOk: state.lastDoctorOk,
  lastDoctorFailures: state.lastDoctorFailures,
  lastDoctorNextSteps: state.lastDoctorNextSteps,
  lastUpOk: state.lastUpOk,
  lastUpAt: state.lastUpAt,
  lastHermesReadiness: state.lastHermesReadiness,
  lastQueuedObjectivesAvailable: state.lastQueuedObjectivesAvailable,
  lastSupervisorAlive: state.lastSupervisorAlive,
  lastSupervisorAutoLaunchQueuedChat: state.lastSupervisorAutoLaunchQueuedChat,
  lastSupervisorAutoLaunchQueuedSwarm: state.lastSupervisorAutoLaunchQueuedSwarm,
  lastSupervisorQueueLaunchMode: state.lastSupervisorQueueLaunchMode,
  lastAwaitingReentryAcknowledgment: state.lastAwaitingReentryAcknowledgment,
  lastAwaitingReentryAcknowledgmentStale: state.lastAwaitingReentryAcknowledgmentStale,
  lastAwaitingReentrySyncKey: state.lastAwaitingReentrySyncKey,
  lastStaleReentryPromotionKey: state.lastStaleReentryPromotionKey,
  lastSupervisorAction: state.lastSupervisorAction,
  lastSupervisorQueuedAt: state.lastSupervisorQueuedAt,
  lastSupervisorPid: state.lastSupervisorPid,
});

export const resetLocalAutonomySupervisorLoopState = (): void => {
  loop.stop();
  Object.assign(state, createEmptyState());
};
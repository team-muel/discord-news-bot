import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import { appendWorkflowEvent, readLatestWorkflowState } from './openjarvis-workflow-state.mjs';

export type ReentryCompletionStatus = 'completed' | 'blocked' | 'failed';
export type ReentryRestartMode = 'auto' | 'always' | 'never';

type JsonRecord = Record<string, unknown>;

type ReentryAckParams = {
  summary?: string | null;
  nextAction?: string | null;
  blockedAction?: string | null;
  completionStatus?: string | null;
  sessionPath?: string | null;
  sessionId?: string | null;
  runtimeLane?: string | null;
  restartSupervisor?: string | null;
  restartVisibleTerminal?: boolean;
  dryRun?: boolean;
  loopPath?: string | null;
  manifestPath?: string | null;
};

type ReentryRestartResult = {
  requested: boolean;
  mode: ReentryRestartMode;
  started: boolean;
  pid: number | null;
  dryRun: boolean;
  command: string | null;
  reason: string | null;
};

export type ReentryAckResult = {
  ok: boolean;
  completion: 'recorded' | 'skipped';
  completionStatus: ReentryCompletionStatus;
  objective: string | null;
  sessionId: string | null;
  sessionPath: string | null;
  runtimeLane: string | null;
  summary: string | null;
  nextAction: string | null;
  blockedAction: string | null;
  recordedEventTypes: string[];
  loopPath: string | null;
  manifestPath: string | null;
  restartSupervisor: ReentryRestartResult;
  error: string | null;
};

type WorkflowStateReadResult = Awaited<ReturnType<typeof readLatestWorkflowState>>;
type WorkflowAppendResult = Awaited<ReturnType<typeof appendWorkflowEvent>>;

type ReentryAckDependencies = {
  readLatestWorkflowState: (params?: Record<string, unknown>) => Promise<WorkflowStateReadResult>;
  appendWorkflowEvent: (params?: Record<string, unknown>) => Promise<WorkflowAppendResult>;
  spawnGoalCycle: (args: string[]) => Promise<{ started: boolean; pid: number | null; command: string }>;
};

const ROOT = process.cwd();
const LAUNCHES_DIR = path.join(ROOT, 'tmp', 'autonomy', 'launches');
const DEFAULT_LOOP_PATH = path.join(LAUNCHES_DIR, 'latest-interactive-goal-loop.json');
const DEFAULT_MANIFEST_PATH = path.join(LAUNCHES_DIR, 'latest-interactive-goal.json');
const GOAL_CYCLE_SCRIPT = path.join('scripts', 'run-openjarvis-goal-cycle.mjs');

const compact = (value: unknown): string => String(value || '').trim();
const toNullableString = (value: unknown): string | null => compact(value) || null;

const toRelative = (filePath: string | null): string | null => {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
};

const resolveRootPath = (value: string | null | undefined): string | null => {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(ROOT, normalized);
};

const readJsonFile = <T = JsonRecord>(filePath: string | null): T | null => {
  if (!filePath) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const writeJsonFile = (filePath: string | null, value: unknown): void => {
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = compact(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const toNumberOrNull = (value: unknown): number | null => {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const normalizeReentryCompletionStatus = (value: unknown): ReentryCompletionStatus => {
  const normalized = compact(value).toLowerCase();
  if (normalized === 'blocked') {
    return 'blocked';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  return 'completed';
};

export const normalizeReentryRestartMode = (value: unknown): ReentryRestartMode => {
  const normalized = compact(value).toLowerCase();
  if (normalized === 'always') {
    return 'always';
  }
  if (normalized === 'never' || normalized === 'false' || normalized === 'off') {
    return 'never';
  }
  return 'auto';
};

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

export const buildGoalCycleRestartArgs = (params: {
  sessionPath?: string | null;
  runtimeLane?: string | null;
  routeMode?: string | null;
  capacityTarget?: number | null;
  gcpCapacityRecoveryRequested?: boolean;
  autoRestartOnRelease?: boolean;
  continueUntilCapacity?: boolean;
  restartVisibleTerminal?: boolean;
}): string[] => {
  const args = [
    GOAL_CYCLE_SCRIPT,
    '--resumeFromPackets=true',
    '--continuousLoop=true',
    '--autoSelectQueuedObjective=true',
    '--autoLaunchQueuedChat=true',
    '--maxCycles=0',
    '--maxIdleChecks=0',
    `--visibleTerminal=${params.restartVisibleTerminal === true ? 'true' : 'false'}`,
  ];

  const sessionPath = resolveRootPath(params.sessionPath || null);
  if (sessionPath) {
    args.push(`--sessionPath=${sessionPath}`);
  }

  const runtimeLane = compact(params.runtimeLane);
  if (runtimeLane) {
    args.push(`--runtimeLane=${runtimeLane}`);
  }

  const routeMode = compact(params.routeMode);
  if (routeMode) {
    args.push(`--routeMode=${routeMode}`);
  }

  const capacityTarget = toNumberOrNull(params.capacityTarget);
  if (capacityTarget !== null) {
    args.push(`--capacityTarget=${capacityTarget}`);
  }

  if (params.gcpCapacityRecoveryRequested === true) {
    args.push('--gcpCapacityRecovery=true');
  }

  if (params.autoRestartOnRelease === true) {
    args.push('--autoRestartOnRelease=true');
  }

  if (params.continueUntilCapacity === true) {
    args.push('--continueUntilCapacity=true');
  }

  return args;
};

export const shouldRestartGoalCycleAfterReentry = (params: {
  completionStatus: ReentryCompletionStatus;
  restartMode: ReentryRestartMode;
  loopState: JsonRecord | null;
  manifest: JsonRecord | null;
}): { requested: boolean; reason: string | null } => {
  if (params.restartMode === 'never') {
    return { requested: false, reason: 'restart_disabled' };
  }

  const supervisorAlive = isProcessAlive(params.loopState?.supervisor_pid);
  if (supervisorAlive) {
    return { requested: false, reason: 'supervisor_already_running' };
  }

  if (params.restartMode === 'always') {
    return { requested: true, reason: 'forced_restart' };
  }

  if (params.completionStatus !== 'completed') {
    return { requested: false, reason: 'completion_not_restartable' };
  }

  const autoLaunchQueuedChat = toBoolean(params.loopState?.auto_launch_queued_chat, toBoolean(params.manifest?.auto_launch_queued_chat));
  const autoSelectQueuedObjective = toBoolean(params.loopState?.auto_select_queued_objective, toBoolean(params.manifest?.auto_select_queued_objective));
  const queuedStopReason = compact(params.loopState?.stop_reason || params.loopState?.last_reason).toLowerCase();
  const waitingForAck = toBoolean(params.loopState?.awaiting_reentry_acknowledgment, false)
    || toBoolean(params.manifest?.awaiting_reentry_acknowledgment, false)
    || queuedStopReason === 'queued_chat_launched'
    || queuedStopReason === 'queued-chat-launched';

  if (!autoLaunchQueuedChat || !autoSelectQueuedObjective) {
    return { requested: false, reason: 'queue_chat_restart_not_enabled' };
  }

  if (!waitingForAck) {
    return { requested: false, reason: 'no_pending_reentry_ack' };
  }

  return { requested: true, reason: 'completed_reentry_acknowledged' };
};

const defaultSpawnGoalCycle = async (args: string[]): Promise<{ started: boolean; pid: number | null; command: string }> => {
  const command = ['node', ...args].join(' ');
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'node', ...args], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    : spawn('node', args, {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({
        started: true,
        pid: child.pid ?? null,
        command,
      });
    });
  });
};

const defaultDependencies: ReentryAckDependencies = {
  readLatestWorkflowState,
  appendWorkflowEvent,
  spawnGoalCycle: defaultSpawnGoalCycle,
};

const resolveContext = async (params: ReentryAckParams, deps: ReentryAckDependencies) => {
  const loopPath = resolveRootPath(params.loopPath || DEFAULT_LOOP_PATH);
  const manifestPath = resolveRootPath(params.manifestPath || DEFAULT_MANIFEST_PATH);
  const loopState = readJsonFile<JsonRecord>(loopPath);
  const manifest = readJsonFile<JsonRecord>(manifestPath);
  const lastLaunch = isRecord(loopState?.last_launch) ? loopState.last_launch : {};

  const sessionPath = resolveRootPath(params.sessionPath)
    || resolveRootPath(toNullableString(lastLaunch.session_path))
    || resolveRootPath(toNullableString(manifest?.session_path));
  const sessionId = toNullableString(params.sessionId)
    || toNullableString(lastLaunch.session_id)
    || toNullableString(manifest?.session_id);
  const runtimeLane = toNullableString(params.runtimeLane)
    || toNullableString(lastLaunch.runtime_lane)
    || toNullableString(loopState?.runtime_lane)
    || toNullableString(manifest?.runtime_lane);

  const workflowState = await deps.readLatestWorkflowState({
    sessionPath,
    sessionId: sessionId || undefined,
    runtimeLane: runtimeLane || undefined,
  });

  const resolvedSession = workflowState?.ok ? workflowState.session : null;

  return {
    loopPath,
    loopState,
    manifestPath,
    manifest,
    lastLaunch,
    sessionPath: sessionPath || workflowState?.sessionPath || null,
    sessionId: sessionId || toNullableString(resolvedSession?.session_id),
    runtimeLane: runtimeLane
      || toNullableString(resolvedSession?.metadata?.runtime_lane)
      || null,
    objective: toNullableString(lastLaunch.objective)
      || toNullableString(manifest?.objective)
      || toNullableString(resolvedSession?.metadata?.objective),
    routeMode: toNullableString(loopState?.route_mode)
      || toNullableString(manifest?.route_mode)
      || toNullableString(resolvedSession?.metadata?.route_mode),
    capacityTarget: toNumberOrNull(manifest?.capacity_target),
    gcpCapacityRecoveryRequested: toBoolean(manifest?.gcp_capacity_recovery_requested, false),
    autoRestartOnRelease: toBoolean(manifest?.auto_restart_on_release, false),
    continueUntilCapacity: toBoolean(manifest?.continue_until_capacity, false),
  };
};

export const acknowledgeOpenJarvisReentry = async (
  params: ReentryAckParams = {},
  deps: ReentryAckDependencies = defaultDependencies,
): Promise<ReentryAckResult> => {
  const completionStatus = normalizeReentryCompletionStatus(params.completionStatus);
  const restartMode = normalizeReentryRestartMode(params.restartSupervisor);
  const summary = toNullableString(params.summary);
  const nextAction = toNullableString(params.nextAction);
  const blockedAction = toNullableString(params.blockedAction);
  const dryRun = params.dryRun === true;

  const context = await resolveContext(params, deps);
  if (!context.sessionId) {
    return {
      ok: false,
      completion: 'skipped',
      completionStatus,
      objective: context.objective,
      sessionId: null,
      sessionPath: context.sessionPath ? toRelative(context.sessionPath) : null,
      runtimeLane: context.runtimeLane,
      summary,
      nextAction,
      blockedAction,
      recordedEventTypes: [],
      loopPath: toRelative(context.loopPath),
      manifestPath: toRelative(context.manifestPath),
      restartSupervisor: {
        requested: false,
        mode: restartMode,
        started: false,
        pid: null,
        dryRun,
        command: null,
        reason: 'workflow_session_not_found',
      },
      error: 'workflow session could not be resolved for reentry acknowledgment',
    };
  }

  const ackDecisionReason = summary || `${completionStatus} VS Code GPT reentry acknowledged`;
  const recordedEventTypes: string[] = [];

  const baseEventParams = {
    sessionPath: context.sessionPath,
    sessionId: context.sessionId,
    runtimeLane: context.runtimeLane,
  };

  await deps.appendWorkflowEvent({
    ...baseEventParams,
    eventType: 'reentry_acknowledged',
    decisionReason: ackDecisionReason,
    payload: {
      objective: context.objective,
      completion_status: completionStatus,
      summary,
      next_action: nextAction,
      blocked_action: blockedAction,
      runtime_lane: context.runtimeLane,
      source: 'vscode-chat',
      manifest_path: toRelative(context.manifestPath),
      loop_path: toRelative(context.loopPath),
    },
  });
  recordedEventTypes.push('reentry_acknowledged');

  if (summary || nextAction) {
    await deps.appendWorkflowEvent({
      ...baseEventParams,
      eventType: 'decision_distillate',
      decisionReason: ackDecisionReason,
      payload: {
        next_action: nextAction,
        runtime_lane: context.runtimeLane,
        source_event: 'reentry_acknowledged',
        promote_as: 'development_slice',
        tags: ['hermes', 'reentry', 'vscode-chat', completionStatus],
      },
    });
    recordedEventTypes.push('decision_distillate');
  }

  if (completionStatus !== 'completed') {
    await deps.appendWorkflowEvent({
      ...baseEventParams,
      eventType: 'recall_request',
      decisionReason: ackDecisionReason,
      payload: {
        blocked_action: blockedAction || (completionStatus === 'failed' ? 'recover failed GPT closeout' : 'approval_or_policy_boundary'),
        next_action: nextAction,
        requested_by: 'vscode-chat-reentry',
        runtime_lane: context.runtimeLane,
        failed_step_names: [],
      },
    });
    recordedEventTypes.push('recall_request');
  }

  const restartDecision = shouldRestartGoalCycleAfterReentry({
    completionStatus,
    restartMode,
    loopState: context.loopState,
    manifest: context.manifest,
  });

  const restartArgs = restartDecision.requested
    ? buildGoalCycleRestartArgs({
      sessionPath: context.sessionPath,
      runtimeLane: context.runtimeLane,
      routeMode: context.routeMode,
      capacityTarget: context.capacityTarget,
      gcpCapacityRecoveryRequested: context.gcpCapacityRecoveryRequested,
      autoRestartOnRelease: context.autoRestartOnRelease,
      continueUntilCapacity: context.continueUntilCapacity,
      restartVisibleTerminal: params.restartVisibleTerminal === true,
    })
    : null;
  const restartCommand = restartArgs ? ['node', ...restartArgs].join(' ') : null;

  let restartSupervisor: ReentryRestartResult = {
    requested: restartDecision.requested,
    mode: restartMode,
    started: false,
    pid: null,
    dryRun,
    command: restartCommand,
    reason: restartDecision.reason,
  };

  if (restartDecision.requested && restartArgs && !dryRun) {
    const started = await deps.spawnGoalCycle(restartArgs);
    restartSupervisor = {
      ...restartSupervisor,
      started: started.started,
      pid: started.pid,
      command: started.command,
    };
  }

  const acknowledgedAt = new Date().toISOString();
  const reentryAck = {
    acknowledged_at: acknowledgedAt,
    completion_status: completionStatus,
    objective: context.objective,
    summary,
    next_action: nextAction,
    blocked_action: blockedAction,
    runtime_lane: context.runtimeLane,
    source: 'vscode-chat',
    recorded_event_types: recordedEventTypes,
    restart_supervisor: restartSupervisor,
  };

  if (context.loopState) {
    const nextLoopState = {
      ...context.loopState,
      awaiting_reentry_acknowledgment: false,
      reentry_acknowledgment: reentryAck,
      last_reason: completionStatus === 'completed' ? 'reentry_acknowledged' : 'reentry_recalled',
      last_launch: isRecord(context.loopState.last_launch)
        ? {
          ...context.loopState.last_launch,
          awaiting_reentry_acknowledgment: false,
          reentry_acknowledgment: reentryAck,
        }
        : context.loopState.last_launch,
    };
    writeJsonFile(context.loopPath, nextLoopState);
  }

  if (context.manifest) {
    const nextManifest = {
      ...context.manifest,
      awaiting_reentry_acknowledgment: false,
      reentry_acknowledgment: reentryAck,
    };
    writeJsonFile(context.manifestPath, nextManifest);
  }

  return {
    ok: true,
    completion: 'recorded',
    completionStatus,
    objective: context.objective,
    sessionId: context.sessionId,
    sessionPath: toRelative(context.sessionPath),
    runtimeLane: context.runtimeLane,
    summary,
    nextAction,
    blockedAction,
    recordedEventTypes,
    loopPath: toRelative(context.loopPath),
    manifestPath: toRelative(context.manifestPath),
    restartSupervisor,
    error: null,
  };
};

async function main() {
  const result = await acknowledgeOpenJarvisReentry({
    summary: toNullableString(parseArg('summary', '')),
    nextAction: toNullableString(parseArg('nextAction', '')),
    blockedAction: toNullableString(parseArg('blockedAction', '')),
    completionStatus: toNullableString(parseArg('completionStatus', 'completed')),
    sessionPath: toNullableString(parseArg('sessionPath', '')),
    sessionId: toNullableString(parseArg('sessionId', '')),
    runtimeLane: toNullableString(parseArg('runtimeLane', '')),
    restartSupervisor: toNullableString(parseArg('restartSupervisor', 'auto')),
    restartVisibleTerminal: parseBool(parseArg('restartVisibleTerminal', 'false'), false),
    dryRun: parseBool(parseArg('dryRun', 'false'), false),
    loopPath: toNullableString(parseArg('loopPath', '')),
    manifestPath: toNullableString(parseArg('manifestPath', '')),
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
})();

import { fileURLToPath } from 'node:url';

if (isMain) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
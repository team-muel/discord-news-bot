import 'dotenv/config';
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import { readLatestWorkflowState } from './openjarvis-workflow-state.mjs';
import {
  DEFAULT_CAPACITY_TARGET,
  WAIT_FOR_NEXT_GPT_ACTION,
  buildAutopilotCapacity,
  buildAutopilotCapacitySectionLines,
  buildGcpNativeAutopilotContext,
  normalizeCapacityTarget,
} from './lib/openjarvisAutopilotCapacity.mjs';
import {
  previewApiFirstAgentFallbackRoute,
  type AutomationRoutePreview,
  type AutomationRoutePreviewInput,
} from '../src/services/automation/apiFirstAgentFallbackService.ts';
import { buildObsidianFrontmatter, hasObsidianFrontmatter } from '../src/services/obsidian/obsidianDocBuilder.ts';
import { getObsidianVaultHealthStatus, writeObsidianNoteWithAdapter } from '../src/services/obsidian/router.ts';
import type { ObsidianFrontmatterValue } from '../src/services/obsidian/types.ts';
import { getObsidianVaultRoot } from '../src/utils/obsidianEnv.ts';

type ContinuityObsidianHealth = ReturnType<typeof getObsidianVaultHealthStatus> & {
  warnings: string[];
};

type WorkflowStep = {
  step_order?: number;
  step_name?: string;
  agent_role?: string;
  status?: string;
  started_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  details?: Record<string, unknown>;
};

type WorkflowSession = {
  session_id?: string;
  workflow_name?: string;
  stage?: string;
  scope?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  started_at?: string;
  completed_at?: string | null;
  steps?: WorkflowStep[];
  events?: Array<Record<string, unknown>>;
};

type GoalSummary = {
  workflow?: {
    session_path?: string;
    session_id?: string;
  };
  latest_gate_run?: {
    decision?: string;
    rollback_required?: boolean;
  };
  deploy?: {
    status?: string;
  };
  final_status?: string;
};

type LaunchManifest = {
  launch_id?: string;
  launched_at?: string;
  objective?: string;
  scope?: string;
  stage?: string;
  route_mode?: string;
  continuous_loop?: boolean;
  runner_pid?: number | null;
  monitor_pid?: number | null;
  log_path?: string;
  manifest_path?: string;
  vscode_bridge?: Record<string, unknown> | null;
};

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'tmp', 'autonomy', 'openjarvis-unattended-last-run.json');
const WORKFLOW_DIR = path.join(ROOT, 'tmp', 'autonomy', 'workflow-sessions');
const LATEST_LAUNCH_PATH = path.join(ROOT, 'tmp', 'autonomy', 'launches', 'latest-interactive-goal.json');

const DEFAULT_HANDOFF_FILE = 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md';
const DEFAULT_PROGRESS_FILE = 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md';

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const toTrimmed = (value: unknown): string => String(value || '').trim();
const toRelative = (targetPath: string): string => path.relative(ROOT, targetPath).replace(/\\/g, '/');

const sanitizeStringList = (value: unknown): string[] => Array.isArray(value)
  ? value.map((entry) => toTrimmed(entry)).filter(Boolean)
  : [];

const getMetadataRecord = (session: WorkflowSession): Record<string, unknown> => {
  if (session.metadata && typeof session.metadata === 'object' && !Array.isArray(session.metadata)) {
    return session.metadata;
  }
  return {};
};

const readMetadataString = (metadata: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = toTrimmed(metadata[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const readMetadataBoolean = (metadata: Record<string, unknown>, keys: string[]): boolean | null => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = toTrimmed(value).toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const readMetadataStringList = (metadata: Record<string, unknown>, keys: string[]): string[] => {
  for (const key of keys) {
    const values = sanitizeStringList(metadata[key]);
    if (values.length > 0) {
      return values;
    }
  }
  return [];
};

const normalizeTrigger = (value: string | null | undefined): AutomationRoutePreviewInput['trigger'] | undefined => {
  const normalized = toTrimmed(value).toLowerCase();
  if (normalized === 'webhook' || normalized === 'schedule' || normalized === 'manual' || normalized === 'event') {
    return normalized;
  }
  return undefined;
};

const inferTrigger = (objective: string, scope: string, metadata: Record<string, unknown>): AutomationRoutePreviewInput['trigger'] => {
  const explicit = normalizeTrigger(readMetadataString(metadata, ['trigger', 'entry_trigger', 'entryTrigger']));
  if (explicit) {
    return explicit;
  }

  const source = `${objective} ${scope}`.toLowerCase();
  if (source.includes('webhook')) {
    return 'webhook';
  }
  if (['schedule', 'scheduled', 'cron', 'weekly', 'daily', 'monitor', 'tick'].some((token) => source.includes(token))) {
    return 'schedule';
  }
  if (scope.toLowerCase().includes('interactive')) {
    return 'manual';
  }
  return 'event';
};

const inferExecutionPreference = (metadata: Record<string, unknown>): AutomationRoutePreviewInput['executionPreference'] => {
  const value = toTrimmed(readMetadataString(metadata, ['execution_preference', 'executionPreference'])).toLowerCase();
  if (value === 'local' || value === 'remote' || value === 'hybrid') {
    return value;
  }
  return 'hybrid';
};

const inferAutomationRouteInput = (session: WorkflowSession): AutomationRoutePreviewInput | null => {
  const metadata = getMetadataRecord(session);
  const objective = toTrimmed(metadata.objective) || toTrimmed(session.metadata?.objective) || 'Autopilot continuity session';
  if (!objective) {
    return null;
  }

  const objectiveLower = objective.toLowerCase();
  const scope = toTrimmed(session.scope);
  const youtubeCommunity = objectiveLower.includes('youtube') && objectiveLower.includes('community');
  const candidateApis = readMetadataStringList(metadata, ['candidate_apis', 'candidateApis']);
  const inferredCandidateApis = candidateApis.length > 0
    ? candidateApis
    : (youtubeCommunity ? ['youtube-community-scrape'] : []);
  const candidateMcpTools = readMetadataStringList(metadata, ['candidate_mcp_tools', 'candidateMcpTools']);
  const structuredDataAvailable = readMetadataBoolean(metadata, ['structured_data_available', 'structuredDataAvailable'])
    ?? (inferredCandidateApis.length > 0
      || ['database', 'crm', 'sheet', 'faq', 'youtube', 'community', 'report'].some((token) => objectiveLower.includes(token)));
  const clearApiAnswer = readMetadataBoolean(metadata, ['clear_api_answer', 'clearApiAnswer']) ?? false;
  const requiresReasoning = readMetadataBoolean(metadata, ['requires_reasoning', 'requiresReasoning'])
    ?? ['complex', 'diagnose', 'repair', 'analyze', 'investigate', 'interpret'].some((token) => objectiveLower.includes(token));
  const requiresLongRunningWait = readMetadataBoolean(metadata, ['requires_long_running_wait', 'requiresLongRunningWait'])
    ?? ['schedule', 'scheduled', 'monitor', 'wait', 'retry', 'weekly', 'daily', 'cron', 'webhook'].some((token) => objectiveLower.includes(token));
  const requiresDurableKnowledge = readMetadataBoolean(metadata, ['requires_durable_knowledge', 'requiresDurableKnowledge']) ?? true;
  const policySensitive = readMetadataBoolean(metadata, ['policy_sensitive', 'policySensitive'])
    ?? ['policy', 'approval', 'destructive', 'delete', 'production'].some((token) => objectiveLower.includes(token));

  return {
    objective,
    trigger: inferTrigger(objective, scope, metadata),
    structuredDataAvailable,
    clearApiAnswer,
    requiresReasoning,
    requiresLongRunningWait,
    requiresDurableKnowledge,
    policySensitive,
    executionPreference: inferExecutionPreference(metadata),
    candidateApis: inferredCandidateApis,
    candidateMcpTools,
  };
};

const buildAutomationRouteGuidance = async (session: WorkflowSession): Promise<AutomationRoutePreview | null> => {
  const input = inferAutomationRouteInput(session);
  if (!input) {
    return null;
  }

  try {
    return await previewApiFirstAgentFallbackRoute(input);
  } catch {
    return null;
  }
};

const readMtimeMs = (filePath: string): number => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
};

const loadLatestWorkflowPath = (): string | null => {
  try {
    const entries = fs.readdirSync(WORKFLOW_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(WORKFLOW_DIR, name);
        return { fullPath, mtimeMs: readMtimeMs(fullPath) };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return entries[0]?.fullPath || null;
  } catch {
    return null;
  }
};

const resolveSessionPath = (summary: GoalSummary | null, override: string): string | null => {
  const explicit = toTrimmed(override);
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(ROOT, explicit);
  }

  const fromSummary = toTrimmed(summary?.workflow?.session_path);
  const summaryPath = fromSummary ? path.resolve(ROOT, fromSummary) : null;
  const latestPath = loadLatestWorkflowPath();

  if (summaryPath && latestPath) {
    return readMtimeMs(latestPath) > readMtimeMs(summaryPath) ? latestPath : summaryPath;
  }

  return summaryPath || latestPath;
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

const matchesLaunch = (launch: LaunchManifest | null, session: WorkflowSession | null): boolean => {
  if (!launch || !session) {
    return false;
  }

  return toTrimmed(launch.objective) === toTrimmed(session.metadata?.objective)
    && toTrimmed(launch.scope) === toTrimmed(session.scope)
    && toTrimmed(launch.stage) === toTrimmed(session.stage);
};

const formatStep = (step: WorkflowStep): string => {
  const name = toTrimmed(step.step_name) || 'unknown-step';
  const status = toTrimmed(step.status) || 'unknown';
  const role = toTrimmed(step.agent_role) || 'openjarvis';
  const duration = Number.isFinite(Number(step.duration_ms)) && Number(step.duration_ms) > 0
    ? `, ${Number(step.duration_ms)}ms`
    : '';
  return `${name} [${status}] role=${role}${duration}`;
};

const toBulletLines = (items: string[], fallback = '- none'): string[] => {
  if (items.length === 0) {
    return [fallback];
  }
  return items.map((item) => `- ${item}`);
};

const buildSafeAutonomousQueue = (automationRoute: AutomationRoutePreview | null): string[] => {
  const queue = [
    'continue the current workflow if runner and session state stay healthy',
    'keep launch manifest/log, workflow session, and summary aligned',
    'refresh the active progress packet on session transitions and completion',
  ];

  if (!automationRoute) {
    return queue;
  }

  if (automationRoute.candidates.apis.length > 0) {
    queue.push(`start from the deterministic API path first: ${automationRoute.candidates.apis.join(', ')}`);
  } else if (automationRoute.primaryPath.surfaces.length > 0 && automationRoute.primaryPath.pathType === 'api-path') {
    queue.push(`start from deterministic route surfaces: ${automationRoute.primaryPath.surfaces.join(', ')}`);
  }

  if (automationRoute.recommendedMode !== 'api-first') {
    queue.push(`only escalate into fallback surfaces after an explicit router miss, ambiguity, or parser drift: ${automationRoute.fallbackPath.surfaces.join(', ') || 'fallback not yet wired'}`);
  }

  if (automationRoute.matchedExampleIds.length > 0) {
    queue.push(`reuse the canonical handoff example before inventing a new flow: ${automationRoute.matchedExampleIds.join(', ')}`);
  }

  if (automationRoute.escalation.required) {
    queue.push(`stop and recall GPT when this route crosses the boundary: ${automationRoute.escalation.reason}`);
  } else {
    queue.push('persist route decisions, artifact refs, and compact distillates after each fallback cycle');
  }

  return queue;
};

const buildAutomationRouteSectionLines = (route: AutomationRoutePreview | null): string[] => {
  if (!route) {
    return ['route_guidance: unavailable'];
  }

  return [
    `recommended_mode: ${route.recommendedMode}`,
    `primary_path_type: ${route.primaryPath.pathType}`,
    `primary_surfaces: ${route.primaryPath.surfaces.join(', ') || 'none'}`,
    `fallback_surfaces: ${route.fallbackPath.surfaces.join(', ') || 'none'}`,
    `candidate_apis: ${route.candidates.apis.join(', ') || 'none'}`,
    `candidate_mcp_tools: ${route.candidates.mcpTools.join(', ') || 'none'}`,
    `matched_examples: ${route.matchedExampleIds.join(', ') || 'none'}`,
    `escalation_required: ${String(route.escalation.required)}`,
    `escalation_target: ${route.escalation.target}`,
    `escalation_reason: ${route.escalation.reason}`,
  ];
};

const buildAutomationLifecycleSectionLines = (autoRestartOnRelease: boolean): string[] => ([
  `auto_restart_on_release: ${String(autoRestartOnRelease)}`,
  `release_behavior: ${autoRestartOnRelease ? 'hermes may start the next bounded cycle without a new GPT session' : 'yield at the next GPT or human boundary'}`,
]);

const buildWrappingGuidanceSectionLines = (route: AutomationRoutePreview | null): string[] => {
  if (!route) {
    return ['local_pattern: ext.<adapterId>.<capability>', 'shared_pattern: upstream.<namespace>.<tool>'];
  }

  return [
    `local_pattern: ${route.wrappingLayer.localPattern}`,
    `shared_pattern: ${route.wrappingLayer.sharedPattern}`,
    ...route.wrappingLayer.recommendations,
  ];
};

const buildCapacityRecoveryNextAction = (capacityTarget: number): string => `resume bounded GCP capacity recovery until capacity reaches ${capacityTarget}`;
const buildAutoRestartNextAction = (): string => 'restart the next bounded automation cycle from the active objective';

const buildNextAction = (params: {
  session: WorkflowSession;
  runningSteps: WorkflowStep[];
  failedSteps: WorkflowStep[];
  autoRestartOnRelease: boolean;
}): string => {
  if (params.failedSteps.length > 0) {
    return `recover ${toTrimmed(params.failedSteps[0]?.step_name) || 'failed step'} and refresh packet state`;
  }
  if (params.runningSteps.length > 0) {
    return `continue ${toTrimmed(params.runningSteps[0]?.step_name) || 'current step'}`;
  }
  if (toTrimmed(params.session.status).toLowerCase() === 'released') {
    if (params.autoRestartOnRelease) {
      return buildAutoRestartNextAction();
    }
    return WAIT_FOR_NEXT_GPT_ACTION;
  }
  return 'refresh status and decide whether a new continuity cycle is needed';
};

export const normalizeContinuityObsidianHealth = (
  health: ReturnType<typeof getObsidianVaultHealthStatus>,
  vaultPath: string,
): ContinuityObsidianHealth => {
  const mixedRoutingSummary = health.adapterStatus.accessPosture.mode === 'mixed-routing'
    ? health.adapterStatus.accessPosture.summary
    : null;
  const nonMixedIssues = mixedRoutingSummary
    ? health.issues.filter((issue) => issue !== mixedRoutingSummary)
    : [...health.issues];
  const localMirrorAvailable = toTrimmed(vaultPath).length > 0;

  if (mixedRoutingSummary && nonMixedIssues.length === 0 && localMirrorAvailable && health.writeCapable && health.readCapable && health.searchCapable) {
    return {
      ...health,
      healthy: true,
      issues: [],
      warnings: [mixedRoutingSummary],
    };
  }

  return {
    ...health,
    warnings: [],
  };
};

const buildContinuityRuntimeState = (params: {
  session: WorkflowSession;
  summary: GoalSummary | null;
  launch: LaunchManifest | null;
  runnerAlive: boolean | null;
  monitorAlive: boolean | null;
  syncReason: string;
  handoffFile: string;
  progressFile: string;
  vaultPath: string;
  capacityTarget: number;
  gcpCapacityRecoveryRequested: boolean;
  automationRoute: AutomationRoutePreview | null;
  autoRestartOnRelease: boolean;
}) => {
  const completedSteps = (params.session.steps || []).filter((step) => ['pass', 'passed'].includes(toTrimmed(step.status).toLowerCase()));
  const runningSteps = (params.session.steps || []).filter((step) => toTrimmed(step.status).toLowerCase() === 'running');
  const failedSteps = (params.session.steps || []).filter((step) => ['fail', 'failed'].includes(toTrimmed(step.status).toLowerCase()));
  const ownerMode = buildOwnerAndMode(params.session, params.runnerAlive, params.autoRestartOnRelease);
  const defaultNextAction = buildNextAction({
    session: params.session,
    runningSteps,
    failedSteps,
    autoRestartOnRelease: params.autoRestartOnRelease,
  });
  let nextAction = defaultNextAction;
  if (params.gcpCapacityRecoveryRequested && toTrimmed(params.session.status).toLowerCase() === 'released') {
    nextAction = buildCapacityRecoveryNextAction(params.capacityTarget);
  }
  const safeQueue = buildSafeAutonomousQueue(params.automationRoute);
  if (params.autoRestartOnRelease) {
    safeQueue.push('restart the next bounded automation cycle automatically after release unless an escalation boundary appears');
  }
  const waitBoundary = toTrimmed(nextAction).toLowerCase() === WAIT_FOR_NEXT_GPT_ACTION;
  const resumeReason = ownerMode.escalation !== 'none'
    ? `escalation_${ownerMode.escalation}`
    : (params.autoRestartOnRelease && toTrimmed(params.session.status).toLowerCase() === 'released' && !waitBoundary
      ? 'workstream_auto_restart_ready'
      : (waitBoundary ? 'packet_waiting_for_next_gpt_objective' : null));
  const health = normalizeContinuityObsidianHealth(getObsidianVaultHealthStatus(), params.vaultPath);
  const staleExecutionSuspected = Boolean(toTrimmed(params.session.status).toLowerCase() === 'executing' && params.runnerAlive === false);
  const gcpNative = buildGcpNativeAutopilotContext();
  const capacity = buildAutopilotCapacity({
    target: params.capacityTarget,
    workflow: {
      status: params.session.status,
    },
    launch: {
      manifest_path: params.launch?.manifest_path || null,
      log_path: params.launch?.log_path || null,
      runner_pid: params.launch?.runner_pid ?? null,
      runner_alive: params.runnerAlive,
      monitor_pid: params.launch?.monitor_pid ?? null,
      monitor_alive: params.monitorAlive,
      continuous_loop: Boolean(params.launch?.continuous_loop),
      vscode_bridge: params.launch?.vscode_bridge || null,
    },
    supervisor: params.launch?.continuous_loop
      ? {
        status: toTrimmed(params.session.status).toLowerCase() === 'released' ? 'stopped' : 'running',
        launches_completed: 1,
      }
      : null,
    result: {
      final_status: toTrimmed(params.session.status).toLowerCase() === 'released'
        ? 'pass'
        : (params.summary?.final_status || params.session.status || null),
      failed_steps: failedSteps.length,
      stale_execution_suspected: staleExecutionSuspected,
    },
    resume_state: {
      available: true,
      resumable: Boolean(toTrimmed(params.session.metadata?.objective) && ownerMode.escalation === 'none' && !waitBoundary),
      reason: resumeReason,
      owner: ownerMode.owner,
      mode: ownerMode.mode,
      next_action: nextAction,
      gcp_capacity_recovery_requested: params.gcpCapacityRecoveryRequested,
      safe_queue: safeQueue,
      handoff_packet_path: params.handoffFile,
      progress_packet_path: params.progressFile,
    },
    continuity_packets: {
      final_sync: {
        obsidian_healthy: health.healthy,
        obsidian_issues: health.issues,
        obsidian_warnings: health.warnings,
      },
    },
    vscode_cli: {
      last_auto_open: params.launch?.vscode_bridge || null,
    },
    gcp_capacity_recovery_requested: params.gcpCapacityRecoveryRequested,
    gcp_native: gcpNative,
  });

  return {
    completedSteps,
    runningSteps,
    failedSteps,
    ownerMode,
    nextAction,
    safeQueue,
    waitBoundary,
    health,
    gcpNative,
    capacity,
    automationRoute: params.automationRoute,
    autoRestartOnRelease: params.autoRestartOnRelease,
  };
};

const buildOwnerAndMode = (session: WorkflowSession, runnerAlive: boolean | null, autoRestartOnRelease = false): {
  owner: string;
  mode: string;
  escalation: 'none' | 'pending-gpt' | 'pending-human';
} => {
  const status = toTrimmed(session.status).toLowerCase();

  if (status === 'executing' && runnerAlive === false) {
    return { owner: 'gpt', mode: 'blocked', escalation: 'pending-gpt' };
  }
  if (status === 'failed') {
    return { owner: 'gpt', mode: 'blocked', escalation: 'pending-gpt' };
  }
  if (status === 'released' && autoRestartOnRelease) {
    return { owner: 'hermes', mode: 'observing', escalation: 'none' };
  }
  if (status === 'released') {
    return { owner: 'human', mode: 'waiting', escalation: 'none' };
  }
  if (status === 'executing' || status === 'verifying' || status === 'approving') {
    return { owner: 'hermes', mode: 'executing', escalation: 'none' };
  }
  return { owner: 'hermes', mode: 'observing', escalation: 'none' };
};

export const formatWorkflowSessionReference = (sessionPath: string | null, session: WorkflowSession): string => {
  if (sessionPath) {
    return `workflow session: ${toRelative(sessionPath)}`;
  }
  const sessionId = toTrimmed(session.session_id);
  return `workflow session: ${sessionId ? `supabase:${sessionId}` : 'supabase'}`;
};

const buildHandoffContent = (params: {
  sessionPath: string | null;
  session: WorkflowSession;
  summary: GoalSummary | null;
  launch: LaunchManifest | null;
  runnerAlive: boolean | null;
  monitorAlive: boolean | null;
  syncReason: string;
  runtimeState: ReturnType<typeof buildContinuityRuntimeState>;
}): string => {
  const gateDecision = toTrimmed(params.summary?.latest_gate_run?.decision) || 'unknown';
  const deployStatus = toTrimmed(params.summary?.deploy?.status) || 'unknown';
  const evidenceRefs = [
    formatWorkflowSessionReference(params.sessionPath, params.session),
    `latest summary: ${toRelative(SUMMARY_PATH)}`,
    'operating plan: docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md',
    'continuity contract: docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md',
  ];
  if (params.launch?.manifest_path) {
    evidenceRefs.push(`launch manifest: ${toRelative(path.resolve(ROOT, params.launch.manifest_path))}`);
  }
  if (params.launch?.log_path) {
    evidenceRefs.push(`launch log: ${toRelative(path.resolve(ROOT, params.launch.log_path))}`);
  }

  const lines = [
    '# Hermes Autopilot Continuity Handoff Packet',
    '',
    '## Session Objective',
    ...toBulletLines([toTrimmed(params.session.metadata?.objective) || 'Autopilot continuity session']),
    '',
    '## User Intent Model',
    ...toBulletLines([
      'requested outcome: keep bounded IDE/autopilot continuity alive between GPT sessions using the local Hermes runtime',
      'non-goal: force the user to relay the same request into Hermes or depend on one still-open monitor window',
      'current priority: keep the local continuity runner observable, recoverable, and packet-driven',
    ]),
    '',
    '## Verified State',
    ...toBulletLines([
      `session_id: ${toTrimmed(params.session.session_id)}`,
      `status: ${toTrimmed(params.session.status)}`,
      `route_mode: ${toTrimmed(params.session.metadata?.route_mode)}`,
      `started_at: ${toTrimmed(params.session.started_at)}`,
      `strict: ${String(Boolean(params.session.metadata?.strict))}`,
      `latest_gate_decision: ${gateDecision}`,
      `deploy_status: ${deployStatus}`,
      `runner_alive: ${params.runnerAlive === null ? 'unknown' : String(params.runnerAlive)}`,
      `monitor_alive: ${params.monitorAlive === null ? 'unknown' : String(params.monitorAlive)}`,
      `obsidian_health: ${params.runtimeState.health.healthy ? 'healthy' : params.runtimeState.health.issues.join('; ') || 'degraded'}`,
      `sync_reason: ${params.syncReason}`,
    ]),
    '',
    '## Completed Since Last Session',
    ...toBulletLines(params.runtimeState.completedSteps.map(formatStep)),
    '',
    '## Decision Distillate For Hermes',
    ...toBulletLines([
      'situation: Windows interactive Autopilot needs a user-visible shell without tying execution lifetime to that shell',
      'decision: run the real continuity worker as a detached runner and keep PowerShell as a monitor surface only',
      'why: GPT continuity must survive monitor closure and remain recoverable from workflow state plus packet state',
      'capacity-rule: keep looping only while composite Autopilot capacity remains below target and no wait-boundary or escalation state is active',
      'operator-capacity-rule: if the operator explicitly requests GCP capacity recovery, the normal wait boundary may be overridden until the target is reached or a real escalation condition appears',
      'gcp-native-rule: local Ollama may accelerate a cycle, but the always-on lane counts only when role workers, OpenJarvis serve, and shared MCP stay wired to the canonical GCP surfaces',
      'rejects: treating one visible terminal as the sole owner of local continuity, or relying on stale session-open chat memory',
      'reuse_when: any interactive goal-cycle that should stay visible to the operator while Hermes continues locally',
      'recall_when: runner is missing while status still says executing, strict gates fail, or packet sync cannot write to Obsidian',
    ]),
    '',
    '## Capacity State',
    ...toBulletLines(buildAutopilotCapacitySectionLines(params.runtimeState.capacity)),
    '',
    '## Automation Route Guidance',
    ...toBulletLines(buildAutomationRouteSectionLines(params.runtimeState.automationRoute)),
    '',
    '## Automation Lifecycle Guidance',
    ...toBulletLines(buildAutomationLifecycleSectionLines(params.runtimeState.autoRestartOnRelease)),
    '',
    '## MCP Wrapping Guidance',
    ...toBulletLines(buildWrappingGuidanceSectionLines(params.runtimeState.automationRoute)),
    '',
    '## Open Loops',
    ...toBulletLines([
      ...params.runtimeState.runningSteps.map(formatStep),
      ...params.runtimeState.failedSteps.map((step) => `failed step requires attention: ${formatStep(step)}`),
    ]),
    '',
    '## Pending Decisions For GPT',
    ...toBulletLines(params.runtimeState.ownerMode.escalation === 'pending-gpt'
      ? params.runtimeState.failedSteps.map((step) => `decide recovery path for ${formatStep(step)}`)
      : []),
    '',
    '## Safe Autonomous Queue For Hermes',
    ...toBulletLines(params.runtimeState.safeQueue),
    '',
    '## Evidence And References',
    ...toBulletLines(evidenceRefs),
    '',
    '## Recall Triggers',
    ...toBulletLines([
      'runner missing while session status remains executing',
      'strict gate returns fail or no-go and the next action is not mechanically obvious',
      'vault write path becomes degraded or packet sync returns no path',
      'the objective changes or a broader architecture/policy decision is required',
    ]),
    '',
    '## Context Budget State',
    ...toBulletLines([
      'included: latest workflow session, latest summary, launch manifest/log pointers, and active step delta',
      'omitted: full weekly report bodies, full logs, and unchanged historical session traces unless needed for a new decision',
    ]),
    '',
  ];

  return `${lines.join('\n')}`;
};

const buildProgressContent = (params: {
  sessionPath: string | null;
  session: WorkflowSession;
  summary: GoalSummary | null;
  launch: LaunchManifest | null;
  runnerAlive: boolean | null;
  monitorAlive: boolean | null;
  syncReason: string;
  runtimeState: ReturnType<typeof buildContinuityRuntimeState>;
}): string => {
  const delta = [
    `session ${toTrimmed(params.session.session_id)} is ${toTrimmed(params.session.status).toLowerCase() || 'unknown'}`,
    params.launch?.log_path ? `latest launch log: ${toRelative(path.resolve(ROOT, params.launch.log_path))}` : 'launch log unavailable',
    `sync_reason: ${params.syncReason}`,
  ];

  const evidenceRefs = [
    formatWorkflowSessionReference(params.sessionPath, params.session),
    `latest summary: ${toRelative(SUMMARY_PATH)}`,
  ];
  if (params.launch?.manifest_path) {
    evidenceRefs.push(`launch manifest: ${toRelative(path.resolve(ROOT, params.launch.manifest_path))}`);
  }

  const lines = [
    '# Hermes Autopilot Continuity Progress Packet',
    '',
    '## Objective',
    ...toBulletLines([toTrimmed(params.session.metadata?.objective) || 'Autopilot continuity session']),
    '',
    '## Owner And Mode',
    ...toBulletLines([
      `owner: ${params.runtimeState.ownerMode.owner}`,
      `mode: ${params.runtimeState.ownerMode.mode}`,
      `route_mode: ${toTrimmed(params.session.metadata?.route_mode)}`,
      `runner_alive: ${params.runnerAlive === null ? 'unknown' : String(params.runnerAlive)}`,
      `monitor_alive: ${params.monitorAlive === null ? 'unknown' : String(params.monitorAlive)}`,
    ]),
    '',
    '## Delta Since Last GPT Session',
    ...toBulletLines(delta),
    '',
    '## Completed',
    ...toBulletLines(params.runtimeState.completedSteps.map(formatStep)),
    '',
    '## In Flight',
    ...toBulletLines(params.runtimeState.runningSteps.map(formatStep)),
    '',
    '## Blockers',
    ...toBulletLines(params.runtimeState.failedSteps.map(formatStep)),
    '',
    '## Next Action',
    ...toBulletLines([params.runtimeState.nextAction]),
    '',
    '## Automation Route Guidance',
    ...toBulletLines(buildAutomationRouteSectionLines(params.runtimeState.automationRoute)),
    '',
    '## Automation Lifecycle Guidance',
    ...toBulletLines(buildAutomationLifecycleSectionLines(params.runtimeState.autoRestartOnRelease)),
    '',
    '## Escalation Status',
    ...toBulletLines([params.runtimeState.ownerMode.escalation]),
    '',
    '## Capacity State',
    ...toBulletLines(buildAutopilotCapacitySectionLines(params.runtimeState.capacity)),
    '',
    '## Context Budget State',
    ...toBulletLines([
      'progress packet carries only current delta, active steps, blockers, and evidence pointers',
      'full logs and weekly report bodies remain on demand in tmp/autonomy and repo docs',
    ]),
    '',
    '## Evidence And References',
    ...toBulletLines(evidenceRefs),
    '',
  ];

  return `${lines.join('\n')}`;
};

const buildMirroredNoteContent = (params: {
  content: string;
  tags: string[];
  properties: Record<string, ObsidianFrontmatterValue | null | undefined>;
}): string => {
  const normalized = String(params.content || '').trimEnd();
  if (hasObsidianFrontmatter(normalized)) {
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  }

  return `${buildObsidianFrontmatter({
    tags: params.tags,
    properties: params.properties,
  })}\n\n${normalized}\n`;
};

const resolveVaultMirrorPath = (vaultPath: string, fileName: string): string => {
  const absolutePath = path.resolve(vaultPath, fileName);
  const relativePath = path.relative(vaultPath, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid vault-relative mirror path: ${fileName}`);
  }
  return absolutePath;
};

const writeLocalVaultMirror = (params: {
  vaultPath: string;
  fileName: string;
  content: string;
}): string => {
  const absolutePath = resolveVaultMirrorPath(params.vaultPath, params.fileName);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, params.content, 'utf8');
  return absolutePath;
};

async function main(): Promise<void> {
  const summary = readJsonFile<GoalSummary>(SUMMARY_PATH);
  const requestedSessionPath = resolveSessionPath(summary, parseArg('sessionPath', ''));
  const runtimeLane = toTrimmed(parseArg('runtimeLane', process.env.OPENJARVIS_RUNTIME_LANE || 'operator-personal')) || 'operator-personal';
  const workstreamState = await readLatestWorkflowState({
    sessionPath: requestedSessionPath,
    sessionId: toTrimmed(summary?.workflow?.session_id) || toTrimmed(parseArg('sessionId', '')),
    scope: process.env.OPENJARVIS_SCOPE || null,
    workflowName: 'openjarvis.unattended',
    runtimeLane,
  });
  const sessionPath = workstreamState?.sessionPath || requestedSessionPath;
  const session = workstreamState?.ok ? workstreamState.session as WorkflowSession : (sessionPath ? readJsonFile<WorkflowSession>(sessionPath) : null);
  if (!session) {
    throw new Error('No workflow session available for continuity packet sync');
  }

  const vaultPath = getObsidianVaultRoot();
  if (!toTrimmed(vaultPath)) {
    throw new Error('Obsidian vault path is not configured');
  }

  const latestLaunch = readJsonFile<LaunchManifest>(LATEST_LAUNCH_PATH);
  const launch = matchesLaunch(latestLaunch, session) ? latestLaunch : null;
  const runnerAlive = launch ? isProcessAlive(launch.runner_pid) : null;
  const monitorAlive = launch ? isProcessAlive(launch.monitor_pid) : null;
  const syncReason = toTrimmed(parseArg('reason', 'manual-sync')) || 'manual-sync';
  const handoffFile = toTrimmed(parseArg('handoffFile', process.env.HERMES_AUTOPILOT_HANDOFF_PACKET_PATH || DEFAULT_HANDOFF_FILE)) || DEFAULT_HANDOFF_FILE;
  const progressFile = toTrimmed(parseArg('progressFile', process.env.HERMES_AUTOPILOT_PROGRESS_PACKET_PATH || DEFAULT_PROGRESS_FILE)) || DEFAULT_PROGRESS_FILE;
  const capacityTarget = normalizeCapacityTarget(parseArg('capacityTarget', process.env.HERMES_AUTOPILOT_CAPACITY_TARGET || String(DEFAULT_CAPACITY_TARGET)));
  const gcpCapacityRecoveryRequested = parseBool(parseArg('gcpCapacityRecovery', process.env.HERMES_AUTOPILOT_GCP_CAPACITY_RECOVERY || 'false'), false);
  const autoRestartOnRelease = readMetadataBoolean(getMetadataRecord(session), ['auto_restart_on_release', 'autoRestartOnRelease']) ?? false;
  const automationRoute = await buildAutomationRouteGuidance(session);
  const runtimeState = buildContinuityRuntimeState({
    session,
    summary,
    launch,
    runnerAlive,
    monitorAlive,
    syncReason,
    handoffFile,
    progressFile,
    vaultPath,
    capacityTarget,
    gcpCapacityRecoveryRequested,
    automationRoute,
    autoRestartOnRelease,
  });

  const handoffContent = buildHandoffContent({
    sessionPath,
    session,
    summary,
    launch,
    runnerAlive,
    monitorAlive,
    syncReason,
    runtimeState,
  });
  const handoffTags = ['hermes', 'workspace', 'handoff', 'autopilot'];
  const handoffProperties = {
    title: 'Hermes Autopilot Continuity Handoff Packet',
    source: 'openjarvis-continuity-packet-sync',
    guild_id: 'system',
    packet_kind: 'handoff',
    objective: toTrimmed(session.metadata?.objective) || 'Autopilot continuity session',
    capacity_target: runtimeState.capacity.target,
    capacity_score: runtimeState.capacity.score,
    capacity_state: runtimeState.capacity.state,
    capacity_loop_action: runtimeState.capacity.loop_action,
    gcp_capacity_recovery_requested: runtimeState.capacity.gcp_capacity_recovery_requested,
    gcp_native_capacity_score: runtimeState.capacity.gcp_native?.score ?? null,
    gcp_native_wired_surfaces: runtimeState.capacity.gcp_native?.wired_surfaces ?? null,
    automation_route_mode: runtimeState.automationRoute?.recommendedMode || null,
    automation_matched_examples: runtimeState.automationRoute?.matchedExampleIds.join(', ') || null,
    automation_primary_surfaces: runtimeState.automationRoute?.primaryPath.surfaces.join(', ') || null,
    automation_fallback_surfaces: runtimeState.automationRoute?.fallbackPath.surfaces.join(', ') || null,
    automation_escalation_required: runtimeState.automationRoute?.escalation.required ?? null,
    automation_escalation_target: runtimeState.automationRoute?.escalation.target || null,
    automation_auto_restart_on_release: runtimeState.autoRestartOnRelease,
  };
  const progressContent = buildProgressContent({
    sessionPath,
    session,
    summary,
    launch,
    runnerAlive,
    monitorAlive,
    syncReason,
    runtimeState,
  });
  const progressTags = ['hermes', 'workspace', 'progress', 'autopilot'];
  const progressProperties = {
    title: 'Hermes Autopilot Continuity Progress Packet',
    source: 'openjarvis-continuity-packet-sync',
    guild_id: 'system',
    packet_kind: 'progress',
    objective: toTrimmed(session.metadata?.objective) || 'Autopilot continuity session',
    capacity_target: runtimeState.capacity.target,
    capacity_score: runtimeState.capacity.score,
    capacity_state: runtimeState.capacity.state,
    capacity_loop_action: runtimeState.capacity.loop_action,
    gcp_capacity_recovery_requested: runtimeState.capacity.gcp_capacity_recovery_requested,
    gcp_native_capacity_score: runtimeState.capacity.gcp_native?.score ?? null,
    gcp_native_wired_surfaces: runtimeState.capacity.gcp_native?.wired_surfaces ?? null,
    automation_route_mode: runtimeState.automationRoute?.recommendedMode || null,
    automation_matched_examples: runtimeState.automationRoute?.matchedExampleIds.join(', ') || null,
    automation_primary_surfaces: runtimeState.automationRoute?.primaryPath.surfaces.join(', ') || null,
    automation_fallback_surfaces: runtimeState.automationRoute?.fallbackPath.surfaces.join(', ') || null,
    automation_escalation_required: runtimeState.automationRoute?.escalation.required ?? null,
    automation_escalation_target: runtimeState.automationRoute?.escalation.target || null,
    automation_auto_restart_on_release: runtimeState.autoRestartOnRelease,
  };

  const handoffResult = await writeObsidianNoteWithAdapter({
    guildId: 'system',
    vaultPath,
    fileName: handoffFile,
    content: handoffContent,
    tags: handoffTags,
    properties: handoffProperties,
    trustedSource: true,
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
  });

  const progressResult = await writeObsidianNoteWithAdapter({
    guildId: 'system',
    vaultPath,
    fileName: progressFile,
    content: progressContent,
    tags: progressTags,
    properties: progressProperties,
    trustedSource: true,
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
  });

  if (!handoffResult || !progressResult) {
    throw new Error('Continuity packet write returned no path');
  }

  const handoffMirrorPath = writeLocalVaultMirror({
    vaultPath,
    fileName: handoffFile,
    content: buildMirroredNoteContent({
      content: handoffContent,
      tags: handoffTags,
      properties: handoffProperties,
    }),
  });
  const progressMirrorPath = writeLocalVaultMirror({
    vaultPath,
    fileName: progressFile,
    content: buildMirroredNoteContent({
      content: progressContent,
      tags: progressTags,
      properties: progressProperties,
    }),
  });

  console.log(JSON.stringify({
    ok: true,
    sync_reason: syncReason,
    workstream_source: workstreamState?.source || (sessionPath ? 'local-file' : 'unavailable'),
    runtime_lane: toTrimmed(session.metadata?.runtime_lane) || runtimeLane,
    session_id: toTrimmed(session.session_id),
    session_path: sessionPath ? toRelative(sessionPath) : null,
    status: toTrimmed(session.status),
    objective: toTrimmed(session.metadata?.objective),
    handoff_packet: handoffResult.path,
    progress_packet: progressResult.path,
    handoff_local_mirror: handoffMirrorPath,
    progress_local_mirror: progressMirrorPath,
    launch_manifest: launch?.manifest_path ? toRelative(path.resolve(ROOT, launch.manifest_path)) : null,
    launch_log: launch?.log_path ? toRelative(path.resolve(ROOT, launch.log_path)) : null,
    runner_alive: runnerAlive,
    monitor_alive: monitorAlive,
    vault_root: vaultPath,
    obsidian_healthy: runtimeState.health.healthy,
    obsidian_issues: runtimeState.health.issues,
    obsidian_warnings: runtimeState.health.warnings,
    gcp_capacity_recovery_requested: runtimeState.capacity.gcp_capacity_recovery_requested,
    capacity: runtimeState.capacity,
    gcp_native: runtimeState.capacity.gcp_native,
    automation_route: runtimeState.automationRoute
      ? {
        recommended_mode: runtimeState.automationRoute.recommendedMode,
        matched_example_ids: runtimeState.automationRoute.matchedExampleIds,
        primary_surfaces: runtimeState.automationRoute.primaryPath.surfaces,
        fallback_surfaces: runtimeState.automationRoute.fallbackPath.surfaces,
        escalation: runtimeState.automationRoute.escalation,
        auto_restart_on_release: runtimeState.autoRestartOnRelease,
      }
      : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
import 'dotenv/config';
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  ACTIVE_WORKFLOW_STATES,
  DEFAULT_CAPACITY_TARGET,
  WAIT_FOR_NEXT_GPT_ACTION,
  buildAutopilotCapacity,
  buildGcpNativeAutopilotContext,
  normalizeCapacityTarget,
} from './lib/openjarvisAutopilotCapacity.mjs';
import { buildAutomationActivationPack } from './lib/automationActivationPack.mjs';
import { deriveResumeStateFromWorkflowSession, readLatestWorkflowState } from './openjarvis-workflow-state.mjs';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'tmp', 'autonomy', 'openjarvis-unattended-last-run.json');
const WORKFLOW_DIR = path.join(ROOT, 'tmp', 'autonomy', 'workflow-sessions');
const LAUNCHES_DIR = path.join(ROOT, 'tmp', 'autonomy', 'launches');
const LATEST_INTERACTIVE_LAUNCH_PATH = path.join(LAUNCHES_DIR, 'latest-interactive-goal.json');
const LATEST_CONTINUITY_LOOP_PATH = path.join(LAUNCHES_DIR, 'latest-interactive-goal-loop.json');
const EXECUTION_BOARD_PATH = path.join(ROOT, 'docs', 'planning', 'EXECUTION_BOARD.md');
const SELF_SCRIPT = path.join(ROOT, 'scripts', 'run-openjarvis-goal-cycle.mjs');
const RUN_SCRIPT = path.join(ROOT, 'scripts', 'run-openjarvis-unattended.mjs');
const HERMES_VSCODE_BRIDGE_SCRIPT = path.join(ROOT, 'scripts', 'run-hermes-vscode-bridge.ts');
const HERMES_RUNTIME_CONTROL_SCRIPT = path.join(ROOT, 'scripts', 'run-openjarvis-hermes-runtime-control.ts');
const DEFAULT_HANDOFF_PACKET_PATH = process.env.HERMES_AUTOPILOT_HANDOFF_PACKET_PATH || 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md';
const DEFAULT_PROGRESS_PACKET_PATH = process.env.HERMES_AUTOPILOT_PROGRESS_PACKET_PATH || 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md';
const DEFAULT_RUNTIME_LANE = process.env.OPENJARVIS_RUNTIME_LANE || 'operator-personal';
const EXECUTION_BOARD_QUEUED_SECTION = 'Queued Now (Approved, Not In Active WIP)';
const AUTONOMOUS_GOAL_REJECT_PATTERNS = [
  /^continue the current workflow/i,
  /^keep workflow session/i,
  /^refresh the active continuity packet/i,
  /^refresh workstream state/i,
  /^restart the next bounded automation cycle/i,
  /^wait for the next gpt objective/i,
  /^promote durable operator-visible outcomes/i,
];
const AUTONOMOUS_GOAL_LEADING_VERBS = new Set([
  'stabilize',
  'fix',
  'recover',
  'improve',
  'audit',
  'refresh',
  'update',
  'document',
  'publish',
  'wire',
  'prepare',
  'verify',
  'optimize',
  'reduce',
]);

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const readTextFile = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
};

const compact = (value) => String(value || '').trim();
const toNullableString = (value) => compact(value) || null;
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const toStringArray = (value) => Array.isArray(value)
  ? value.map((entry) => compact(entry)).filter(Boolean)
  : [];
const uniqueCompactStrings = (values) => {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

export const normalizeLoopLimit = (value, fallback) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }

  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(1, numeric);
};

export const resolveGoalCycleRouteMode = (routeMode, gcpCapacityRecoveryRequested = false) => {
  const normalized = compact(routeMode).toLowerCase() || 'auto';
  if (normalized === 'auto' && gcpCapacityRecoveryRequested) {
    return 'operations';
  }
  return normalized;
};

const serializeLoopLimit = (value) => (Number.isFinite(value) ? value : null);

const buildSessionOpenOrchestrationGuidance = ({ routing, recall, result }) => {
  const recommendedMode = compact(routing?.recommended_mode).toLowerCase();
  const recallBlockedAction = compact(recall?.blocked_action || recall?.blockedAction);
  const finalStatus = compact(result?.final_status).toLowerCase();

  if (recommendedMode === 'api-first' && !recallBlockedAction) {
    return {
      current_priority: 'compact-bootstrap-first',
      advisor_strategy: {
        posture: 'not-needed',
        reason: 'The deterministic API-first path is already sufficient for the current bootstrap state, so adding another advisor layer would add cost before adding value.',
        max_advisor_uses: null,
      },
      context_economics: {
        current_bottleneck: 'startup-context-footprint',
        optimization_order: [
          'reuse the compact session-open bundle first',
          'reuse route guidance and hot-state distillates second',
          'add advisor-style escalation only for repeated hard reasoning checkpoints',
        ],
      },
    };
  }

  if (recallBlockedAction || recommendedMode === 'gpt-recall') {
    return {
      current_priority: 'compact-bootstrap-first',
      advisor_strategy: {
        posture: 'gpt-recall-instead',
        reason: 'The current route has already crossed a policy, approval, or unresolved ambiguity boundary, so GPT recall is the correct escalation rather than a hidden subordinate advisor hop.',
        max_advisor_uses: null,
      },
      context_economics: {
        current_bottleneck: 'startup-context-footprint',
        optimization_order: [
          'keep the bundle small at session open',
          'escalate directly to GPT when the route is blocked',
          'avoid hidden advisor layers for approval-boundary work',
        ],
      },
    };
  }

  return {
    current_priority: 'compact-bootstrap-first',
    advisor_strategy: {
      posture: 'conditional-escalation',
      reason: finalStatus === 'released'
        ? 'The current loop already has compact hot-state, continuity rules, and route guidance. Advisor-style escalation can be added later only if Hermes repeatedly reaches the same hard reasoning checkpoint.'
        : 'Use advisor-style escalation only after the executor starts from the compact bundle and hits a hard reasoning checkpoint that the current API-first or Hermes fallback path cannot close cheaply.',
      max_advisor_uses: 1,
    },
    context_economics: {
      current_bottleneck: 'startup-context-footprint',
      optimization_order: [
        'compact session-open bundle first',
        'route guidance and decision distillates second',
        'advisor-style escalation only as a capped conditional layer',
      ],
    },
  };
};

const CAPABILITY_DEMAND_SKIP_REASONS = new Set([
  'capacity_below_target',
  'workstream_auto_restart_ready',
]);

const inferCapabilityDemandOwner = ({ blocker, cheapestEnablementPath, recall, routing, capacity }) => {
  const blockerText = compact(blocker).toLowerCase();
  const enablementText = compact(cheapestEnablementPath).toLowerCase();
  const blockedAction = compact(recall?.blocked_action || recall?.blockedAction).toLowerCase();
  const primaryReason = compact(capacity?.primary_reason).toLowerCase();
  const primarySurfaces = toStringArray(routing?.primary_surfaces).map((entry) => compact(entry).toLowerCase());

  if (
    blockerText.includes('supervisor')
    || enablementText.includes('supervisor')
    || enablementText.includes('progress packet')
    || enablementText.includes('execution board')
  ) {
    return 'hermes';
  }

  if (blockedAction || compact(recall?.decision_reason || recall?.decisionReason)) {
    return 'gpt';
  }

  if (primaryReason.startsWith('gcp_') || primarySurfaces.some((entry) => entry.includes('gcp') || entry.includes('remote'))) {
    return 'remote-worker';
  }

  if (primarySurfaces.some((entry) => entry.includes('n8n'))) {
    return 'n8n';
  }

  if (primarySurfaces.some((entry) => entry.includes('mcp'))) {
    return 'shared-mcp';
  }

  return 'operator';
};

const buildSessionOpenCapabilityDemands = ({
  workflow,
  routing,
  hermesRuntime,
  recall,
  capacity,
  evidenceRefs,
  autonomousGoalCandidates,
}) => {
  const objective = toNullableString(autonomousGoalCandidates[0]?.objective) || toNullableString(workflow.objective);
  const blockers = toStringArray(hermesRuntime?.blockers);
  const nextActions = toStringArray(hermesRuntime?.next_actions);
  const remediationActions = Array.isArray(hermesRuntime?.remediation_actions)
    ? hermesRuntime.remediation_actions.filter((entry) => isRecord(entry))
    : [];
  const capacityReason = toNullableString(capacity?.primary_reason);
  const failedRoute = uniqueCompactStrings([
    toNullableString(routing?.primary_path_type)
      ? `${routing.primary_path_type}${toNullableString(toStringArray(routing?.primary_surfaces)[0]) ? ` via ${toStringArray(routing?.primary_surfaces)[0]}` : ''}`
      : null,
    toNullableString(recall?.blocked_action || recall?.blockedAction),
  ])[0] || null;
  const evidenceLocators = evidenceRefs.map((entry) => compact(entry.locator)).filter(Boolean).slice(0, 4);
  const demands = [];

  if (blockers[0]) {
    const cheapestEnablementPath = uniqueCompactStrings([
      toNullableString(remediationActions[0]?.command_preview),
      toNullableString(remediationActions[0]?.label),
      nextActions[0],
    ])[0] || null;
    demands.push({
      summary: blockers[0],
      objective,
      missing_capability: blockers[0],
      missing_source: null,
      failed_or_insufficient_route: failedRoute,
      cheapest_enablement_path: cheapestEnablementPath,
      proposed_owner: inferCapabilityDemandOwner({
        blocker: blockers[0],
        cheapestEnablementPath,
        recall,
        routing,
        capacity,
      }),
      evidence_refs: evidenceLocators,
      recall_condition: uniqueCompactStrings([
        toNullableString(recall?.decision_reason || recall?.decisionReason),
        toNullableString(recall?.blocked_action || recall?.blockedAction)
          ? `blocked-action:${recall.blocked_action || recall.blockedAction}`
          : null,
      ])[0] || null,
    });
  }

  if (capacityReason && !CAPABILITY_DEMAND_SKIP_REASONS.has(capacityReason.toLowerCase())) {
    demands.push({
      summary: `Resolve ${capacityReason} so Hermes can keep progressing without repeated manual recovery.`,
      objective,
      missing_capability: capacityReason,
      missing_source: null,
      failed_or_insufficient_route: failedRoute,
      cheapest_enablement_path: uniqueCompactStrings([
        nextActions[0],
        toNullableString(remediationActions[0]?.label),
      ])[0] || null,
      proposed_owner: inferCapabilityDemandOwner({
        blocker: capacityReason,
        cheapestEnablementPath: nextActions[0],
        recall,
        routing,
        capacity,
      }),
      evidence_refs: evidenceLocators,
      recall_condition: toNullableString(recall?.decision_reason || recall?.decisionReason),
    });
  }

  if (toNullableString(recall?.blocked_action || recall?.blockedAction)) {
    demands.push({
      summary: `Need a higher-reasoning decision before Hermes can continue ${recall.blocked_action || recall.blockedAction}.`,
      objective,
      missing_capability: toNullableString(recall?.decision_reason || recall?.decisionReason)
        || toNullableString(recall?.blocked_action || recall?.blockedAction),
      missing_source: null,
      failed_or_insufficient_route: toNullableString(recall?.blocked_action || recall?.blockedAction),
      cheapest_enablement_path: toNullableString(recall?.next_action || recall?.nextAction),
      proposed_owner: 'gpt',
      evidence_refs: evidenceLocators,
      recall_condition: uniqueCompactStrings([
        toNullableString(recall?.decision_reason || recall?.decisionReason),
        toNullableString(recall?.blocked_action || recall?.blockedAction)
          ? `blocked-action:${recall.blocked_action || recall.blockedAction}`
          : null,
      ])[0] || null,
    });
  }

  const seen = new Set();
  return demands.filter((entry) => {
    const identity = `${compact(entry.summary)}|${compact(entry.missing_capability)}|${compact(entry.failed_or_insufficient_route)}`.toLowerCase();
    if (!identity || seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  }).slice(0, 4);
};

const buildCompactSessionBootstrap = ({
  workflow,
  hermesRuntime,
  decision,
  autonomousGoalCandidates,
  safeQueue,
  activationPack,
  progressPacket,
  handoffPacket,
  evidenceRefs,
}) => ({
  posture: 'small-bundle-first',
  start_with: ['objective', 'hermes_runtime', 'decision', 'next_queue'],
  objective: toNullableString(workflow.objective),
  hermes_readiness: toNullableString(hermesRuntime.readiness),
  latest_decision_distillate: toNullableString(decision.summary),
  next_queue_head: toNullableString(autonomousGoalCandidates[0]?.objective) || toNullableString(safeQueue[0]),
  defer_large_docs_until_ambiguous: true,
  open_later: uniqueCompactStrings([
    progressPacket ? `progress-packet:${progressPacket}` : null,
    handoffPacket ? `handoff-packet:${handoffPacket}` : null,
    toStringArray(activationPack.readNext)[0],
    evidenceRefs[0]?.locator ? `artifact:${evidenceRefs[0].locator}` : null,
  ]).slice(0, 4),
});

const buildHermesRuntimeReadiness = ({ workflow, supervisor, resumeState, routing, autonomousGoalCandidates, vscodeCli }) => {
  const autoRestartOnRelease = Boolean(resumeState?.auto_restart_on_release ?? workflow?.auto_restart_on_release);
  const resumable = Boolean(resumeState?.resumable);
  const queueEnabled = Boolean(supervisor?.auto_select_queued_objective);
  const supervisorAlive = supervisor?.supervisor_alive === true;
  const hasHotState = ['supabase', 'local-file'].includes(compact(workflow?.source).toLowerCase());
  const localOperatorSurface = uniqueCompactStrings([
    ...toStringArray(routing?.primary_surfaces),
    ...toStringArray(routing?.fallback_surfaces),
  ]).includes('hermes-local-operator');
  const ideHandoffObserved = Boolean(vscodeCli?.last_auto_open);
  const queuedObjectivesAvailable = Array.isArray(autonomousGoalCandidates) && autonomousGoalCandidates.length > 0;
  const canContinueWithoutGptSession = autoRestartOnRelease && resumable;

  let currentRole = 'helper-only';
  let readiness = 'not-ready';
  if (canContinueWithoutGptSession && hasHotState) {
    currentRole = 'continuity-sidecar';
    readiness = 'partial';
  }
  if (canContinueWithoutGptSession && hasHotState && queueEnabled && supervisorAlive && localOperatorSurface) {
    currentRole = 'persistent-local-operator';
    readiness = 'ready';
  }

  const strengths = uniqueCompactStrings([
    canContinueWithoutGptSession
      ? 'Hermes can continue bounded work after the GPT session releases.'
      : null,
    hasHotState
      ? 'Shared workstream state is available, so session-open can reuse hot-state instead of raw markdown archaeology.'
      : null,
    queueEnabled
      ? 'Approved queued objectives can be promoted without reopening GPT for every next task.'
      : null,
    supervisorAlive
      ? 'A live supervisor is currently holding the local continuity loop open.'
      : null,
    localOperatorSurface
      ? 'The active route already recognizes Hermes as a local operator fallback surface.'
      : null,
    ideHandoffObserved
      ? 'A recent VS Code bridge handoff was observed for the active loop.'
      : null,
  ]).slice(0, 6);

  const blockers = uniqueCompactStrings([
    canContinueWithoutGptSession
      ? null
      : 'Release-to-resume continuity is not fully enabled, so Hermes still behaves like a helper after GPT exits.',
    hasHotState
      ? null
      : 'No shared workstream state is attached, so GPT must reconstruct context more often than necessary.',
    queueEnabled
      ? null
      : 'Queued objective promotion is disabled, so Hermes cannot autonomously pick the next approved task.',
    supervisorAlive
      ? null
      : 'No live supervisor is holding the local continuity loop open right now.',
    localOperatorSurface
      ? null
      : 'The active route does not currently expose Hermes as a local operator surface.',
    ideHandoffObserved
      ? null
      : 'No recent IDE handoff was observed, so local editor control may still be only theoretical for this loop.',
    queuedObjectivesAvailable
      ? null
      : 'No approved queued next objective is currently available for autonomous promotion.',
  ]).slice(0, 6);

  const nextActions = uniqueCompactStrings([
    canContinueWithoutGptSession
      ? null
      : 'Mark the workstream as resumable release-to-restart automation only for bounded safe objectives.',
    hasHotState
      ? null
      : 'Attach the active objective to the shared hot-state plane so GPT and Hermes resume from the same workstream row family.',
    queueEnabled
      ? null
      : 'Enable auto-select queued objective on the supervisor loop for approved next-task promotion.',
    supervisorAlive
      ? null
      : 'Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.',
    localOperatorSurface
      ? null
      : 'Keep hermes-local-operator in the route guidance for objectives that require local IDE or shell execution.',
    ideHandoffObserved
      ? null
      : 'Exercise the visible VS Code bridge or local handoff path so editor control is proven in the active loop.',
    queuedObjectivesAvailable
      ? null
      : 'Populate Safe Autonomous Queue or the approved EXECUTION_BOARD queue with the next bounded objective.',
  ]).slice(0, 6);
  const remediationActions = [];
  const runtimeLane = compact(workflow?.runtime_lane) || compact(resumeState?.runtime_lane) || DEFAULT_RUNTIME_LANE;
  const progressPacket = toNullableString(resumeState?.progress_packet_relative_path);

  if (!supervisorAlive) {
    remediationActions.push({
      action_id: 'start-supervisor-loop',
      label: 'Start Hermes queue supervisor',
      description: 'Launch the continuous goal-cycle supervisor with queued objective promotion enabled so Hermes stays attached after release.',
      admin_route: {
        method: 'POST',
        path: '/agent/runtime/openjarvis/hermes-runtime/remediate',
      },
      mcp_tool: {
        name: 'automation.hermes_runtime.remediate',
      },
      default_payload: {
        actionId: 'start-supervisor-loop',
        runtimeLane,
        visibleTerminal: true,
      },
      command_preview: `node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true --continuousLoop=true --autoSelectQueuedObjective=true --maxCycles=0 --maxIdleChecks=0 --visibleTerminal=true --runtimeLane=${runtimeLane}`,
    });
  }

  if (!ideHandoffObserved && progressPacket) {
    remediationActions.push({
      action_id: 'open-progress-packet',
      label: 'Open the active progress packet in VS Code',
      description: 'Exercise the visible VS Code bridge against the live continuity packet instead of assuming editor control is already proven.',
      admin_route: {
        method: 'POST',
        path: '/agent/runtime/openjarvis/hermes-runtime/remediate',
      },
      mcp_tool: {
        name: 'automation.hermes_runtime.remediate',
      },
      default_payload: {
        actionId: 'open-progress-packet',
        runtimeLane,
      },
      command_preview: `code.cmd -r <vault>/${progressPacket.replace(/\\/g, '/')}`,
    });
  }

  if (!queuedObjectivesAvailable) {
    remediationActions.push({
      action_id: 'open-execution-board',
      label: 'Open the approved execution board queue',
      description: 'Open the execution board so the next approved bounded objective can be added without searching through larger planning docs.',
      admin_route: {
        method: 'POST',
        path: '/agent/runtime/openjarvis/hermes-runtime/remediate',
      },
      mcp_tool: {
        name: 'automation.hermes_runtime.remediate',
      },
      default_payload: {
        actionId: 'open-execution-board',
        runtimeLane,
      },
      command_preview: 'code.cmd -r docs/planning/EXECUTION_BOARD.md',
    });
  }

  return {
    target_role: 'persistent-local-operator',
    current_role: currentRole,
    readiness,
    can_continue_without_gpt_session: canContinueWithoutGptSession,
    queue_enabled: queueEnabled,
    supervisor_alive: supervisorAlive,
    has_hot_state: hasHotState,
    local_operator_surface: localOperatorSurface,
    ide_handoff_observed: ideHandoffObserved,
    queued_objectives_available: queuedObjectivesAvailable,
    strengths,
    blockers,
    next_actions: nextActions,
    remediation_actions: remediationActions,
  };
};

const quotePowerShellLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const readMtimeMs = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
};

const parseMarkdownBoolean = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['true', 'yes', '1'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', '0'].includes(normalized)) {
    return false;
  }
  return null;
};

const parseMarkdownNumber = (value) => {
  const numeric = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(numeric) ? numeric : null;
};

const isCapacityRecoveryNextAction = (value) => /^resume bounded GCP capacity recovery until capacity reaches \d+$/i.test(String(value || '').trim());

const ensureDirectory = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writeJsonFile = (filePath, value) => {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveVaultRoot = (overridePath) => {
  const explicit = String(overridePath || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const envPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  return envPath ? path.resolve(envPath) : null;
};

const resolveVaultTarget = (vaultRoot, relativePath) => {
  if (!vaultRoot) {
    return null;
  }

  const absolutePath = path.resolve(vaultRoot, String(relativePath || '').trim());
  const normalizedRelativePath = path.relative(vaultRoot, absolutePath);
  if (!normalizedRelativePath || normalizedRelativePath.startsWith('..') || path.isAbsolute(normalizedRelativePath)) {
    return null;
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath.replace(/\\/g, '/'),
  };
};

const readLocalVaultFile = (target) => {
  if (!target || !fs.existsSync(target.absolutePath)) {
    return null;
  }

  try {
    return fs.readFileSync(target.absolutePath, 'utf8');
  } catch {
    return null;
  }
};

const extractFrontmatterValue = (markdown, key) => {
  const match = String(markdown || '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => new RegExp(`^${escapeRegex(key)}\\s*:`).test(entry.trim()));
  if (!line) {
    return null;
  }

  const value = line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
  return value || null;
};

const extractFrontmatterBoolean = (markdown, key) => parseMarkdownBoolean(extractFrontmatterValue(markdown, key));

const extractMarkdownSection = (markdown, heading) => {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const headingPattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'i');
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex < 0) {
    return [];
  }

  const sectionLines = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim()) || /^#\s+/.test(line.trim())) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines;
};

const extractBulletLines = (markdown, heading) => extractMarkdownSection(markdown, heading)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('- '))
  .map((line) => line.slice(2).trim())
  .filter(Boolean);

const extractNumberedLines = (markdown, heading) => extractMarkdownSection(markdown, heading)
  .map((line) => line.trim())
  .filter((line) => /^\d+\.\s+/.test(line))
  .map((line) => line.replace(/^\d+\.\s+/, '').trim())
  .filter(Boolean);

const extractFirstBullet = (markdown, heading) => extractBulletLines(markdown, heading)[0] || null;

const extractKeyValueBullets = (markdown, heading) => {
  const entries = {};
  for (const line of extractBulletLines(markdown, heading)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase().replace(/\s+/g, '_');
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    entries[key] = value;
  }
  return entries;
};

const normalizeAutonomousGoalObjective = (value) => {
  const normalized = compact(value)
    .replace(/^\d+\.\s+/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .split(' — ')[0]
    .trim();
  return normalized || null;
};

const buildAutonomousGoalDedupeKeys = (value) => {
  const normalized = normalizeAutonomousGoalObjective(value);
  if (!normalized) {
    return [];
  }

  const lower = normalized.toLowerCase();
  const keys = new Set([lower]);
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 2 && AUTONOMOUS_GOAL_LEADING_VERBS.has(words[0])) {
    keys.add(words.slice(1).join(' '));
  }

  return Array.from(keys);
};

const extractMilestoneId = (value) => {
  const match = compact(value).match(/^\[([^\]]+)\]/);
  return match ? compact(match[1]) || null : null;
};

const isAutonomousGoalCandidate = (value, currentObjective = null) => {
  const normalized = normalizeAutonomousGoalObjective(value);
  const current = normalizeAutonomousGoalObjective(currentObjective);
  if (!normalized) {
    return false;
  }
  if (current && normalized.toLowerCase() === current.toLowerCase()) {
    return false;
  }
  return !AUTONOMOUS_GOAL_REJECT_PATTERNS.some((pattern) => pattern.test(normalized));
};

const buildAutonomousGoalCandidate = (objective, extras = {}) => {
  const normalized = normalizeAutonomousGoalObjective(objective);
  if (!normalized) {
    return null;
  }
  const source = compact(extras.source) || 'autonomous-queue';
  return {
    objective: normalized,
    source,
    milestone: compact(extras.milestone) || null,
    source_path: compact(extras.source_path) || null,
    fingerprint: compact(extras.fingerprint) || `${source}:${normalized.toLowerCase()}`,
  };
};

/**
 * @param {string} [executionBoardPath]
 * @returns {Array<{ objective: string; source: string; milestone: string | null; source_path: string | null; fingerprint: string }>}
 */
export const readExecutionBoardQueuedObjectives = (executionBoardPath = EXECUTION_BOARD_PATH) => {
  const markdown = readTextFile(executionBoardPath);
  if (!markdown) {
    return [];
  }

  const sourcePath = path.relative(ROOT, executionBoardPath).replace(/\\/g, '/');
  return extractNumberedLines(markdown, EXECUTION_BOARD_QUEUED_SECTION)
    .flatMap((line) => {
      const objective = normalizeAutonomousGoalObjective(line);
      if (!isAutonomousGoalCandidate(objective)) {
        return [];
      }
      const milestone = extractMilestoneId(line);
      const candidate = buildAutonomousGoalCandidate(objective, {
        source: 'execution-board-queued',
        milestone,
        source_path: sourcePath,
        fingerprint: `execution-board:${milestone || 'queued'}:${String(objective).toLowerCase()}`,
      });
      return candidate ? [candidate] : [];
    });
};

/**
 * @param {{
 *   resumeState?: Record<string, unknown> | null;
 *   currentObjective?: string | null;
 *   executionBoardPath?: string;
 * }} [params]
 * @returns {Array<{ objective: string; source: string; milestone: string | null; source_path: string | null; fingerprint: string }>}
 */
export const buildAutonomousGoalCandidates = ({
  resumeState = null,
  currentObjective = null,
  executionBoardPath = EXECUTION_BOARD_PATH,
} = {}) => {
  const normalizedCurrentObjective = normalizeAutonomousGoalObjective(currentObjective || resumeState?.objective);
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (candidate) => {
    if (!candidate || !candidate.objective) {
      return;
    }
    const dedupeKeys = buildAutonomousGoalDedupeKeys(candidate.objective);
    if (dedupeKeys.some((key) => seen.has(key))) {
      return;
    }
    for (const key of dedupeKeys) {
      seen.add(key);
    }
    candidates.push(candidate);
  };

  for (const queueItem of toStringArray(resumeState?.safe_queue)) {
    if (!isAutonomousGoalCandidate(queueItem, normalizedCurrentObjective)) {
      continue;
    }
    pushCandidate(buildAutonomousGoalCandidate(queueItem, {
      source: 'safe-queue',
      fingerprint: `safe-queue:${String(normalizeAutonomousGoalObjective(queueItem)).toLowerCase()}`,
    }));
  }

  for (const candidate of readExecutionBoardQueuedObjectives(executionBoardPath)) {
    if (!isAutonomousGoalCandidate(candidate.objective, normalizedCurrentObjective)) {
      continue;
    }
    pushCandidate(candidate);
  }

  return candidates.slice(0, 6);
};

/**
 * @param {{
 *   candidates?: Array<Record<string, unknown>>;
 *   consumedFingerprints?: string[];
 *   currentObjective?: string | null;
 * }} [params]
 * @returns {{ objective: string; source: string; milestone: string | null; source_path: string | null; fingerprint: string } | null}
 */
export const pickAutonomousGoalCandidate = ({
  candidates = [],
  consumedFingerprints = [],
  currentObjective = null,
} = {}) => {
  const consumed = new Set(toStringArray(consumedFingerprints));
  const normalizedCurrentObjective = normalizeAutonomousGoalObjective(currentObjective);
  for (const entry of Array.isArray(candidates) ? candidates : []) {
    if (!isRecord(entry)) {
      continue;
    }
    const candidate = buildAutonomousGoalCandidate(entry.objective, {
      source: entry.source,
      milestone: entry.milestone,
      source_path: entry.source_path,
      fingerprint: entry.fingerprint,
    });
    if (!candidate) {
      continue;
    }
    if (normalizedCurrentObjective && candidate.objective.toLowerCase() === normalizedCurrentObjective.toLowerCase()) {
      continue;
    }
    if (consumed.has(candidate.fingerprint)) {
      continue;
    }
    return candidate;
  }
  return null;
};

const splitCommaSeparatedValues = (value) => String(value || '')
  .split(',')
  .map((entry) => compact(entry))
  .filter((entry) => entry && entry.toLowerCase() !== 'none');

const extractAutomationRoute = (progressMarkdown, handoffMarkdown) => {
  const guidance = {
    ...extractKeyValueBullets(handoffMarkdown, 'Automation Route Guidance'),
    ...extractKeyValueBullets(progressMarkdown, 'Automation Route Guidance'),
  };
  const wrapping = {
    ...extractKeyValueBullets(handoffMarkdown, 'MCP Wrapping Guidance'),
    ...extractKeyValueBullets(progressMarkdown, 'MCP Wrapping Guidance'),
  };

  if (Object.keys(guidance).length === 0) {
    return null;
  }

  return {
    recommended_mode: guidance.recommended_mode || null,
    primary_path_type: guidance.primary_path_type || null,
    primary_surfaces: splitCommaSeparatedValues(guidance.primary_surfaces),
    fallback_surfaces: splitCommaSeparatedValues(guidance.fallback_surfaces),
    candidate_apis: splitCommaSeparatedValues(guidance.candidate_apis),
    candidate_mcp_tools: splitCommaSeparatedValues(guidance.candidate_mcp_tools),
    matched_examples: splitCommaSeparatedValues(guidance.matched_examples),
    escalation_required: parseMarkdownBoolean(guidance.escalation_required),
    escalation_target: guidance.escalation_target || null,
    escalation_reason: guidance.escalation_reason || null,
    auto_restart_on_release: parseMarkdownBoolean(guidance.auto_restart_on_release),
    local_pattern: wrapping.local_pattern || null,
    shared_pattern: wrapping.shared_pattern || null,
  };
};

/**
 * @param {Record<string, unknown> | null | undefined} resumeState
 */
export const buildContinuousLoopResumeIdentity = (resumeState = {}) => {
  if (!isRecord(resumeState)) {
    return null;
  }

  return compact(resumeState.session_id)
    || compact(resumeState.fingerprint)
    || null;
};

/**
 * @param {{
 *   resumeState?: Record<string, unknown> | null;
 *   resumeFromPackets?: boolean;
 *   autoRestartOnRelease?: boolean;
 *   forceResume?: boolean;
 *   gcpCapacityRecoveryRequested?: boolean;
 *   capacityBelowTarget?: boolean;
 *   lastResumeLaunchIdentity?: string | null;
 * }} params
 */
export const canLaunchContinuousLoopResume = ({
  resumeState,
  resumeFromPackets = false,
  autoRestartOnRelease = false,
  forceResume = false,
  gcpCapacityRecoveryRequested = false,
  capacityBelowTarget = false,
  lastResumeLaunchIdentity = null,
} = {}) => {
  const identity = buildContinuousLoopResumeIdentity(resumeState);
  const packetResumeEnabled = Boolean(resumeFromPackets || autoRestartOnRelease);
  if (!packetResumeEnabled || !compact(resumeState?.objective)) {
    return { allowed: false, identity };
  }

  const resumable = Boolean(
    resumeState?.resumable
    || forceResume
    || (gcpCapacityRecoveryRequested && capacityBelowTarget)
  );
  if (!resumable) {
    return { allowed: false, identity };
  }

  if (capacityBelowTarget) {
    return { allowed: true, identity };
  }

  if (!identity) {
    return { allowed: true, identity: null };
  }

  return {
    allowed: identity !== compact(lastResumeLaunchIdentity),
    identity,
  };
};

const buildResumeState = async (params = {}) => {
  const vaultRoot = resolveVaultRoot(params.vaultPath);
  const handoffTarget = resolveVaultTarget(vaultRoot, DEFAULT_HANDOFF_PACKET_PATH);
  const progressTarget = resolveVaultTarget(vaultRoot, DEFAULT_PROGRESS_PACKET_PATH);
  const handoffContent = readLocalVaultFile(handoffTarget);
  const progressContent = readLocalVaultFile(progressTarget);
  const objective = extractFrontmatterValue(progressContent, 'objective')
    || extractFrontmatterValue(handoffContent, 'objective')
    || extractFirstBullet(progressContent, 'Objective')
    || extractFirstBullet(handoffContent, 'Session Objective');
  const packetNextAction = extractFirstBullet(progressContent, 'Next Action');
  const escalationStatus = extractFirstBullet(progressContent, 'Escalation Status') || 'unknown';
  const ownerAndMode = extractKeyValueBullets(progressContent, 'Owner And Mode');
  const capacityEntries = extractKeyValueBullets(progressContent, 'Capacity State');
  const safeQueue = extractBulletLines(handoffContent, 'Safe Autonomous Queue For Hermes');
  const automationRoute = extractAutomationRoute(progressContent, handoffContent);
  const automationLifecycle = {
    ...extractKeyValueBullets(handoffContent, 'Automation Lifecycle Guidance'),
    ...extractKeyValueBullets(progressContent, 'Automation Lifecycle Guidance'),
  };
  const autoRestartOnRelease = parseMarkdownBoolean(automationLifecycle.auto_restart_on_release)
    ?? parseMarkdownBoolean(extractFrontmatterValue(progressContent, 'automation_auto_restart_on_release'))
    ?? parseMarkdownBoolean(extractFrontmatterValue(handoffContent, 'automation_auto_restart_on_release'))
    ?? automationRoute?.auto_restart_on_release
    ?? false;
  const gcpCapacityRecoveryRequested = Boolean(params.gcpCapacityRecoveryRequested);
  const nextAction = !gcpCapacityRecoveryRequested && isCapacityRecoveryNextAction(packetNextAction)
    ? WAIT_FOR_NEXT_GPT_ACTION
    : packetNextAction;
  const waitBoundary = String(nextAction || '').trim().toLowerCase() === WAIT_FOR_NEXT_GPT_ACTION;
  const resumable = Boolean(objective) && escalationStatus === 'none' && (!waitBoundary || gcpCapacityRecoveryRequested);

  let reason = null;
  if (!vaultRoot) {
    reason = 'missing_vault_root';
  } else if (!handoffContent && !progressContent) {
    reason = 'missing_continuity_packets';
  } else if (!objective) {
    reason = 'missing_packet_objective';
  } else if (escalationStatus !== 'none') {
    reason = `escalation_${escalationStatus}`;
  } else if (waitBoundary && gcpCapacityRecoveryRequested) {
    reason = 'operator_gcp_capacity_recovery_requested';
  } else if (waitBoundary) {
    reason = 'packet_waiting_for_next_gpt_objective';
  }

  const fingerprint = [
    objective || '',
    nextAction || '',
    escalationStatus || '',
    ownerAndMode.owner || '',
    ownerAndMode.mode || '',
    ...safeQueue,
  ].join('|');

  const packetState = {
    source: vaultRoot ? 'local-vault-mirror' : 'unavailable',
    available: Boolean(vaultRoot && progressContent && handoffContent),
    vault_root: vaultRoot,
    objective,
    next_action: nextAction,
    escalation_status: escalationStatus,
    owner: ownerAndMode.owner || null,
    mode: ownerAndMode.mode || null,
    resumable,
    reason,
    fingerprint: fingerprint || null,
    capacity: {
      target: parseMarkdownNumber(capacityEntries.target),
      current: parseMarkdownNumber(capacityEntries.current),
      gap: parseMarkdownNumber(capacityEntries.gap),
      reached: parseMarkdownBoolean(capacityEntries.reached),
      state: capacityEntries.state || null,
      loop_action: capacityEntries.loop_action || null,
      continue_recommended: parseMarkdownBoolean(capacityEntries.continue_recommended),
      primary_reason: capacityEntries.primary_reason || null,
    },
    gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    auto_restart_on_release: autoRestartOnRelease,
    safe_queue: safeQueue,
    automation_route: automationRoute,
    handoff_packet_path: handoffTarget?.absolutePath || null,
    handoff_packet_relative_path: handoffTarget?.relativePath || null,
    progress_packet_path: progressTarget?.absolutePath || null,
    progress_packet_relative_path: progressTarget?.relativePath || null,
  };

  const workstreamState = params.workstreamState || await readLatestWorkflowState({
    sessionPath: params.sessionPath,
    sessionId: params.sessionId,
    scope: params.scope,
    workflowName: 'openjarvis.unattended',
    runtimeLane: params.runtimeLane || DEFAULT_RUNTIME_LANE,
  });
  if (workstreamState?.ok && workstreamState.session) {
    const derived = deriveResumeStateFromWorkflowSession(workstreamState.session, {
      source: workstreamState.source === 'supabase' ? 'supabase-workstream' : 'local-workflow-file',
      gcpCapacityRecoveryRequested: Boolean(params.gcpCapacityRecoveryRequested),
      capacityTarget: params.capacityTarget,
      runtimeLane: params.runtimeLane || DEFAULT_RUNTIME_LANE,
      waitBoundaryAction: WAIT_FOR_NEXT_GPT_ACTION,
    });
    const mergedSafeQueue = Array.from(new Set([
      ...toStringArray(derived.safe_queue),
      ...safeQueue,
    ])).filter(Boolean);
    return {
      ...derived,
      fingerprint: [
        derived.objective || '',
        derived.next_action || '',
        derived.escalation_status || '',
        derived.owner || '',
        derived.mode || '',
        ...mergedSafeQueue,
      ].join('|') || null,
      safe_queue: mergedSafeQueue,
      vault_root: vaultRoot,
      handoff_packet_path: handoffTarget?.absolutePath || null,
      handoff_packet_relative_path: handoffTarget?.relativePath || null,
      progress_packet_path: progressTarget?.absolutePath || null,
      progress_packet_relative_path: progressTarget?.relativePath || null,
      packet_available: packetState.available,
      automation_route: packetState.automation_route,
      auto_restart_on_release: packetState.auto_restart_on_release,
    };
  }

  if (packetState.available && packetState.objective) {
    return packetState;
  }

  return packetState;
};

const sleepMs = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const findBalancedJsonEnd = (text, startIndex) => {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

export const parseJsonCommandOutput = (raw, fallback = null) => {
  const text = String(raw || '').trim();
  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fall through to mixed-output parsing.
  }

  let lastParsed = fallback;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '{' && char !== '[') {
      continue;
    }

    const endIndex = findBalancedJsonEnd(text, index);
    if (endIndex < 0) {
      continue;
    }

    const candidate = text.slice(index, endIndex + 1);
    try {
      lastParsed = JSON.parse(candidate);
      index = endIndex;
    } catch {
      // Keep scanning for the final JSON payload.
    }
  }

  return lastParsed;
};

const runVsCodeBridgeAction = (params) => {
  try {
    const args = ['--import', 'tsx', HERMES_VSCODE_BRIDGE_SCRIPT, `--action=${params.action}`];
    if (params.targetPath) {
      args.push(`--targetPath=${params.targetPath}`);
    }
    if (params.filePath) {
      args.push(`--filePath=${params.filePath}`);
    }
    if (params.packetPath) {
      args.push(`--packetPath=${params.packetPath}`);
    }
    if (params.vaultPath) {
      args.push(`--vaultPath=${params.vaultPath}`);
    }
    if (params.reason) {
      args.push(`--reason=${params.reason}`);
    }

    const stdout = execFileSync(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8').trim();
    return parseJsonCommandOutput(stdout, { ok: true, action: params.action });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '').trim()
      : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr || '').trim()
      : '';
    return {
      ok: false,
      action: params.action,
      error: stderr || stdout || (error instanceof Error ? error.message : String(error)),
    };
  }
};

const runHermesRuntimeControlAction = (params) => {
  try {
    const args = ['--import', 'tsx', HERMES_RUNTIME_CONTROL_SCRIPT, `--action=${params.action}`];
    if (params.objective) {
      args.push(`--objective=${params.objective}`);
    }
    if (Array.isArray(params.objectives) && params.objectives.length > 0) {
      args.push(`--objectives=${params.objectives.join(',')}`);
    }
    if (params.prompt) {
      args.push(`--prompt=${params.prompt}`);
    }
    if (params.chatMode) {
      args.push(`--chatMode=${params.chatMode}`);
    }
    if (Array.isArray(params.addFilePaths) && params.addFilePaths.length > 0) {
      args.push(`--addFilePaths=${params.addFilePaths.join(',')}`);
    }
    if (params.sessionPath) {
      args.push(`--sessionPath=${params.sessionPath}`);
    }
    if (params.vaultPath) {
      args.push(`--vaultPath=${params.vaultPath}`);
    }
    if (Number.isFinite(Number(params.capacityTarget))) {
      args.push(`--capacityTarget=${Number(params.capacityTarget)}`);
    }
    if (params.gcpCapacityRecoveryRequested) {
      args.push('--gcpCapacityRecovery=true');
    }
    if (params.runtimeLane) {
      args.push(`--runtimeLane=${params.runtimeLane}`);
    }
    if (params.maximize === true) {
      args.push('--maximize=true');
    }
    if (params.newWindow === true) {
      args.push('--newWindow=true');
    }
    if (params.reuseWindow === false) {
      args.push('--reuseWindow=false');
    }
    if (params.dryRun === true) {
      args.push('--dryRun=true');
    }

    const stdout = execFileSync(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8').trim();
    return parseJsonCommandOutput(stdout, { ok: true, action: params.action });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '').trim()
      : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr || '').trim()
      : '';
    return {
      ok: false,
      action: params.action,
      error: stderr || stdout || (error instanceof Error ? error.message : String(error)),
    };
  }
};

const maybeLaunchQueuedObjectiveChat = (params) => {
  if (!params.enabled || !params.launchPlan?.autonomous_candidate) {
    return null;
  }

  const queueResult = runHermesRuntimeControlAction({
    action: 'queue-objective',
    objective: params.launchPlan.objective,
    sessionPath: params.sessionPath,
    vaultPath: params.vaultPath,
    capacityTarget: params.capacityTarget,
    gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
    runtimeLane: params.runtimeLane,
  });

  const chatResult = runHermesRuntimeControlAction({
    action: 'chat-launch',
    objective: params.launchPlan.objective,
    sessionPath: params.sessionPath,
    vaultPath: params.vaultPath,
    capacityTarget: params.capacityTarget,
    gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
    runtimeLane: params.runtimeLane,
    addFilePaths: params.launchPlan.autonomous_candidate?.source_path
      ? [params.launchPlan.autonomous_candidate.source_path]
      : [],
    maximize: true,
    reuseWindow: true,
    dryRun: params.dryRun,
  });

  return {
    ok: Boolean(chatResult?.ok),
    queue_result: queueResult,
    chat_result: chatResult,
  };
};

const maybeAutoOpenResumePacket = (params) => {
  if (!params.enabled || !params.resumeState?.progress_packet_path || !params.resumeState?.vault_root) {
    return null;
  }

  return runVsCodeBridgeAction({
    action: 'open',
    targetPath: params.resumeState.progress_packet_path,
    packetPath: params.resumeState.handoff_packet_path || params.resumeState.progress_packet_path,
    vaultPath: params.resumeState.vault_root,
    reason: 'open active continuity progress packet for visible Hermes autopilot',
  });
};

const isProcessAlive = (pid) => {
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

const toRelative = (absolutePath) => path.relative(ROOT, absolutePath).replace(/\\/g, '/');

const loadLatestWorkflowPath = () => {
  try {
    const entries = fs.readdirSync(WORKFLOW_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(WORKFLOW_DIR, name);
        const stat = fs.statSync(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return entries[0]?.fullPath || null;
  } catch {
    return null;
  }
};

const resolveSessionPath = (summary, overridePath) => {
  const explicit = String(overridePath || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(ROOT, explicit);
  }

  const sessionPath = String(summary?.workflow?.session_path || '').trim();
  const resolvedSummaryPath = sessionPath ? path.resolve(ROOT, sessionPath) : null;
  const latestPath = loadLatestWorkflowPath();

  if (resolvedSummaryPath && latestPath) {
    return readMtimeMs(latestPath) > readMtimeMs(resolvedSummaryPath) ? latestPath : resolvedSummaryPath;
  }

  if (resolvedSummaryPath) {
    return resolvedSummaryPath;
  }

  return latestPath;
};

export const buildStatusPayload = async (params = {}) => {
  const summary = params.summary || readJsonFile(SUMMARY_PATH);
  const summarySessionRaw = String(summary?.workflow?.session_path || '').trim();
  const summarySessionPath = summarySessionRaw ? path.resolve(ROOT, summarySessionRaw) : null;
  const summarySessionId = String(summary?.workflow?.session_id || '').trim() || null;
  const sessionPath = resolveSessionPath(summary, params.sessionPath);
  const workstreamState = params.workstreamState || null;
  const resolvedWorkstreamState = workstreamState || await readLatestWorkflowState({
    sessionPath,
    sessionId: summarySessionId,
    scope: process.env.OPENJARVIS_SCOPE || 'interactive:goal',
    workflowName: 'openjarvis.unattended',
    runtimeLane: params.runtimeLane || DEFAULT_RUNTIME_LANE,
  });
  const session = resolvedWorkstreamState?.ok ? resolvedWorkstreamState.session : (sessionPath ? readJsonFile(sessionPath) : null);
  const effectiveSessionPath = resolvedWorkstreamState?.source === 'supabase'
    ? null
    : (resolvedWorkstreamState?.sessionPath || sessionPath);
  const latestLaunch = params.launch || readJsonFile(LATEST_INTERACTIVE_LAUNCH_PATH);
  const latestLoop = params.loopState || readJsonFile(LATEST_CONTINUITY_LOOP_PATH);
  const resumeState = params.resumeState || await buildResumeState({
    vaultPath: params.vaultPath,
    sessionPath: effectiveSessionPath,
    sessionId: summarySessionId,
    capacityTarget: params.capacityTarget,
    gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
    workstreamState: resolvedWorkstreamState,
    runtimeLane: params.runtimeLane || DEFAULT_RUNTIME_LANE,
  });
  const prefersLiveSession = Boolean(effectiveSessionPath && summarySessionPath && effectiveSessionPath !== summarySessionPath)
    || resolvedWorkstreamState?.source === 'supabase';
  const summaryMatchesSession = Boolean(summarySessionId && session?.session_id && summarySessionId === session.session_id);
  const steps = prefersLiveSession
    ? (Array.isArray(session?.steps) ? session.steps : [])
    : (Array.isArray(summary?.steps) ? summary.steps : []);
  const launchMatchesSession = Boolean(
    latestLaunch
    && session
    && String(latestLaunch.objective || '') === String(session?.metadata?.objective || '')
    && String(latestLaunch.scope || '') === String(session?.scope || '')
    && String(latestLaunch.stage || '') === String(session?.stage || '')
  );
  const runnerAlive = launchMatchesSession ? isProcessAlive(latestLaunch?.runner_pid) : null;
  const monitorAlive = launchMatchesSession ? isProcessAlive(latestLaunch?.monitor_pid) : null;
  const staleExecutionSuspected = Boolean(launchMatchesSession && session?.status === 'executing' && runnerAlive === false);
  const supervisorAlive = latestLoop?.supervisor_pid ? isProcessAlive(latestLoop.supervisor_pid) : false;
  const gcpNative = buildGcpNativeAutopilotContext();
  const gcpCapacityRecoveryRequested = Boolean(params.gcpCapacityRecoveryRequested);
  const events = Array.isArray(session?.events) ? session.events : [];
  const lastRecallRequest = (() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (compact(event?.event_type).toLowerCase() !== 'recall_request') {
        continue;
      }

      const payload = isRecord(event?.payload) ? event.payload : {};
      return {
        createdAt: toNullableString(event?.created_at),
        decisionReason: toNullableString(event?.decision_reason),
        evidenceId: toNullableString(event?.evidence_id),
        blockedAction: toNullableString(payload.blocked_action),
        nextAction: toNullableString(payload.next_action),
        requestedBy: toNullableString(payload.requested_by),
        runtimeLane: toNullableString(payload.runtime_lane)
          || toNullableString(session?.metadata?.runtime_lane)
          || (params.runtimeLane || DEFAULT_RUNTIME_LANE),
        failedStepNames: toStringArray(payload.failed_step_names),
      };
    }
    return null;
  })();
  const lastDecisionDistillate = (() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (compact(event?.event_type).toLowerCase() !== 'decision_distillate') {
        continue;
      }

      const payload = isRecord(event?.payload) ? event.payload : {};
      return {
        createdAt: toNullableString(event?.created_at),
        summary: toNullableString(event?.decision_reason),
        evidenceId: toNullableString(event?.evidence_id),
        nextAction: toNullableString(payload.next_action),
        runtimeLane: toNullableString(payload.runtime_lane)
          || toNullableString(session?.metadata?.runtime_lane)
          || (params.runtimeLane || DEFAULT_RUNTIME_LANE),
        sourceEvent: toNullableString(payload.source_event),
        promoteAs: toNullableString(payload.promote_as),
        tags: toStringArray(payload.tags),
      };
    }
    return null;
  })();
  const lastCapabilityDemands = (() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (compact(event?.event_type).toLowerCase() !== 'capability_demand') {
        continue;
      }

      const payload = isRecord(event?.payload) ? event.payload : {};
      const eventRuntimeLane = toNullableString(payload.runtime_lane)
        || toNullableString(session?.metadata?.runtime_lane)
        || (params.runtimeLane || DEFAULT_RUNTIME_LANE);
      const eventSourceEvent = toNullableString(payload.source_event);
      const eventTags = toStringArray(payload.tags);
      const rawDemands = Array.isArray(payload.demands) ? payload.demands : [];
      const demands = rawDemands.flatMap((entry) => {
        if (!isRecord(entry)) {
          return [];
        }

        const summary = toNullableString(entry.summary);
        if (!summary) {
          return [];
        }

        return [{
          createdAt: toNullableString(event?.created_at),
          summary,
          objective: toNullableString(entry.objective),
          missingCapability: toNullableString(entry.missing_capability),
          missingSource: toNullableString(entry.missing_source),
          failedOrInsufficientRoute: toNullableString(entry.failed_or_insufficient_route),
          cheapestEnablementPath: toNullableString(entry.cheapest_enablement_path),
          proposedOwner: toNullableString(entry.proposed_owner),
          evidenceRefs: toStringArray(entry.evidence_refs),
          recallCondition: toNullableString(entry.recall_condition),
          runtimeLane: toNullableString(entry.runtime_lane) || eventRuntimeLane,
          sourceEvent: toNullableString(entry.source_event) || eventSourceEvent,
          tags: toStringArray(entry.tags).length > 0 ? toStringArray(entry.tags) : eventTags,
        }];
      });

      if (demands.length > 0) {
        return demands;
      }
    }
    return [];
  })();
  const lastArtifactRefs = (() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (compact(event?.event_type).toLowerCase() !== 'artifact_ref') {
        continue;
      }

      const payload = isRecord(event?.payload) ? event.payload : {};
      const refs = Array.isArray(payload.refs) ? payload.refs : [];
      return refs.flatMap((entry) => {
        if (!isRecord(entry) || !compact(entry.locator)) {
          return [];
        }
        return [{
          createdAt: toNullableString(event?.created_at),
          locator: compact(entry.locator),
          refKind: toNullableString(entry.ref_kind) || 'other',
          title: toNullableString(entry.title),
          runtimeLane: toNullableString(payload.runtime_lane)
            || toNullableString(session?.metadata?.runtime_lane)
            || (params.runtimeLane || DEFAULT_RUNTIME_LANE),
          sourceStepName: toNullableString(payload.source_step_name),
          sourceEvent: toNullableString(payload.source_event),
        }];
      });
    }
    return [];
  })();
  const autonomousGoalCandidates = buildAutonomousGoalCandidates({
    resumeState,
    currentObjective: session?.metadata?.objective || null,
  });
  const hermesRuntime = buildHermesRuntimeReadiness({
    workflow: {
      source: resolvedWorkstreamState?.source || (effectiveSessionPath ? 'local-file' : 'unavailable'),
      auto_restart_on_release: session?.metadata?.auto_restart_on_release ?? resumeState?.auto_restart_on_release ?? null,
    },
    supervisor: {
      auto_select_queued_objective: Boolean(latestLoop?.auto_select_queued_objective),
      supervisor_alive: supervisorAlive,
    },
    resumeState,
    routing: resumeState?.automation_route || null,
    autonomousGoalCandidates,
    vscodeCli: {
      last_auto_open: latestLaunch?.vscode_bridge || latestLoop?.vscode_bridge || null,
    },
  });

  const statusPayload = {
    ok: Boolean(summary),
    summary_path: fs.existsSync(SUMMARY_PATH) ? toRelative(SUMMARY_PATH) : null,
    workflow: {
      session_id: session?.session_id || null,
      session_path: effectiveSessionPath ? toRelative(effectiveSessionPath) : null,
      source: resolvedWorkstreamState?.source || (effectiveSessionPath ? 'local-file' : 'unavailable'),
      runtime_lane: session?.metadata?.runtime_lane || params.runtimeLane || DEFAULT_RUNTIME_LANE,
      workflow_name: session?.workflow_name || null,
      status: session?.status || null,
      scope: session?.scope || null,
      stage: session?.stage || null,
      objective: session?.metadata?.objective || null,
      route_mode: session?.metadata?.route_mode || null,
      auto_restart_on_release: session?.metadata?.auto_restart_on_release ?? resumeState?.auto_restart_on_release ?? null,
      started_at: session?.started_at || null,
      completed_at: session?.completed_at || null,
      execution_health: staleExecutionSuspected ? 'stale-runner-missing' : null,
      lastRecallRequest,
      lastDecisionDistillate,
      lastCapabilityDemands,
      lastArtifactRefs,
    },
    launch: launchMatchesSession ? {
      manifest_path: toRelative(path.resolve(ROOT, latestLaunch.manifest_path || LATEST_INTERACTIVE_LAUNCH_PATH)),
      launched_at: latestLaunch.launched_at || null,
      runner_pid: latestLaunch.runner_pid || null,
      runner_alive: runnerAlive,
      monitor_pid: latestLaunch.monitor_pid || null,
      monitor_alive: monitorAlive,
      log_path: latestLaunch.log_path ? toRelative(path.resolve(ROOT, latestLaunch.log_path)) : null,
      continuous_loop: Boolean(latestLaunch.continuous_loop),
      resume_from_packets: Boolean(latestLaunch.resume_from_packets),
      vscode_bridge: latestLaunch.vscode_bridge || null,
    } : null,
    supervisor: latestLoop ? {
      status: latestLoop.status || null,
      supervisor_pid: latestLoop.supervisor_pid || null,
      supervisor_alive: supervisorAlive,
      auto_select_queued_objective: Boolean(latestLoop.auto_select_queued_objective),
      auto_launch_queued_chat: Boolean(latestLoop.auto_launch_queued_chat),
      started_at: latestLoop.started_at || null,
      stopped_at: latestLoop.stopped_at || null,
      stop_reason: latestLoop.stop_reason || null,
      launches_completed: latestLoop.launches_completed || 0,
      idle_checks: latestLoop.idle_checks || 0,
      last_reason: latestLoop.last_reason || null,
      objective_seed: latestLoop.objective_seed || null,
      resume_from_packets: Boolean(latestLoop.resume_from_packets),
      last_launch: latestLoop.last_launch || null,
      vscode_bridge: latestLoop.vscode_bridge || null,
    } : null,
    result: {
      final_status: prefersLiveSession ? session?.status || null : summary?.final_status || null,
      step_count: steps.length,
      failed_steps: steps.filter((step) => {
        const status = String(step?.status || '').toLowerCase();
        return !['pass', 'passed', 'running'].includes(status);
      }).length,
      latest_gate_decision: prefersLiveSession ? null : summary?.latest_gate_run?.decision || null,
      deploy_status: prefersLiveSession ? null : summary?.deploy?.status || null,
      stale_execution_suspected: staleExecutionSuspected,
    },
    capacity: null,
    resume_state: resumeState,
    automation_route: resumeState?.automation_route || null,
    continuity_packets: summaryMatchesSession ? (summary?.continuity_packets || null) : null,
    gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    gcp_native: gcpNative,
    hermes_runtime: hermesRuntime,
    autonomous_goal_candidates: autonomousGoalCandidates,
    vscode_cli: {
      last_auto_open: latestLaunch?.vscode_bridge || latestLoop?.vscode_bridge || null,
    },
    steps: steps.map((step) => {
      if (prefersLiveSession) {
        return {
          step_name: step?.step_name || null,
          status: step?.status || null,
          route_mode: step?.details?.route_mode || session?.metadata?.route_mode || null,
          agent_role: step?.agent_role || null,
          duration_ms: step?.duration_ms || null,
          error: step?.details?.error || null,
        };
      }

      return {
        step_name: step?.step_name || step?.script || null,
        status: step?.status || null,
        route_mode: step?.route_mode || null,
        agent_role: step?.agent_role || null,
        duration_ms: step?.duration_ms || null,
        error: step?.error || null,
      };
    }),
  };

  statusPayload.capacity = buildAutopilotCapacity({
    ...statusPayload,
    target: params.capacityTarget,
  });

  return statusPayload;
};

/**
 * @param {{
 *   status?: Record<string, unknown> | null;
 *   personalizationSnapshot?: Record<string, unknown> | null;
 * }} params
 */
export const buildSessionOpenBundle = ({ status, personalizationSnapshot = null } = {}) => {
  const workflow = isRecord(status?.workflow) ? status.workflow : {};
  const result = isRecord(status?.result) ? status.result : {};
  const capacity = isRecord(status?.capacity) ? status.capacity : {};
  const resumeState = isRecord(status?.resume_state) ? status.resume_state : {};
  const routing = isRecord(status?.automation_route)
    ? status.automation_route
    : (isRecord(resumeState.automation_route) ? resumeState.automation_route : {});
  const supervisor = isRecord(status?.supervisor) ? status.supervisor : {};
  const decision = isRecord(workflow.lastDecisionDistillate) ? workflow.lastDecisionDistillate : {};
  const recall = isRecord(workflow.lastRecallRequest) ? workflow.lastRecallRequest : {};
  const persistedCapabilityDemands = Array.isArray(workflow.lastCapabilityDemands)
    ? workflow.lastCapabilityDemands
      .filter((entry) => isRecord(entry) && compact(entry.summary))
      .slice(0, 6)
      .map((entry) => ({
        summary: compact(entry.summary),
        objective: toNullableString(entry.objective),
        missing_capability: toNullableString(entry.missingCapability),
        missing_source: toNullableString(entry.missingSource),
        failed_or_insufficient_route: toNullableString(entry.failedOrInsufficientRoute),
        cheapest_enablement_path: toNullableString(entry.cheapestEnablementPath),
        proposed_owner: toNullableString(entry.proposedOwner),
        evidence_refs: toStringArray(entry.evidenceRefs).slice(0, 4),
        recall_condition: toNullableString(entry.recallCondition),
      }))
    : [];
  const evidenceRefs = Array.isArray(workflow.lastArtifactRefs)
    ? workflow.lastArtifactRefs
      .filter((entry) => isRecord(entry) && compact(entry.locator))
      .slice(0, 5)
      .map((entry) => ({
        locator: compact(entry.locator),
        refKind: toNullableString(entry.refKind),
        title: toNullableString(entry.title),
        sourceStepName: toNullableString(entry.sourceStepName),
      }))
    : [];
  const personalization = isRecord(personalizationSnapshot) ? personalizationSnapshot : null;
  const personalizationEffective = isRecord(personalization?.effective) ? personalization.effective : {};
  const personalizationPersona = isRecord(personalization?.persona) ? personalization.persona : {};
  const personalizationPromptHints = toStringArray(personalization?.promptHints).slice(0, 4);
  const autonomousGoalCandidates = Array.isArray(status?.autonomous_goal_candidates)
    ? status.autonomous_goal_candidates
      .filter((entry) => isRecord(entry) && compact(entry.objective))
      .slice(0, 6)
      .map((entry) => ({
        objective: compact(entry.objective),
        source: toNullableString(entry.source),
        milestone: toNullableString(entry.milestone),
        source_path: toNullableString(entry.source_path),
      }))
    : [];
  const safeQueue = toStringArray(resumeState.safe_queue).slice(0, 6);
  const progressPacket = toNullableString(resumeState.progress_packet_relative_path);
  const handoffPacket = toNullableString(resumeState.handoff_packet_relative_path);
  const orchestration = buildSessionOpenOrchestrationGuidance({ routing, recall, result });
  const hermesRuntime = isRecord(status?.hermes_runtime)
    ? status.hermes_runtime
    : buildHermesRuntimeReadiness({
      workflow,
      supervisor,
      resumeState,
      routing,
      autonomousGoalCandidates,
      vscodeCli: isRecord(status?.vscode_cli) ? status.vscode_cli : {},
    });
  const activationTargetObjective = autonomousGoalCandidates[0]?.objective || toNullableString(workflow.objective);
  const activationPack = buildAutomationActivationPack({
    sourceSurface: 'session-open',
    objective: activationTargetObjective,
    matchedExampleIds: toStringArray(routing.matched_examples).slice(0, 6),
    candidateApis: toStringArray(routing.candidate_apis).slice(0, 6),
    primarySurfaces: toStringArray(routing.primary_surfaces).slice(0, 6),
    fallbackSurfaces: toStringArray(routing.fallback_surfaces).slice(0, 6),
    requiresDurableKnowledge: true,
  });
  const capabilityDemands = persistedCapabilityDemands.length > 0
    ? persistedCapabilityDemands
    : buildSessionOpenCapabilityDemands({
      workflow,
      routing,
      hermesRuntime,
      recall,
      capacity,
      evidenceRefs,
      autonomousGoalCandidates,
    });
  const compactBootstrap = buildCompactSessionBootstrap({
    workflow,
    hermesRuntime,
    decision,
    autonomousGoalCandidates,
    safeQueue,
    activationPack,
    progressPacket,
    handoffPacket,
    evidenceRefs,
  });

  return {
    bundle_version: 1,
    generated_at: new Date().toISOString(),
    summary_path: toNullableString(status?.summary_path),
    objective: toNullableString(workflow.objective),
    route_mode: toNullableString(workflow.route_mode),
    runtime_lane: toNullableString(workflow.runtime_lane),
    workflow: {
      session_id: toNullableString(workflow.session_id),
      source: toNullableString(workflow.source),
      status: toNullableString(workflow.status),
      scope: toNullableString(workflow.scope),
      stage: toNullableString(workflow.stage),
      started_at: toNullableString(workflow.started_at),
      completed_at: toNullableString(workflow.completed_at),
      execution_health: toNullableString(workflow.execution_health),
    },
    continuity: {
      owner: toNullableString(resumeState.owner),
      mode: toNullableString(resumeState.mode),
      next_action: toNullableString(resumeState.next_action),
      resumable: Boolean(resumeState.resumable),
      reason: toNullableString(resumeState.reason),
      escalation_status: toNullableString(resumeState.escalation_status),
      auto_restart_on_release: Boolean(resumeState.auto_restart_on_release ?? workflow.auto_restart_on_release),
      safe_queue: safeQueue,
      progress_packet: progressPacket,
      handoff_packet: handoffPacket,
    },
    autonomous_queue: {
      enabled: Boolean(supervisor.auto_select_queued_objective),
      candidates: autonomousGoalCandidates,
    },
    routing: {
      recommended_mode: toNullableString(routing.recommended_mode),
      primary_path_type: toNullableString(routing.primary_path_type),
      primary_surfaces: toStringArray(routing.primary_surfaces).slice(0, 6),
      fallback_surfaces: toStringArray(routing.fallback_surfaces).slice(0, 6),
      candidate_apis: toStringArray(routing.candidate_apis).slice(0, 6),
      matched_examples: toStringArray(routing.matched_examples).slice(0, 6),
      escalation_required: Boolean(routing.escalation_required),
      escalation_target: toNullableString(routing.escalation_target),
    },
    hermes_runtime: {
      target_role: toNullableString(hermesRuntime.target_role),
      current_role: toNullableString(hermesRuntime.current_role),
      readiness: toNullableString(hermesRuntime.readiness),
      can_continue_without_gpt_session: Boolean(hermesRuntime.can_continue_without_gpt_session),
      queue_enabled: Boolean(hermesRuntime.queue_enabled),
      supervisor_alive: Boolean(hermesRuntime.supervisor_alive),
      has_hot_state: Boolean(hermesRuntime.has_hot_state),
      local_operator_surface: Boolean(hermesRuntime.local_operator_surface),
      ide_handoff_observed: Boolean(hermesRuntime.ide_handoff_observed),
      queued_objectives_available: Boolean(hermesRuntime.queued_objectives_available),
      strengths: toStringArray(hermesRuntime.strengths).slice(0, 6),
      blockers: toStringArray(hermesRuntime.blockers).slice(0, 6),
      next_actions: toStringArray(hermesRuntime.next_actions).slice(0, 6),
      remediation_actions: Array.isArray(hermesRuntime.remediation_actions)
        ? hermesRuntime.remediation_actions
          .filter((entry) => isRecord(entry) && compact(entry.action_id))
          .slice(0, 6)
          .map((entry) => ({
            action_id: compact(entry.action_id),
            label: toNullableString(entry.label),
            description: toNullableString(entry.description),
            admin_route: isRecord(entry.admin_route)
              ? {
                method: toNullableString(entry.admin_route.method),
                path: toNullableString(entry.admin_route.path),
              }
              : null,
            mcp_tool: isRecord(entry.mcp_tool)
              ? {
                name: toNullableString(entry.mcp_tool.name),
              }
              : null,
            default_payload: isRecord(entry.default_payload) ? entry.default_payload : {},
            command_preview: toNullableString(entry.command_preview),
          }))
        : [],
    },
    activation_pack: {
      target_objective: toNullableString(activationPack.targetObjective),
      objective_class: toNullableString(activationPack.objectiveClass),
      summary: toNullableString(activationPack.summary),
      activate_first: toStringArray(activationPack.activateFirst).slice(0, 4),
      recommended_skills: Array.isArray(activationPack.recommendedSkills)
        ? activationPack.recommendedSkills
          .filter((entry) => isRecord(entry) && compact(entry.skillId))
          .slice(0, 4)
          .map((entry) => ({
            skill_id: compact(entry.skillId),
            reason: toNullableString(entry.reason),
          }))
        : [],
      read_next: toStringArray(activationPack.readNext).slice(0, 4),
      tool_calls: toStringArray(activationPack.toolCalls).slice(0, 4),
      commands: toStringArray(activationPack.commands).slice(0, 4),
      api_surfaces: toStringArray(activationPack.apiSurfaces).slice(0, 4),
      mcp_surfaces: toStringArray(activationPack.mcpSurfaces).slice(0, 4),
      fallback_order: toStringArray(activationPack.fallbackOrder).slice(0, 6),
    },
    orchestration,
    compact_bootstrap: compactBootstrap,
    decision: {
      summary: toNullableString(decision.summary),
      next_action: toNullableString(decision.nextAction),
      promote_as: toNullableString(decision.promoteAs),
      tags: toStringArray(decision.tags).slice(0, 6),
    },
    recall: {
      decision_reason: toNullableString(recall.decisionReason),
      blocked_action: toNullableString(recall.blockedAction),
      next_action: toNullableString(recall.nextAction),
      failed_step_names: toStringArray(recall.failedStepNames).slice(0, 6),
    },
    evidence_refs: evidenceRefs,
    capability_demands: capabilityDemands,
    capacity: {
      score: Number.isFinite(Number(capacity.score)) ? Number(capacity.score) : null,
      target: Number.isFinite(Number(capacity.target)) ? Number(capacity.target) : null,
      state: toNullableString(capacity.state),
      loop_action: toNullableString(capacity.loop_action),
      primary_reason: toNullableString(capacity.primary_reason),
      continue_recommended: Boolean(capacity.continue_recommended),
    },
    supervisor: {
      status: toNullableString(supervisor.status),
      launches_completed: Number.isFinite(Number(supervisor.launches_completed)) ? Number(supervisor.launches_completed) : 0,
      stop_reason: toNullableString(supervisor.stop_reason),
      last_launch_source: isRecord(supervisor.last_launch) ? toNullableString(supervisor.last_launch.source) : null,
      last_launch_at: isRecord(supervisor.last_launch) ? toNullableString(supervisor.last_launch.launched_at) : null,
    },
    result: {
      final_status: toNullableString(result.final_status),
      step_count: Number.isFinite(Number(result.step_count)) ? Number(result.step_count) : 0,
      failed_steps: Number.isFinite(Number(result.failed_steps)) ? Number(result.failed_steps) : 0,
      latest_gate_decision: toNullableString(result.latest_gate_decision),
      deploy_status: toNullableString(result.deploy_status),
      stale_execution_suspected: Boolean(result.stale_execution_suspected),
    },
    personalization: personalization ? {
      priority: toNullableString(personalizationEffective.priority),
      provider_profile: toNullableString(personalizationEffective.providerProfile),
      retrieval_profile: toNullableString(personalizationEffective.retrievalProfile),
      communication_style: toNullableString(personalizationPersona.communicationStyle),
      preferred_topics: toStringArray(personalizationPersona.preferredTopics).slice(0, 4),
      prompt_hints: personalizationPromptHints,
    } : null,
    read_first: uniqueCompactStrings([
      toNullableString(hermesRuntime.readiness) ? `hermes-runtime:${hermesRuntime.readiness}` : null,
      progressPacket ? `progress-packet:${progressPacket}` : null,
      handoffPacket ? `handoff-packet:${handoffPacket}` : null,
      status?.summary_path ? `unattended-summary:${status.summary_path}` : null,
      autonomousGoalCandidates[0]?.objective ? `next-objective:${autonomousGoalCandidates[0].objective}` : null,
      toNullableString(decision.summary) ? `decision-distillate:${decision.summary}` : null,
      evidenceRefs[0]?.locator ? `artifact:${evidenceRefs[0].locator}` : null,
      personalizationPromptHints[0] ? `personalization:${personalizationPromptHints[0]}` : null,
    ]).slice(0, 6),
    recall_triggers: uniqueCompactStrings([
      toNullableString(recall.blockedAction) ? `blocked-action:${recall.blockedAction}` : null,
      toNullableString(recall.nextAction) ? `recall-next-action:${recall.nextAction}` : null,
      compact(resumeState.escalation_status).toLowerCase() && compact(resumeState.escalation_status).toLowerCase() !== 'none'
        ? `escalation-status:${resumeState.escalation_status}`
        : null,
      toNullableString(capacity.primary_reason) ? `capacity:${capacity.primary_reason}` : null,
    ]).slice(0, 6),
  };
};

export const buildGoalCycleLaunchArgs = (params) => ([
  SELF_SCRIPT,
  ...(params.objective ? [`--objective=${params.objective}`] : []),
  `--dryRun=${params.dryRun}`,
  `--autoDeploy=${params.autoDeploy}`,
  `--strict=${params.strict}`,
  `--routeMode=${params.routeMode}`,
  `--scope=${params.scope}`,
  `--stage=${params.stage}`,
  `--runtimeLane=${params.runtimeLane}`,
  `--autoRestartOnRelease=${params.autoRestartOnRelease}`,
  ...(params.resumeFromPackets ? ['--resumeFromPackets=true'] : []),
  ...(params.forceResume ? ['--forceResume=true'] : []),
  ...(params.continuousLoop ? ['--continuousLoop=true'] : []),
  ...(params.vaultPath ? [`--vaultPath=${params.vaultPath}`] : []),
  ...(params.idleSeconds ? [`--idleSeconds=${params.idleSeconds}`] : []),
  ...(params.maxCycles ? [`--maxCycles=${params.maxCycles}`] : []),
  ...(params.maxIdleChecks ? [`--maxIdleChecks=${params.maxIdleChecks}`] : []),
  ...(params.capacityTarget ? [`--capacityTarget=${params.capacityTarget}`] : []),
  ...(params.continueUntilCapacity ? ['--continueUntilCapacity=true'] : []),
  ...(params.gcpCapacityRecoveryRequested ? ['--gcpCapacityRecovery=true'] : []),
  ...(params.autoSelectQueuedObjective ? ['--autoSelectQueuedObjective=true'] : []),
  ...(params.autoLaunchQueuedChat ? ['--autoLaunchQueuedChat=true'] : []),
  ...(params.autoOpenResumePacket ? ['--autoOpenResumePacket=true'] : []),
  '--visibleTerminal=false',
]);

const buildUnderlyingRunArgs = (params) => ([
  RUN_SCRIPT,
  `--objective=${params.objective}`,
  `--dryRun=${params.dryRun}`,
  `--autoDeploy=${params.autoDeploy}`,
  `--strict=${params.strict}`,
  `--routeMode=${params.routeMode}`,
  `--runtimeLane=${params.runtimeLane}`,
  `--autoRestartOnRelease=${params.autoRestartOnRelease}`,
]);

const launchVisibleWindowsPowerShell = (params) => {
  ensureDirectory(LAUNCHES_DIR);
  const title = `Hermes Autopilot: ${String(params.objective || 'interactive goal').slice(0, 72)}`;
  const launchId = `interactive-goal-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const manifestPath = path.join(LAUNCHES_DIR, `${launchId}.json`);
  const logPath = path.join(LAUNCHES_DIR, `${launchId}.log`);
  const nodeArgs = buildGoalCycleLaunchArgs(params);
  fs.writeFileSync(logPath, '', 'utf8');
  const vscodeBridge = maybeAutoOpenResumePacket({
    enabled: params.autoOpenResumePacket,
    resumeState: params.resumeState,
  });

  const detachedRunnerCommand = [
    `Set-Location -LiteralPath ${quotePowerShellLiteral(ROOT)}`,
    `& ${quotePowerShellLiteral(process.execPath)} ${nodeArgs.map(quotePowerShellLiteral).join(' ')} *>> ${quotePowerShellLiteral(logPath)}`,
  ].join('; ');
  const runnerStartCommand = [
    '$process = Start-Process -FilePath powershell.exe',
    `-ArgumentList @(${quotePowerShellLiteral('-NoLogo')}, ${quotePowerShellLiteral('-NoProfile')}, ${quotePowerShellLiteral('-Command')}, ${quotePowerShellLiteral(detachedRunnerCommand)})`,
    `-WorkingDirectory ${quotePowerShellLiteral(ROOT)}`,
    '-WindowStyle Hidden',
    '-PassThru',
    ';',
    '$process.Id',
  ].join(' ');

  const inlineCommand = [
    `Set-Location -LiteralPath ${quotePowerShellLiteral(ROOT)}`,
    `$Host.UI.RawUI.WindowTitle = ${quotePowerShellLiteral(title)}`,
    `Write-Host ${quotePowerShellLiteral(`Hermes runner log: ${toRelative(logPath)}`)}`,
    `Write-Host ${quotePowerShellLiteral('Status: npm run openjarvis:goal:status')}`,
    `Get-Content -LiteralPath ${quotePowerShellLiteral(logPath)} -Wait`,
  ].join('; ');
  const startProcessCommand = [
    '$process = Start-Process -FilePath powershell.exe',
    `-ArgumentList @(${quotePowerShellLiteral('-NoLogo')}, ${quotePowerShellLiteral('-NoExit')}, ${quotePowerShellLiteral('-Command')}, ${quotePowerShellLiteral(inlineCommand)})`,
    `-WorkingDirectory ${quotePowerShellLiteral(ROOT)}`,
    '-PassThru',
    ';',
    '$process.Id',
  ].join(' ');

  try {
    const runnerOutput = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', runnerStartCommand], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
    });
    const runnerPid = Number.parseInt(String(runnerOutput || '').trim().split(/\s+/).pop() || '', 10);

    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', startProcessCommand], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      windowsHide: false,
    });
    const monitorPid = Number.parseInt(String(output || '').trim().split(/\s+/).pop() || '', 10);
    const manifest = {
      launch_id: launchId,
      launched_at: new Date().toISOString(),
      objective: params.objective,
      scope: params.scope,
      stage: params.stage,
      runtime_lane: params.runtimeLane,
      route_mode: params.routeMode,
      dry_run: params.dryRun,
      auto_deploy: params.autoDeploy,
      strict: params.strict,
      continuous_loop: Boolean(params.continuousLoop),
      auto_restart_on_release: Boolean(params.autoRestartOnRelease),
      continue_until_capacity: Boolean(params.continueUntilCapacity),
      capacity_target: params.capacityTarget,
      gcp_capacity_recovery_requested: Boolean(params.gcpCapacityRecoveryRequested),
      auto_select_queued_objective: Boolean(params.autoSelectQueuedObjective),
      auto_launch_queued_chat: Boolean(params.autoLaunchQueuedChat),
      resume_from_packets: Boolean(params.resumeFromPackets),
      force_resume: Boolean(params.forceResume),
      runner_pid: Number.isFinite(runnerPid) ? runnerPid : null,
      monitor_pid: Number.isFinite(monitorPid) ? monitorPid : null,
      log_path: logPath,
      manifest_path: manifestPath,
      vscode_bridge: vscodeBridge,
    };
    writeJsonFile(manifestPath, manifest);
    writeJsonFile(LATEST_INTERACTIVE_LAUNCH_PATH, manifest);

    return {
      ok: true,
      exit_code: 0,
      launched_visible_terminal: true,
      terminal_kind: 'powershell',
      terminal_pid: Number.isFinite(monitorPid) ? monitorPid : null,
      runner_pid: Number.isFinite(runnerPid) ? runnerPid : null,
      manifest_path: toRelative(manifestPath),
      log_path: toRelative(logPath),
      launch_title: title,
      continuous_loop: Boolean(params.continuousLoop),
      auto_restart_on_release: Boolean(params.autoRestartOnRelease),
      auto_launch_queued_chat: Boolean(params.autoLaunchQueuedChat),
      resume_from_packets: Boolean(params.resumeFromPackets),
      vscode_bridge: vscodeBridge,
    };
  } catch (error) {
    const exitCode = Number(error?.status || error?.code || 1);
    return {
      ok: false,
      exit_code: Number.isFinite(exitCode) ? exitCode : 1,
      error: error instanceof Error ? error.message : String(error),
      launched_visible_terminal: false,
      terminal_kind: 'powershell',
      terminal_pid: null,
      runner_pid: null,
      manifest_path: null,
      log_path: null,
      launch_title: title,
      continuous_loop: Boolean(params.continuousLoop),
      auto_restart_on_release: Boolean(params.autoRestartOnRelease),
      auto_launch_queued_chat: Boolean(params.autoLaunchQueuedChat),
      resume_from_packets: Boolean(params.resumeFromPackets),
      vscode_bridge: vscodeBridge,
    };
  }
};

const isWorkflowActive = (statusPayload) => ACTIVE_WORKFLOW_STATES.has(String(statusPayload?.workflow?.status || '').toLowerCase());

const runContinuousLoop = async (params) => {
  ensureDirectory(LAUNCHES_DIR);
  const loopState = {
    status: 'running',
    started_at: new Date().toISOString(),
    supervisor_pid: process.pid,
    scope: params.scope,
    stage: params.stage,
    route_mode: params.routeMode,
    runtime_lane: params.runtimeLane || null,
    objective_seed: params.objective || null,
    resume_from_packets: Boolean(params.resumeFromPackets),
    force_resume: Boolean(params.forceResume),
    idle_seconds: params.idleSeconds,
    max_cycles: serializeLoopLimit(params.maxCycles),
    max_idle_checks: serializeLoopLimit(params.maxIdleChecks),
    max_cycles_unbounded: !Number.isFinite(params.maxCycles),
    max_idle_checks_unbounded: !Number.isFinite(params.maxIdleChecks),
    auto_restart_on_release: Boolean(params.autoRestartOnRelease),
    continue_until_capacity: Boolean(params.continueUntilCapacity),
    capacity_target: params.capacityTarget,
    gcp_capacity_recovery_requested: Boolean(params.gcpCapacityRecoveryRequested),
    auto_select_queued_objective: Boolean(params.autoSelectQueuedObjective),
    auto_launch_queued_chat: Boolean(params.autoLaunchQueuedChat),
    launches_completed: 0,
    idle_checks: 0,
    last_reason: null,
    last_launch: null,
    last_capacity: null,
    autonomous_goal_candidates: [],
    autonomous_launch_history: [],
    queued_chat_launch: null,
    awaiting_reentry_acknowledgment: false,
    reentry_acknowledgment: null,
    vscode_bridge: params.vscodeBridge || null,
  };
  writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);

  let launchesCompleted = 0;
  let idleChecks = 0;
  let lastResumeLaunchIdentity = null;
  const launchedAutonomousFingerprints = new Set();
  let explicitObjectiveConsumed = !params.objective;
  let stopReason = 'max_idle_checks_reached';

  while (launchesCompleted < params.maxCycles && idleChecks < params.maxIdleChecks) {
    const resumeState = await buildResumeState({
      vaultPath: params.vaultPath,
      sessionPath: params.sessionPath || null,
      capacityTarget: params.capacityTarget,
      gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
      runtimeLane: params.runtimeLane,
    });
    const status = await buildStatusPayload({
      sessionPath: params.sessionPath || null,
      resumeState,
      vaultPath: params.vaultPath,
      capacityTarget: params.capacityTarget,
      gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
      runtimeLane: params.runtimeLane,
    });
    loopState.resume_state = resumeState;
    loopState.idle_checks = idleChecks;
    loopState.launches_completed = launchesCompleted;
    loopState.last_capacity = status.capacity || null;
    loopState.autonomous_goal_candidates = Array.isArray(status.autonomous_goal_candidates)
      ? status.autonomous_goal_candidates
      : [];

    if (isWorkflowActive(status)) {
      loopState.last_reason = 'workflow-active';
      writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
      idleChecks = 0;
      await sleepMs(params.idleSeconds * 1000);
      continue;
    }

    const capacityBelowTarget = Boolean(params.continueUntilCapacity && status.capacity && !status.capacity.reached);
    const gcpCapacityRecoveryRequested = Boolean(params.gcpCapacityRecoveryRequested);
    const queuedCandidate = params.autoSelectQueuedObjective && status.capacity?.loop_action !== 'escalate'
      ? pickAutonomousGoalCandidate({
        candidates: status.autonomous_goal_candidates,
        consumedFingerprints: Array.from(launchedAutonomousFingerprints),
        currentObjective: resumeState.objective || status.workflow?.objective || params.objective || null,
      })
      : null;
    const preferQueuedCandidate = Boolean(
      queuedCandidate
      && !capacityBelowTarget
      && !gcpCapacityRecoveryRequested
      && compact(resumeState.reason) === 'workstream_auto_restart_ready'
      && normalizeAutonomousGoalObjective(queuedCandidate.objective) !== normalizeAutonomousGoalObjective(resumeState.objective || status.workflow?.objective || params.objective || null),
    );
    const resumeLaunchDecision = canLaunchContinuousLoopResume({
      resumeState,
      resumeFromPackets: params.resumeFromPackets,
      autoRestartOnRelease: Boolean(params.autoRestartOnRelease || resumeState.auto_restart_on_release),
      forceResume: params.forceResume,
      gcpCapacityRecoveryRequested,
      capacityBelowTarget,
      lastResumeLaunchIdentity,
    });

    let launchPlan = null;
    if (!explicitObjectiveConsumed && params.objective) {
      launchPlan = {
        objective: params.objective,
        source: 'explicit-objective',
        fingerprint: `explicit:${params.objective}`,
      };
      explicitObjectiveConsumed = true;
    } else if (preferQueuedCandidate && queuedCandidate) {
      launchPlan = {
        objective: queuedCandidate.objective,
        source: queuedCandidate.source || 'autonomous-queue',
        fingerprint: queuedCandidate.fingerprint,
        autonomous_candidate: queuedCandidate,
      };
    } else if (resumeLaunchDecision.allowed && resumeState.objective) {
      launchPlan = {
        objective: resumeState.objective,
        source: gcpCapacityRecoveryRequested && capacityBelowTarget && !resumeState.resumable
          ? 'operator-gcp-capacity-recovery'
          : (capacityBelowTarget && resumeLaunchDecision.identity === compact(lastResumeLaunchIdentity)
            ? 'capacity-packet-repeat'
            : (params.forceResume && !resumeState.resumable ? 'forced-packet-resume' : 'packet-resume')),
        fingerprint: resumeLaunchDecision.identity || resumeState.fingerprint || `resume:${resumeState.objective}`,
        resume_launch_identity: resumeLaunchDecision.identity,
      };
    } else if (capacityBelowTarget && params.objective) {
      launchPlan = {
        objective: params.objective,
        source: 'capacity-explicit-repeat',
        fingerprint: `explicit:${params.objective}`,
      };
    } else if (queuedCandidate) {
      if (queuedCandidate) {
        launchPlan = {
          objective: queuedCandidate.objective,
          source: queuedCandidate.source || 'autonomous-queue',
          fingerprint: queuedCandidate.fingerprint,
          autonomous_candidate: queuedCandidate,
        };
      }
    }

    if (launchPlan) {
      let queuedChatLaunch = null;
      if (params.autoLaunchQueuedChat && launchPlan.autonomous_candidate) {
        queuedChatLaunch = maybeLaunchQueuedObjectiveChat({
          enabled: true,
          launchPlan,
          sessionPath: params.sessionPath || null,
          vaultPath: params.vaultPath || null,
          capacityTarget: params.capacityTarget,
          gcpCapacityRecoveryRequested,
          runtimeLane: params.runtimeLane,
          dryRun: params.dryRun,
        });
        loopState.queued_chat_launch = queuedChatLaunch;
      } else {
        loopState.queued_chat_launch = null;
      }

      if (queuedChatLaunch?.ok) {
        launchesCompleted += 1;
        if (launchPlan.autonomous_candidate?.fingerprint) {
          launchedAutonomousFingerprints.add(launchPlan.autonomous_candidate.fingerprint);
          loopState.autonomous_launch_history = Array.from(launchedAutonomousFingerprints).slice(-12);
        }
        loopState.launches_completed = launchesCompleted;
        loopState.idle_checks = idleChecks;
        loopState.last_reason = 'queued-chat-launched';
        loopState.last_launch = {
          launched_at: new Date().toISOString(),
          objective: launchPlan.objective,
          source: `${launchPlan.source}:vscode-chat`,
          fingerprint: launchPlan.fingerprint,
          milestone: launchPlan.autonomous_candidate?.milestone || null,
          session_id: status.workflow?.session_id || null,
          session_path: status.workflow?.session_path || null,
          runtime_lane: status.workflow?.runtime_lane || params.runtimeLane || null,
          handoff_packet_path: resumeState?.handoff_packet_path || null,
          progress_packet_path: resumeState?.progress_packet_path || null,
          awaiting_reentry_acknowledgment: true,
          reentry_acknowledgment: null,
          ok: true,
          exit_code: 0,
          error: null,
          chat_launch: queuedChatLaunch.chat_result || null,
          queue_sync_ok: queuedChatLaunch.queue_result?.ok === true,
        };
        loopState.awaiting_reentry_acknowledgment = true;
        loopState.reentry_acknowledgment = null;
        writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
        stopReason = 'queued_chat_launched';
        break;
      }

      const run = runGoalCycle({
        objective: launchPlan.objective,
        dryRun: params.dryRun,
        autoDeploy: params.autoDeploy,
        strict: params.strict,
        routeMode: params.routeMode,
        scope: params.scope,
        stage: params.stage,
        runtimeLane: params.runtimeLane,
        autoRestartOnRelease: params.autoRestartOnRelease,
        gcpCapacityRecoveryRequested,
      });
      launchesCompleted += 1;
      if (launchPlan.autonomous_candidate?.fingerprint) {
        launchedAutonomousFingerprints.add(launchPlan.autonomous_candidate.fingerprint);
        loopState.autonomous_launch_history = Array.from(launchedAutonomousFingerprints).slice(-12);
      }
      const refreshedResumeState = await buildResumeState({ vaultPath: params.vaultPath, gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested, capacityTarget: params.capacityTarget, runtimeLane: params.runtimeLane });
      if (launchPlan.resume_launch_identity || launchPlan.source === 'packet-resume' || launchPlan.source === 'forced-packet-resume' || launchPlan.source === 'capacity-packet-repeat' || launchPlan.source === 'operator-gcp-capacity-recovery') {
        lastResumeLaunchIdentity = launchPlan.resume_launch_identity || launchPlan.fingerprint;
      }
      loopState.launches_completed = launchesCompleted;
      loopState.idle_checks = idleChecks;
      loopState.last_reason = run.ok ? 'launched' : 'launch-failed';
      loopState.last_launch = {
        launched_at: new Date().toISOString(),
        objective: launchPlan.objective,
        source: launchPlan.source,
        fingerprint: launchPlan.fingerprint,
        milestone: launchPlan.autonomous_candidate?.milestone || null,
        ok: run.ok,
        exit_code: run.exit_code,
        error: run.error || null,
        queued_chat_launch: queuedChatLaunch || null,
      };
      writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
      if (!run.ok) {
        stopReason = 'launch_failed';
        break;
      }
      idleChecks = 0;
      await sleepMs(1000);
      continue;
    }

    if (status.capacity?.loop_action === 'escalate') {
      stopReason = status.capacity.primary_reason || 'capacity_blocked';
      loopState.last_reason = stopReason;
      writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
      break;
    }

    if (status.capacity?.loop_action === 'wait') {
      stopReason = status.capacity.primary_reason || 'waiting_for_next_gpt_objective';
      loopState.last_reason = stopReason;
      writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
      break;
    }

    if (params.continueUntilCapacity && status.capacity?.reached) {
      stopReason = status.capacity.primary_reason || 'capacity_target_reached';
      loopState.last_reason = stopReason;
      writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
      break;
    }

    idleChecks += 1;
    loopState.idle_checks = idleChecks;
    loopState.last_reason = resumeState.reason || 'idle';
    writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);
    await sleepMs(params.idleSeconds * 1000);
  }

  if (launchesCompleted >= params.maxCycles) {
    stopReason = 'max_cycles_reached';
  } else if (idleChecks >= params.maxIdleChecks) {
    stopReason = 'max_idle_checks_reached';
  }

  loopState.status = 'stopped';
  loopState.stopped_at = new Date().toISOString();
  loopState.stop_reason = stopReason;
  loopState.idle_checks = idleChecks;
  loopState.launches_completed = launchesCompleted;
  writeJsonFile(LATEST_CONTINUITY_LOOP_PATH, loopState);

  return {
    ok: true,
    continuous_loop: true,
    stop_reason: stopReason,
    launches_completed: launchesCompleted,
    idle_checks: idleChecks,
    loop_state_path: toRelative(LATEST_CONTINUITY_LOOP_PATH),
  };
};

const runGoalCycle = (params) => {
  const env = {
    ...process.env,
    OPENJARVIS_SCOPE: params.scope,
    OPENJARVIS_STAGE: params.stage,
    OPENJARVIS_RUNTIME_LANE: params.runtimeLane,
    OPENJARVIS_AUTO_RESTART_ON_RELEASE: params.autoRestartOnRelease ? 'true' : 'false',
    ...(params.gcpCapacityRecoveryRequested ? { HERMES_AUTOPILOT_GCP_CAPACITY_RECOVERY: 'true' } : {}),
  };
  const args = buildUnderlyingRunArgs(params);

  try {
    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/d', '/s', '/c', 'node', ...args], {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
    } else {
      execFileSync('node', args, {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
    }
    return { ok: true, exit_code: 0 };
  } catch (error) {
    const exitCode = Number(error?.status || error?.code || 1);
    return {
      ok: false,
      exit_code: Number.isFinite(exitCode) ? exitCode : 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async () => {
  const statusOnly = parseBool(parseArg('status', 'false'), false);
  const sessionOpenBundleOnly = parseBool(parseArg('sessionOpenBundle', 'false'), false);
  const sessionPath = parseArg('sessionPath', '');
  const vaultPath = parseArg('vaultPath', '');
  const capacityTarget = normalizeCapacityTarget(parseArg('capacityTarget', process.env.HERMES_AUTOPILOT_CAPACITY_TARGET || String(DEFAULT_CAPACITY_TARGET)));
  const gcpCapacityRecoveryRequested = parseBool(parseArg('gcpCapacityRecovery', process.env.HERMES_AUTOPILOT_GCP_CAPACITY_RECOVERY || 'false'), false);

  if (statusOnly) {
    console.log(JSON.stringify(await buildStatusPayload({
      sessionPath: sessionPath || null,
      vaultPath: vaultPath || null,
      capacityTarget,
      gcpCapacityRecoveryRequested,
    }), null, 2));
    return;
  }

  if (sessionOpenBundleOnly) {
    const status = await buildStatusPayload({
      sessionPath: sessionPath || null,
      vaultPath: vaultPath || null,
      capacityTarget,
      gcpCapacityRecoveryRequested,
    });
    console.log(JSON.stringify(buildSessionOpenBundle({ status }), null, 2));
    return;
  }

  const requestedObjective = String(parseArg('objective', '')).trim();

  const dryRun = parseBool(parseArg('dryRun', 'true'), true);
  const autoDeploy = parseBool(parseArg('autoDeploy', 'false'), false);
  const strict = parseBool(parseArg('strict', 'true'), true);
  const resumeFromPackets = parseBool(parseArg('resumeFromPackets', 'false'), false);
  const forceResume = parseBool(parseArg('forceResume', 'false'), false);
  const continuousLoop = parseBool(parseArg('continuousLoop', 'false'), false);
  const autoRestartOnRelease = parseBool(parseArg('autoRestartOnRelease', continuousLoop ? 'true' : (process.env.OPENJARVIS_AUTO_RESTART_ON_RELEASE || 'false')), continuousLoop);
  const continueUntilCapacity = parseBool(parseArg('continueUntilCapacity', 'false'), false);
  const autoSelectQueuedObjective = parseBool(parseArg('autoSelectQueuedObjective', process.env.OPENJARVIS_AUTO_SELECT_QUEUED_OBJECTIVE || 'false'), false);
  const autoLaunchQueuedChat = parseBool(parseArg('autoLaunchQueuedChat', process.env.OPENJARVIS_AUTO_LAUNCH_QUEUED_CHAT || 'false'), false);
  const idleSeconds = Math.max(10, Number.parseInt(String(parseArg('idleSeconds', '45')).trim(), 10) || 45);
  const maxCycles = normalizeLoopLimit(parseArg('maxCycles', continuousLoop ? '3' : '1'), continuousLoop ? 3 : 1);
  const maxIdleChecks = normalizeLoopLimit(parseArg('maxIdleChecks', continuousLoop ? '120' : '1'), continuousLoop ? 120 : 1);
  const requestedRouteMode = String(parseArg('routeMode', process.env.OPENJARVIS_ROUTE_MODE || 'auto')).trim() || 'auto';
  const routeMode = resolveGoalCycleRouteMode(requestedRouteMode, gcpCapacityRecoveryRequested);
  const scope = String(parseArg('scope', process.env.OPENJARVIS_SCOPE || 'interactive:goal')).trim() || 'interactive:goal';
  const stage = String(parseArg('stage', process.env.OPENJARVIS_STAGE || 'interactive')).trim() || 'interactive';
  const runtimeLane = String(parseArg('runtimeLane', process.env.OPENJARVIS_RUNTIME_LANE || DEFAULT_RUNTIME_LANE)).trim() || DEFAULT_RUNTIME_LANE;
  const visibleTerminalDefault = process.platform === 'win32' && scope === 'interactive:goal';
  const visibleTerminal = parseBool(parseArg('visibleTerminal', visibleTerminalDefault ? 'true' : 'false'), visibleTerminalDefault);
  const resumeState = await buildResumeState({
    vaultPath: vaultPath || null,
    sessionPath: sessionPath || null,
    capacityTarget,
    gcpCapacityRecoveryRequested,
    runtimeLane,
  });
  const autoOpenResumePacketDefault = process.platform === 'win32' && visibleTerminal && (resumeFromPackets || continuousLoop);
  const autoOpenResumePacket = parseBool(parseArg('autoOpenResumePacket', autoOpenResumePacketDefault ? 'true' : 'false'), autoOpenResumePacketDefault);

  let objective = requestedObjective;
  if (!objective && resumeFromPackets && !continuousLoop) {
    objective = String(resumeState.objective || '').trim();
  }

  if (!objective && !continuousLoop) {
    console.error(JSON.stringify({
      ok: false,
      error: 'objective is required unless resumeFromPackets or continuousLoop is enabled',
      resume_state: resumeState,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (continuousLoop && !objective && !resumeFromPackets) {
    console.error(JSON.stringify({
      ok: false,
      error: 'continuousLoop requires an explicit objective or resumeFromPackets=true',
      resume_state: resumeState,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (
    resumeFromPackets
    && !requestedObjective
    && !continuousLoop
    && !forceResume
    && !gcpCapacityRecoveryRequested
    && !resumeState.resumable
  ) {
    console.error(JSON.stringify({
      ok: false,
      error: 'continuity packet is not resumable without forceResume=true',
      resume_state: resumeState,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (visibleTerminal && process.platform === 'win32') {
    const launch = launchVisibleWindowsPowerShell({
      objective,
      dryRun,
      autoDeploy,
      strict,
      routeMode,
      scope,
      stage,
      runtimeLane,
      resumeFromPackets,
      forceResume,
      continuousLoop,
      idleSeconds,
      maxCycles,
      maxIdleChecks,
      autoRestartOnRelease,
      capacityTarget,
      continueUntilCapacity,
      autoSelectQueuedObjective,
      autoLaunchQueuedChat,
      gcpCapacityRecoveryRequested,
      vaultPath: vaultPath || null,
      resumeState,
      autoOpenResumePacket,
    });
    console.log(JSON.stringify({
      ...launch,
      objective,
      dry_run: dryRun,
      auto_deploy: autoDeploy,
      strict,
      route_mode: routeMode,
      scope,
      stage,
      runtimeLane,
      resume_from_packets: resumeFromPackets,
      auto_restart_on_release: autoRestartOnRelease,
      continuous_loop: continuousLoop,
      continue_until_capacity: continueUntilCapacity,
      capacity_target: capacityTarget,
      gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
      auto_select_queued_objective: autoSelectQueuedObjective,
      auto_launch_queued_chat: autoLaunchQueuedChat,
      resume_state: resumeState,
      monitor_command: 'npm run openjarvis:goal:status',
    }, null, 2));
    process.exitCode = launch.ok ? 0 : launch.exit_code;
    return;
  }

  const vscodeBridge = maybeAutoOpenResumePacket({
    enabled: autoOpenResumePacket,
    resumeState,
  });

  if (continuousLoop) {
    const loop = await runContinuousLoop({
      objective,
      dryRun,
      autoDeploy,
      strict,
      routeMode,
      scope,
      stage,
      runtimeLane,
      sessionPath: sessionPath || null,
      vaultPath: vaultPath || null,
      resumeFromPackets,
      forceResume,
      idleSeconds,
      maxCycles,
      maxIdleChecks,
      continueUntilCapacity,
      autoSelectQueuedObjective,
      autoLaunchQueuedChat,
      capacityTarget,
      gcpCapacityRecoveryRequested,
      runtimeLane,
      vscodeBridge,
      autoRestartOnRelease,
    });
    const status = await buildStatusPayload({ sessionPath: sessionPath || null, vaultPath: vaultPath || null, capacityTarget, gcpCapacityRecoveryRequested, runtimeLane });
    console.log(JSON.stringify({
      ...loop,
      objective: objective || null,
      dry_run: dryRun,
      auto_deploy: autoDeploy,
      strict,
      route_mode: routeMode,
      scope,
      stage,
      runtime_lane: runtimeLane,
      resume_from_packets: resumeFromPackets,
      auto_restart_on_release: autoRestartOnRelease,
      continue_until_capacity: continueUntilCapacity,
      capacity_target: capacityTarget,
      gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
      auto_select_queued_objective: autoSelectQueuedObjective,
      auto_launch_queued_chat: autoLaunchQueuedChat,
      resume_state: resumeState,
      vscode_bridge: vscodeBridge,
      status,
    }, null, 2));
    process.exitCode = loop.ok ? 0 : 1;
    return;
  }

  const run = runGoalCycle({ objective, dryRun, autoDeploy, strict, routeMode, scope, stage, runtimeLane, autoRestartOnRelease, gcpCapacityRecoveryRequested });
  const status = await buildStatusPayload({ sessionPath: sessionPath || null, vaultPath: vaultPath || null, capacityTarget, gcpCapacityRecoveryRequested, runtimeLane });

  console.log(JSON.stringify({
    ...run,
    objective,
    dry_run: dryRun,
    auto_deploy: autoDeploy,
    strict,
    route_mode: routeMode,
    scope,
    stage,
    runtime_lane: runtimeLane,
    resume_from_packets: resumeFromPackets,
    auto_restart_on_release: autoRestartOnRelease,
    continue_until_capacity: continueUntilCapacity,
    capacity_target: capacityTarget,
    gcp_capacity_recovery_requested: gcpCapacityRecoveryRequested,
    auto_select_queued_objective: autoSelectQueuedObjective,
    auto_launch_queued_chat: autoLaunchQueuedChat,
    resume_state: resumeState,
    vscode_bridge: vscodeBridge,
    status,
  }, null, 2));
  process.exitCode = run.ok ? 0 : run.exit_code;
};

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
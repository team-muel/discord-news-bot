import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { buildInboxChatNote, type InboxChatRequesterKind } from '../../routes/chat';
import { getObsidianAdapterRuntimeStatus, readObsidianFileWithAdapter, writeObsidianNoteWithAdapter } from '../obsidian/router';
import {
  getOpenJarvisAutopilotStatus,
  getOpenJarvisSessionOpenBundle,
  type OpenJarvisAutopilotStatus,
  type OpenJarvisAutopilotStatusParams,
  type OpenJarvisSessionOpenBundle,
} from './openjarvisAutopilotStatusService';
import { runHermesVsCodeBridge, type HermesVsCodeBridgeRunResult } from '../runtime/hermesVsCodeBridgeService';

export type HermesRuntimeRemediationActionId = 'start-supervisor-loop' | 'open-progress-packet' | 'open-execution-board';

export type HermesRuntimeChatNoteResult = {
  ok: boolean;
  completion: 'created' | 'skipped';
  fileName: string | null;
  notePath: string | null;
  requestTitle: string;
  requestMessage: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: 'VAULT_PATH_REQUIRED' | 'WRITE_FAILED' | null;
  error: string | null;
};

export type HermesRuntimeChatNoteParams = OpenJarvisAutopilotStatusParams & {
  title?: string | null;
  requesterId?: string | null;
  requesterKind?: InboxChatRequesterKind;
  guildId?: string | null;
};

export type HermesRuntimeRemediationResult = {
  ok: boolean;
  actionId: HermesRuntimeRemediationActionId | null;
  dryRun: boolean;
  completion: 'queued' | 'completed' | 'skipped';
  command: string | null;
  pid: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdoutLines: string[];
  stderrLines: string[];
  errorCode: 'VALIDATION' | 'PACKET_PATH_MISSING' | 'COMMAND_FAILED' | null;
  error: string | null;
  bridgeResult?: HermesVsCodeBridgeRunResult;
};

export type HermesRuntimeRemediationParams = OpenJarvisAutopilotStatusParams & {
  actionId?: string | null;
  dryRun?: boolean;
  visibleTerminal?: boolean;
  autoLaunchQueuedChat?: boolean;
  autoLaunchQueuedChatContextProfile?: string | null;
  autoLaunchQueuedSwarm?: boolean;
  autoLaunchQueuedSwarmIncludeDistiller?: boolean;
  autoLaunchQueuedSwarmExecutorWorktreePath?: string | null;
  autoLaunchQueuedSwarmExecutorArtifactBudget?: string[] | null;
};

export type HermesRuntimeQueueObjectiveParams = OpenJarvisAutopilotStatusParams & {
  objective?: string | null;
  objectives?: string[] | null;
  replaceExisting?: boolean;
  dryRun?: boolean;
};

export type HermesRuntimeQueueObjectiveResult = {
  ok: boolean;
  completion: 'updated' | 'skipped';
  requestedObjectives: string[];
  queuedObjectives: string[];
  handoffPacketPath: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: 'VALIDATION' | 'VAULT_PATH_REQUIRED' | 'HANDOFF_PACKET_MISSING' | 'READ_FAILED' | 'WRITE_FAILED' | null;
  error: string | null;
};

export type HermesRuntimeAutoQueueParams = OpenJarvisAutopilotStatusParams & {
  dryRun?: boolean;
  status?: OpenJarvisAutopilotStatus | null;
  bundle?: OpenJarvisSessionOpenBundle | null;
};

export type HermesRuntimeAutoQueueResult = {
  ok: boolean;
  completion: 'updated' | 'skipped';
  synthesizedObjectives: string[];
  queueObjective: HermesRuntimeQueueObjectiveResult | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: HermesRuntimeQueueObjectiveResult['errorCode'] | 'NO_SYNTHESIZED_OBJECTIVES' | null;
  error: string | null;
};

export type HermesRuntimeContextProfile =
  | 'default'
  | 'auto'
  | 'delegated-operator'
  | 'scout'
  | 'executor'
  | 'distiller'
  | 'guardian';

export type HermesRuntimeLaunchChatParams = OpenJarvisAutopilotStatusParams & {
  objective?: string | null;
  prompt?: string | null;
  chatMode?: string | null;
  contextProfile?: string | null;
  addFilePaths?: string[] | null;
  allowedRoots?: string[] | null;
  maximize?: boolean;
  newWindow?: boolean;
  reuseWindow?: boolean;
  dryRun?: boolean;
};

export type HermesRuntimeLaunchChatResult = {
  ok: boolean;
  completion: 'queued' | 'skipped';
  objective: string | null;
  contextProfile: HermesRuntimeContextProfile | null;
  prompt: string | null;
  addFilePaths: string[];
  command: string | null;
  pid: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: 'VALIDATION' | 'CODE_CLI_MISSING' | 'PACKET_PATH_MISSING' | 'COMMAND_FAILED' | null;
  error: string | null;
  bridgeResult?: HermesVsCodeBridgeRunResult;
};

export type HermesSessionStartPrepParams = OpenJarvisAutopilotStatusParams & {
  objective?: string | null;
  objectives?: string[] | null;
  contextProfile?: string | null;
  title?: string | null;
  guildId?: string | null;
  requesterId?: string | null;
  requesterKind?: InboxChatRequesterKind;
  createChatNote?: boolean;
  startSupervisor?: boolean;
  dryRun?: boolean;
  visibleTerminal?: boolean;
  autoLaunchQueuedChat?: boolean;
  autoLaunchQueuedSwarm?: boolean;
};

export type HermesSessionStartPrepResult = {
  ok: boolean;
  completion: 'prepared' | 'skipped';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sharedObsidianPreferred: boolean;
  statusSummary: {
    readiness: string | null;
    currentRole: string | null;
    supervisorAlive: boolean;
    queuedObjectivesAvailable: boolean;
  } | null;
  bundle: OpenJarvisSessionOpenBundle | null;
  chatNote: HermesRuntimeChatNoteResult | null;
  queueObjective: HermesRuntimeQueueObjectiveResult | null;
  remediation: HermesRuntimeRemediationResult | null;
  errorCode: 'VAULT_PATH_REQUIRED' | 'PREP_FAILED' | null;
  error: string | null;
};

export type HermesRuntimeSwarmShardSpec = {
  shardId?: string | null;
  objective?: string | null;
  contextProfile?: string | null;
  addFilePaths?: string[] | null;
  artifactBudget?: string[] | null;
  recallCondition?: string | null;
  completionDefinition?: string | null;
  acceptanceOwner?: string | null;
  dependsOn?: string[] | null;
  worktreePath?: string | null;
};

export type HermesRuntimeLaunchSwarmParams = OpenJarvisAutopilotStatusParams & {
  waveObjective?: string | null;
  shards?: HermesRuntimeSwarmShardSpec[] | null;
  boardPath?: string | null;
  includeDistiller?: boolean;
  maximize?: boolean;
  newWindow?: boolean;
  reuseWindow?: boolean;
  dryRun?: boolean;
};

export type HermesRuntimeLaunchSwarmShardResult = {
  shardId: string;
  objective: string;
  contextProfile: HermesRuntimeContextProfile;
  boardPath: string | null;
  shardPath: string | null;
  worktreePath: string | null;
  completion: 'queued' | 'skipped';
  command: string | null;
  pid: number | null;
  errorCode: HermesRuntimeLaunchChatResult['errorCode'];
  error: string | null;
  launchResult: HermesRuntimeLaunchChatResult;
};

export type HermesRuntimeLaunchSwarmResult = {
  ok: boolean;
  completion: 'queued' | 'skipped';
  waveId: string | null;
  waveObjective: string | null;
  boardPath: string | null;
  shardPaths: string[];
  launches: HermesRuntimeLaunchSwarmShardResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: 'VALIDATION' | 'VAULT_PATH_REQUIRED' | 'WRITE_FAILED' | null;
  error: string | null;
};

export type HermesRuntimeSwarmCloseoutStatus = 'completed' | 'blocked' | 'failed';

export type HermesRuntimeSwarmCloseoutParams = {
  vaultPath?: string | null;
  boardPath?: string | null;
  shardPath?: string | null;
  waveId?: string | null;
  shardId?: string | null;
  workerRole?: string | null;
  completionStatus: HermesRuntimeSwarmCloseoutStatus;
  summary?: string | null;
  nextAction?: string | null;
  blockedAction?: string | null;
  dryRun?: boolean;
};

export type HermesRuntimeSwarmCloseoutResult = {
  ok: boolean;
  completion: 'updated' | 'skipped';
  waveId: string | null;
  shardId: string | null;
  workerRole: string | null;
  boardPath: string | null;
  shardPath: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: 'VALIDATION' | 'VAULT_PATH_REQUIRED' | 'WRITE_FAILED' | null;
  error: string | null;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../../');
const EXECUTION_BOARD_PATH = path.resolve(REPO_ROOT, 'docs/planning/EXECUTION_BOARD.md');
const DEFAULT_HERMES_RUNTIME_CHAT_TITLE = 'Hermes Runtime Handoff';
const DEFAULT_HERMES_RUNTIME_REQUESTER_ID = 'hermes-runtime';
const DEFAULT_HERMES_CHAT_MODE = 'agent';
const DEFAULT_HANDOFF_PACKET_RELATIVE_PATH = 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md';
const DEFAULT_HERMES_SWARM_BOARD_RELATIVE_PATH = 'plans/execution/HERMES_PARALLEL_GPT_SWARM_BOARD.md';
const DEFAULT_HERMES_SWARM_SHARDS_DIR = 'plans/execution/hermes-swarm';
const DEFAULT_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'default';
const AUTO_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'auto';
const DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'delegated-operator';
const SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'scout';
const EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'executor';
const DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'distiller';
const GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'guardian';
const MAX_HERMES_RUNTIME_LAUNCH_FILES = 12;
const MAX_HERMES_SWARM_SHARDS = 3;
const SAFE_QUEUE_SECTION_HEADING = 'Safe Autonomous Queue For Hermes';
const HERMES_SWARM_STATUS_SECTION_HEADING = 'Status';
const HERMES_SWARM_LATEST_CLOSEOUT_SECTION_HEADING = 'Latest Closeout';
const HERMES_SWARM_ACK_HISTORY_SECTION_HEADING = 'Ack History';
const HERMES_SWARM_REGISTRY_SECTION_HEADING = 'Shard Registry';
const HERMES_SWARM_CLOSEOUTS_SECTION_HEADING = 'Shard Closeouts';
const MAX_SAFE_QUEUE_ITEMS = 12;
const HERMES_RUNTIME_CONTEXT_PROFILE_SET = new Set<HermesRuntimeContextProfile>([
  DEFAULT_HERMES_RUNTIME_CONTEXT_PROFILE,
  AUTO_HERMES_RUNTIME_CONTEXT_PROFILE,
  DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE,
  SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE,
  EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE,
  DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE,
  GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE,
]);
const HERMES_SHARED_CONTEXT_FILE_CANDIDATES = [
  'docs/TEAM_SHARED_OBSIDIAN_START_HERE.md',
  'docs/ARCHITECTURE_INDEX.md',
  'docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md',
  'docs/planning/EXECUTION_BOARD.md',
  'docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md',
  'docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md',
  'docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md',
];
const HERMES_DELEGATED_CONTEXT_FILE_CANDIDATES = [
  ...HERMES_SHARED_CONTEXT_FILE_CANDIDATES,
  'docs/adr/ADR-008-multi-plane-operating-model.md',
  'docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md',
  'docs/CHANGELOG-ARCH.md',
];
const HERMES_SCOUT_CONTEXT_FILE_CANDIDATES = [
  ...HERMES_SHARED_CONTEXT_FILE_CANDIDATES,
  'docs/adr/ADR-008-multi-plane-operating-model.md',
  'docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md',
  'docs/planning/README.md',
  'docs/RUNBOOK_MUEL_PLATFORM.md',
  'docs/CHANGELOG-ARCH.md',
];
const HERMES_EXECUTOR_CONTEXT_FILE_CANDIDATES = [
  'docs/ARCHITECTURE_INDEX.md',
  'docs/adr/ADR-008-multi-plane-operating-model.md',
  'docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md',
  'docs/planning/EXECUTION_BOARD.md',
  'docs/RUNBOOK_MUEL_PLATFORM.md',
  'docs/CHANGELOG-ARCH.md',
];
const HERMES_DISTILLER_CONTEXT_FILE_CANDIDATES = [
  'docs/CHANGELOG-ARCH.md',
  'docs/planning/README.md',
  'docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md',
  'docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md',
  'docs/TEAM_SHARED_OBSIDIAN_START_HERE.md',
];
const HERMES_GUARDIAN_CONTEXT_FILE_CANDIDATES = [
  'docs/planning/EXECUTION_BOARD.md',
  'docs/RUNBOOK_MUEL_PLATFORM.md',
  'docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md',
  'docs/CHANGELOG-ARCH.md',
];
const HERMES_SCOUT_OBJECTIVE_PATTERNS = [
  /research/i,
  /investigat/i,
  /map/i,
  /analy(s|z)/i,
  /compare/i,
  /survey/i,
  /explor/i,
  /upstream/i,
  /github/i,
  /deepwiki/i,
  /roadmap/i,
  /vision/i,
  /context/i,
  /archaeolog/i,
  /probe/i,
  /audit/i,
];
const HERMES_EXECUTOR_OBJECTIVE_PATTERNS = [
  /implement/i,
  /fix/i,
  /wire/i,
  /refactor/i,
  /extract/i,
  /patch/i,
  /update/i,
  /reduce/i,
  /optimiz/i,
  /rename/i,
  /migrat/i,
  /test/i,
  /remove/i,
  /add/i,
];
const HERMES_DISTILLER_OBJECTIVE_PATTERNS = [
  /distill/i,
  /summari(s|z)e/i,
  /promot/i,
  /closeout/i,
  /handoff/i,
  /retro/i,
  /document/i,
  /wiki/i,
  /changelog/i,
  /playbook/i,
  /decision/i,
];
const HERMES_GUARDIAN_OBJECTIVE_PATTERNS = [
  /guard/i,
  /watch/i,
  /monitor/i,
  /supervisor/i,
  /stale/i,
  /reentry/i,
  /health/i,
  /recover/i,
  /rollback/i,
  /queue/i,
  /gate/i,
  /wait/i,
  /ack/i,
];

const compact = (value: unknown): string => String(value || '').trim();

const toNullableString = (value: unknown): string | null => compact(value) || null;

const normalizeObjective = (value: unknown): string => compact(value).replace(/\s+/g, ' ');

const objectiveKey = (value: unknown): string => normalizeObjective(value).toLowerCase();

const AUTONOMOUS_QUEUE_SYNTHESIS_REJECT_PATTERNS = [
  /^continue the current workflow/i,
  /^keep workflow session/i,
  /^keep launch manifest\/log/i,
  /^refresh the active continuity packet/i,
  /^refresh the active progress packet/i,
  /^refresh workstream state/i,
  /^restart the next bounded automation cycle/i,
  /^wait for the next gpt objective/i,
  /^promote durable operator-visible outcomes/i,
  /^start from the deterministic api path first/i,
];

const isSynthesisObjectiveCandidate = (value: unknown): boolean => {
  const normalized = normalizeObjective(value);
  if (!normalized) {
    return false;
  }
  return !AUTONOMOUS_QUEUE_SYNTHESIS_REJECT_PATTERNS.some((pattern) => pattern.test(normalized));
};

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeObjective(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

type HermesRuntimeNormalizedSwarmShard = {
  shardId: string;
  objective: string;
  contextProfile: HermesRuntimeContextProfile;
  addFilePaths: string[];
  artifactBudget: string[];
  recallCondition: string | null;
  completionDefinition: string | null;
  acceptanceOwner: string | null;
  dependsOn: string[];
  worktreePath: string | null;
};

const slugifyHermesToken = (value: unknown, fallback: string): string => {
  const normalized = normalizeObjective(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
};

const resolveHermesOptionalRootPath = (value: unknown): string | null => {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }

  const absolutePath = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(REPO_ROOT, normalized);
  return fs.existsSync(absolutePath) ? absolutePath : null;
};

const buildHermesSwarmWaveId = (waveObjective: string): string => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${timestamp}-${slugifyHermesToken(waveObjective, 'swarm-wave')}`;
};

const buildHermesDefaultSwarmShards = (waveObjective: string, includeDistiller: boolean): HermesRuntimeSwarmShardSpec[] => {
  const shards: HermesRuntimeSwarmShardSpec[] = [
    {
      shardId: 'route-scout',
      objective: `Map route, blockers, and evidence for ${waveObjective}`,
      contextProfile: 'scout',
      completionDefinition: 'Route, blocker, and evidence summary is ready for the executor without reopening broad archaeology.',
      recallCondition: 'Recall the coordinator if route ambiguity remains or a shared contract is missing.',
      acceptanceOwner: 'coordinator-gpt',
    },
    {
      shardId: 'bounded-executor',
      objective: waveObjective,
      contextProfile: 'executor',
      completionDefinition: 'Bounded implementation or validation slice is complete with typecheck and targeted verification.',
      recallCondition: 'Recall the coordinator on cross-shard architecture changes, merge conflicts, or policy boundaries.',
      acceptanceOwner: 'coordinator-gpt',
      dependsOn: ['route-scout'],
    },
  ];

  if (includeDistiller) {
    shards.push({
      shardId: 'closeout-distiller',
      objective: `Distill accepted outcomes for ${waveObjective}`,
      contextProfile: 'distiller',
      completionDefinition: 'Decision distillate, changelog/wiki delta, and bounded next action are ready after acceptance.',
      recallCondition: 'Start only after the executor reaches an accepted checkpoint.',
      acceptanceOwner: 'coordinator-gpt',
      dependsOn: ['bounded-executor'],
    });
  }

  return shards;
};

const normalizeHermesSwarmShards = (params: {
  shards?: HermesRuntimeSwarmShardSpec[] | null;
  waveObjective: string;
  includeDistiller: boolean;
}): HermesRuntimeNormalizedSwarmShard[] => {
  const rawShards = Array.isArray(params.shards) && params.shards.length > 0
    ? params.shards
    : buildHermesDefaultSwarmShards(params.waveObjective, params.includeDistiller);

  return rawShards
    .map((shard, index) => {
      const objective = normalizeObjective(shard.objective);
      if (!objective) {
        return null;
      }

      const contextProfile = normalizeHermesRuntimeContextProfile(shard.contextProfile);
      const shardId = slugifyHermesToken(shard.shardId || objective, `shard-${index + 1}`);

      return {
        shardId,
        objective,
        contextProfile,
        addFilePaths: uniqueStrings(toList(shard.addFilePaths)),
        artifactBudget: uniqueStrings(toList(shard.artifactBudget)),
        recallCondition: toNullableString(shard.recallCondition),
        completionDefinition: toNullableString(shard.completionDefinition),
        acceptanceOwner: toNullableString(shard.acceptanceOwner),
        dependsOn: uniqueStrings(toList(shard.dependsOn)).filter((dependency) => slugifyHermesToken(dependency, dependency) !== shardId),
        worktreePath: resolveHermesOptionalRootPath(shard.worktreePath),
      } satisfies HermesRuntimeNormalizedSwarmShard;
    })
    .filter((shard): shard is HermesRuntimeNormalizedSwarmShard => Boolean(shard))
    .slice(0, MAX_HERMES_SWARM_SHARDS);
};

const buildHermesSwarmRegistryLine = (params: {
  shard: HermesRuntimeNormalizedSwarmShard;
  shardPath: string | null;
  state: 'planned' | 'queued' | 'completed' | 'blocked' | 'failed';
  pid?: number | null;
}): string => {
  const parts = [
    `shard_id=${params.shard.shardId}`,
    `role=${params.shard.contextProfile}`,
    `state=${params.state}`,
    `objective=${params.shard.objective}`,
    params.shardPath ? `path=${params.shardPath}` : null,
    params.pid ? `pid=${params.pid}` : null,
  ].filter(Boolean);
  return parts.join(' | ');
};

const buildHermesSwarmCloseoutLine = (params: {
  acknowledgedAt: string;
  waveId: string | null;
  shardId: string;
  workerRole: string;
  completionStatus: HermesRuntimeSwarmCloseoutStatus;
  summary: string | null;
  nextAction: string | null;
  blockedAction: string | null;
}): string => {
  return [
    `ack_at=${params.acknowledgedAt}`,
    params.waveId ? `wave_id=${params.waveId}` : null,
    `shard_id=${params.shardId}`,
    `role=${params.workerRole}`,
    `state=${params.completionStatus}`,
    params.summary ? `summary=${params.summary}` : null,
    params.nextAction ? `next_action=${params.nextAction}` : null,
    params.blockedAction ? `blocked_action=${params.blockedAction}` : null,
  ].filter(Boolean).join(' | ');
};

const upsertBulletSectionItem = (params: {
  content: string;
  heading: string;
  match: (item: string) => boolean;
  nextItem: string;
  maxItems?: number;
}): string => {
  const existing = extractBulletSection(params.content, params.heading).filter((item) => !params.match(item));
  return replaceBulletSection(params.content, params.heading, [params.nextItem, ...existing].slice(0, params.maxItems || 12));
};

const buildHermesSwarmAckFlagBase = (params: {
  contextProfile: HermesRuntimeContextProfile;
  boardRelativePath: string | null;
  shardRelativePath: string | null;
  waveId: string;
  shardId: string;
}): string => {
  return [
    `--profile=${params.contextProfile}`,
    params.boardRelativePath ? `--swarmBoardPath=${params.boardRelativePath}` : null,
    params.shardRelativePath ? `--shardPath=${params.shardRelativePath}` : null,
    `--waveId=${params.waveId}`,
    `--shardId=${params.shardId}`,
    `--workerRole=${params.contextProfile}`,
  ].filter(Boolean).join(' ');
};

const buildHermesSwarmShardPacketContent = (params: {
  waveId: string;
  boardRelativePath: string | null;
  shardRelativePath: string;
  shard: HermesRuntimeNormalizedSwarmShard;
  state: 'planned' | 'queued' | 'completed' | 'blocked' | 'failed';
  prompt: string;
  launchCommand?: string | null;
  pid?: number | null;
  latestCloseoutLine?: string | null;
}): string => {
  const ackBase = buildHermesSwarmAckFlagBase({
    contextProfile: params.shard.contextProfile,
    boardRelativePath: params.boardRelativePath,
    shardRelativePath: params.shardRelativePath,
    waveId: params.waveId,
    shardId: params.shard.shardId,
  });

  const lines = [
    '---',
    `title: "Hermes Swarm Shard ${params.shard.shardId}"`,
    `wave_id: "${params.waveId}"`,
    `shard_id: "${params.shard.shardId}"`,
    `worker_role: "${params.shard.contextProfile}"`,
    `objective: "${params.shard.objective.replace(/"/g, '\\"')}"`,
    'source: "openjarvis-hermes-runtime-control"',
    'tags: [hermes, swarm, shard]',
    'guild_id: "system"',
    '---',
    '',
    '# Hermes Swarm Shard Packet',
    '',
    `## ${HERMES_SWARM_STATUS_SECTION_HEADING}`,
    `- state: ${params.state}`,
    `- wave_id: ${params.waveId}`,
    `- shard_id: ${params.shard.shardId}`,
    `- worker_role: ${params.shard.contextProfile}`,
    `- objective: ${params.shard.objective}`,
    `- acceptance_owner: ${params.shard.acceptanceOwner || 'coordinator-gpt'}`,
    `- worktree_path: ${params.shard.worktreePath || '(none)'}`,
    params.pid ? `- pid: ${params.pid}` : '- pid: (none)',
    params.launchCommand ? `- launch_command: ${params.launchCommand}` : '- launch_command: (none)',
    '',
    '## Artifact Budget',
    ...(params.shard.artifactBudget.length > 0 ? params.shard.artifactBudget.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Recall Condition',
    `- ${params.shard.recallCondition || 'Recall the coordinator on policy, architecture, or cross-shard conflicts.'}`,
    '',
    '## Definition Of Done',
    `- ${params.shard.completionDefinition || 'Close this shard only when the bounded role contract is complete and evidence is attached.'}`,
    '',
    '## Dependencies',
    ...(params.shard.dependsOn.length > 0 ? params.shard.dependsOn.map((item) => `- ${item}`) : ['- (none)']),
    '',
    `## ${HERMES_SWARM_LATEST_CLOSEOUT_SECTION_HEADING}`,
    `- ${params.latestCloseoutLine || '(none)'}`,
    '',
    `## ${HERMES_SWARM_ACK_HISTORY_SECTION_HEADING}`,
    '- (none)',
    '',
    '## Closeout Ack Contract',
    `- completed: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed ${ackBase} --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"`,
    `- blocked: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=blocked ${ackBase} --summary="<blocker summary>" --blockedAction="<blocked action>" --nextAction="<required recall step>"`,
    `- failed: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=failed ${ackBase} --summary="<failure summary>" --blockedAction="<failed action>" --nextAction="<recovery step>"`,
    '',
    '## Prompt Snapshot',
    ...params.prompt.split('\n').map((line) => line ? `- ${line}` : '- '),
    '',
    '## Evidence And References',
    ...(params.boardRelativePath ? [`- board: ${params.boardRelativePath}`] : []),
    `- shard_packet: ${params.shardRelativePath}`,
  ];

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
};

const buildHermesSwarmBoardContent = (params: {
  waveId: string;
  waveObjective: string;
  boardRelativePath: string;
  shards: Array<{
    shard: HermesRuntimeNormalizedSwarmShard;
    shardPath: string | null;
    state: 'planned' | 'queued' | 'completed' | 'blocked' | 'failed';
    pid?: number | null;
  }>;
  closeouts?: string[];
}): string => {
  const lines = [
    '---',
    'title: "Hermes Parallel GPT Swarm Board"',
    `wave_id: "${params.waveId}"`,
    `objective: "${params.waveObjective.replace(/"/g, '\\"')}"`,
    'source: "openjarvis-hermes-runtime-control"',
    'tags: [hermes, swarm, execution]',
    'guild_id: "system"',
    'status: "active"',
    '---',
    '',
    '# Hermes Parallel GPT Swarm Board',
    '',
    '## Wave Summary',
    `- wave_id: ${params.waveId}`,
    `- objective: ${params.waveObjective}`,
    `- coordinator_owner: current GPT session`,
    `- board_path: ${params.boardRelativePath}`,
    `- shard_count: ${params.shards.length}`,
    '',
    '## Launch Guardrails',
    '- one coordinator owns the wave objective and acceptance boundary',
    '- each worker owns one bounded shard and one artifact budget only',
    '- code-writing workers should stay inside an isolated worktree when one is assigned',
    '- OpenClaw stays out-of-band convenience only and does not own swarm routing or semantics',
    '',
    `## ${HERMES_SWARM_REGISTRY_SECTION_HEADING}`,
    ...params.shards.map((entry) => `- ${buildHermesSwarmRegistryLine({
      shard: entry.shard,
      shardPath: entry.shardPath,
      state: entry.state,
      pid: entry.pid,
    })}`),
    '',
    `## ${HERMES_SWARM_CLOSEOUTS_SECTION_HEADING}`,
    ...((params.closeouts && params.closeouts.length > 0) ? params.closeouts.map((item) => `- ${item}`) : ['- (none)']),
    '',
    '## Closeout Ack Contract',
    '- every worker must acknowledge completion through openjarvis:hermes:runtime:reentry-ack with wave_id, shard_id, worker_role, and board/shard paths',
    '- the coordinator accepts or rejects shard results before semantic promotion',
    '',
    '## Evidence And References',
    '- docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md',
    '- docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md',
    '- docs/planning/CAPABILITY_GAP_ANALYSIS.md',
  ];

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
};

const synthesizeRuntimeQueuedObjectives = (params: {
  status: OpenJarvisAutopilotStatus;
  bundle: OpenJarvisSessionOpenBundle;
}): string[] => {
  const currentObjectives = new Set([
    objectiveKey(params.status.workflow.objective),
    objectiveKey(params.bundle.objective),
    objectiveKey(params.bundle.compact_bootstrap.objective),
    objectiveKey(params.status.resume_state && typeof params.status.resume_state === 'object'
      ? (params.status.resume_state as Record<string, unknown>).objective
      : null),
  ].filter(Boolean));

  return uniqueStrings([
    compact(params.bundle.compact_bootstrap.next_queue_head),
    ...params.bundle.capability_demands.map((entry) => compact(entry.objective)),
    ...(params.status.workflow.lastCapabilityDemands || []).map((entry) => compact(entry.objective)),
  ]).filter((objective) => isSynthesisObjectiveCandidate(objective) && !currentObjectives.has(objectiveKey(objective)));
};

const toList = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.map((entry) => compact(entry)).filter(Boolean)
    : [];
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveVaultRelativePath = (vaultPath: string, relativePath: string): string | null => {
  const normalized = compact(relativePath).replace(/\\/g, '/');
  if (!normalized) {
    return null;
  }
  const absolutePath = path.resolve(vaultPath, normalized);
  const relative = path.relative(vaultPath, absolutePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
};

const resolveVaultAbsolutePath = (vaultPath: string, relativePath: string): string | null => {
  const relative = resolveVaultRelativePath(vaultPath, relativePath);
  return relative ? path.resolve(vaultPath, relative) : null;
};

const normalizeHermesRuntimeContextProfile = (value: unknown): HermesRuntimeContextProfile => {
  const normalized = compact(value).toLowerCase() as HermesRuntimeContextProfile;
  return HERMES_RUNTIME_CONTEXT_PROFILE_SET.has(normalized)
    ? normalized
    : DEFAULT_HERMES_RUNTIME_CONTEXT_PROFILE;
};

const matchesHermesContextProfilePattern = (value: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(value));
};

const inferHermesRuntimeContextProfile = (params: {
  requestedProfile: HermesRuntimeContextProfile;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
  status: OpenJarvisAutopilotStatus;
}): HermesRuntimeContextProfile => {
  if (params.requestedProfile !== AUTO_HERMES_RUNTIME_CONTEXT_PROFILE) {
    return params.requestedProfile;
  }

  const objectiveSignalText = [
    params.objective,
    compact(params.bundle.decision.summary),
    compact(params.bundle.decision.next_action),
    compact(params.status.workflow.lastDecisionDistillate?.summary),
    compact(params.status.workflow.lastDecisionDistillate?.nextAction),
  ].join(' ');

  const distillerSignalText = [
    params.objective,
    compact(params.bundle.decision.next_action),
    compact(params.bundle.decision.promote_as),
    compact(params.status.workflow.lastDecisionDistillate?.summary),
    compact(params.status.workflow.lastDecisionDistillate?.nextAction),
  ].join(' ');

  const guardianSignalText = [
    params.objective,
    compact(params.bundle.decision.next_action),
    compact(params.bundle.recall.blocked_action),
    compact(params.bundle.recall.next_action),
    compact(params.status.workflow.lastDecisionDistillate?.summary),
    compact(params.status.workflow.lastDecisionDistillate?.nextAction),
  ].join(' ');

  const runtimeSignalText = [
    ...params.bundle.capability_demands.map((entry) => compact(entry.summary)),
    ...params.bundle.capability_demands.map((entry) => compact(entry.missing_capability)),
    ...toList(params.bundle.hermes_runtime?.blockers),
    ...toList(params.bundle.hermes_runtime?.next_actions),
  ].join(' ');

  if (params.bundle.hermes_runtime.awaiting_reentry_acknowledgment_stale === true) {
    return GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (
    compact(params.bundle.workflow.status).toLowerCase() === 'released'
    && matchesHermesContextProfilePattern(distillerSignalText, HERMES_DISTILLER_OBJECTIVE_PATTERNS)
  ) {
    return DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (matchesHermesContextProfilePattern(objectiveSignalText, HERMES_SCOUT_OBJECTIVE_PATTERNS)) {
    return SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (matchesHermesContextProfilePattern(objectiveSignalText, HERMES_EXECUTOR_OBJECTIVE_PATTERNS)) {
    return EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (matchesHermesContextProfilePattern(`${guardianSignalText} ${runtimeSignalText}`.trim(), HERMES_GUARDIAN_OBJECTIVE_PATTERNS)) {
    return GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  return DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE;
};

const resolveExistingRepoRelativePath = (value: unknown): string | null => {
  const normalized = compact(value).replace(/\\/g, '/');
  if (!normalized || path.isAbsolute(normalized) || normalized.startsWith('..')) {
    return null;
  }

  const absolutePath = path.resolve(REPO_ROOT, normalized);
  const relativePath = path.relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath) || !fs.existsSync(absolutePath)) {
    return null;
  }

  return relativePath;
};

const resolveHermesContextProfileCandidateFiles = (profile: HermesRuntimeContextProfile): string[] => {
  switch (profile) {
    case DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE:
      return HERMES_DELEGATED_CONTEXT_FILE_CANDIDATES;
    case SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE:
      return HERMES_SCOUT_CONTEXT_FILE_CANDIDATES;
    case EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE:
      return HERMES_EXECUTOR_CONTEXT_FILE_CANDIDATES;
    case DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE:
      return HERMES_DISTILLER_CONTEXT_FILE_CANDIDATES;
    case GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE:
      return HERMES_GUARDIAN_CONTEXT_FILE_CANDIDATES;
    default:
      return [];
  }
};

const collectHermesContextProfileFiles = (
  profile: HermesRuntimeContextProfile,
  bundle: OpenJarvisSessionOpenBundle,
): string[] => {
  return uniqueStrings([
    ...resolveHermesContextProfileCandidateFiles(profile),
    ...toList(bundle.activation_pack.read_next),
    ...toList(bundle.read_first),
    ...toList(bundle.compact_bootstrap.open_later),
    ...bundle.evidence_refs.map((ref) => compact(ref.locator)),
  ])
    .map((entry) => resolveExistingRepoRelativePath(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const shouldPreferSharedObsidianIngress = (): boolean => {
  const runtime = getObsidianAdapterRuntimeStatus();
  return runtime.selectedByCapability?.write_note === 'remote-mcp'
    || runtime.selectedByCapability?.read_file === 'remote-mcp'
    || runtime.accessPosture?.mode === 'shared-remote-ingress';
};

const extractBulletSection = (content: string, heading: string): string[] => {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex < 0) {
    return [];
  }
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^\s*-\s+(.+)$/);
    const item = normalizeObjective(match?.[1]);
    if (item && item !== '(none)') {
      sectionLines.push(item);
    }
  }
  return uniqueStrings(sectionLines);
};

const areStringListsEqual = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length
  && left.every((entry, index) => entry === right[index]);

const replaceBulletSection = (content: string, heading: string, items: string[]): string => {
  const normalized = String(content || '').replace(/\r\n/g, '\n').trimEnd();
  const lines = normalized ? normalized.split('\n') : [];
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`);
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  const replacement = items.length > 0 ? items.map((item) => `- ${item}`) : ['- (none)'];

  if (headingIndex < 0) {
    const suffix = [`## ${heading}`, ...replacement].join('\n');
    const merged = normalized ? `${normalized}\n\n${suffix}\n` : `${suffix}\n`;
    return merged;
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const merged = [
    ...lines.slice(0, headingIndex + 1),
    ...replacement,
    ...lines.slice(sectionEnd),
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return merged.endsWith('\n') ? merged : `${merged}\n`;
};

const readVaultDocument = async (vaultPath: string, relativePath: string): Promise<string | null> => {
  const normalized = resolveVaultRelativePath(vaultPath, relativePath);
  if (!normalized) {
    return null;
  }
  const preferSharedIngress = shouldPreferSharedObsidianIngress();
  if (preferSharedIngress) {
    const remoteContent = await readObsidianFileWithAdapter({
      vaultPath,
      filePath: normalized,
    });
    if (remoteContent !== null) {
      return remoteContent;
    }
  }
  const absolutePath = path.resolve(vaultPath, normalized);
  if (fs.existsSync(absolutePath)) {
    return fs.readFileSync(absolutePath, 'utf8');
  }
  if (preferSharedIngress) {
    return null;
  }
  return await readObsidianFileWithAdapter({
    vaultPath,
    filePath: normalized,
  });
};

const writeVaultDocument = async (params: {
  vaultPath: string;
  relativePath: string;
  content: string;
}): Promise<string | null> => {
  const normalized = resolveVaultRelativePath(params.vaultPath, params.relativePath);
  if (!normalized) {
    return null;
  }
  const preferSharedIngress = shouldPreferSharedObsidianIngress();
  const writeInput = {
    guildId: 'system',
    vaultPath: params.vaultPath,
    fileName: normalized,
    content: params.content,
    tags: ['hermes', 'workspace', 'handoff', 'autopilot'],
    properties: {
      source: 'openjarvis-hermes-runtime-control',
      guild_id: 'system',
    },
    trustedSource: true,
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
  };

  let remoteWritePath: string | null = null;
  if (preferSharedIngress) {
    const writeResult = await writeObsidianNoteWithAdapter(writeInput);
    if (writeResult?.path) {
      remoteWritePath = writeResult.path;
    }
  }

  const absolutePath = path.resolve(params.vaultPath, normalized);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, params.content, 'utf8');

  if (!preferSharedIngress) {
    const writeResult = await writeObsidianNoteWithAdapter(writeInput);
    return writeResult?.path || normalized;
  }

  return remoteWritePath || normalized;
};

const resolveHandoffPacketRelativePath = (resumeState: Record<string, unknown>): string => {
  return compact(resumeState.handoff_packet_relative_path) || DEFAULT_HANDOFF_PACKET_RELATIVE_PATH;
};

const appendSection = (lines: string[], heading: string, items: string[]): void => {
  lines.push('', heading);
  if (items.length === 0) {
    lines.push('- (none)');
    return;
  }
  for (const item of items.slice(0, 8)) {
    lines.push(`- ${item}`);
  }
};

const buildArtifactRefLabel = (ref: {
  locator: string;
  refKind?: string | null;
  title?: string | null;
  githubSettlementKind?: string | null;
  sourceStepName?: string | null;
}): string => {
  const locator = compact(ref.locator) || '(missing locator)';
  const label = compact(ref.title) ? `${locator} - ${compact(ref.title)}` : locator;
  const refKind = compact(ref.refKind);
  const githubSettlementKind = compact(ref.githubSettlementKind);
  const meta = [
    refKind,
    githubSettlementKind && githubSettlementKind !== refKind ? `github=${githubSettlementKind}` : null,
    compact(ref.sourceStepName),
  ].filter(Boolean);
  return meta.length > 0 ? `${label} (${meta.join(', ')})` : label;
};

const buildGoalCandidateLabel = (candidate: {
  objective?: string | null;
  source?: string | null;
  milestone?: string | null;
}): string => {
  const objective = compact(candidate.objective) || '(missing objective)';
  const meta = [compact(candidate.source), compact(candidate.milestone)].filter(Boolean);
  return meta.length > 0 ? `${objective} (${meta.join(', ')})` : objective;
};

const buildCapabilityDemandLabel = (demand: {
  summary?: string | null;
  missing_capability?: string | null;
  failed_or_insufficient_route?: string | null;
  cheapest_enablement_path?: string | null;
  proposed_owner?: string | null;
}) => {
  const summary = compact(demand.summary) || '(missing demand summary)';
  const meta = [
    compact(demand.missing_capability) ? `missing=${compact(demand.missing_capability)}` : null,
    compact(demand.failed_or_insufficient_route) ? `route=${compact(demand.failed_or_insufficient_route)}` : null,
    compact(demand.proposed_owner) ? `owner=${compact(demand.proposed_owner)}` : null,
    compact(demand.cheapest_enablement_path) ? `path=${compact(demand.cheapest_enablement_path)}` : null,
  ].filter(Boolean);
  return meta.length > 0 ? `${summary} (${meta.join('; ')})` : summary;
};

const buildHermesReentryProfileFlag = (contextProfile: HermesRuntimeContextProfile): string => {
  return contextProfile === DEFAULT_HERMES_RUNTIME_CONTEXT_PROFILE
    ? ''
    : ` --profile=${contextProfile}`;
};

const buildHermesRuntimeChatRequest = (params: {
  status: OpenJarvisAutopilotStatus;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const { status, bundle } = params;
  const hermes = status.hermes_runtime;
  const workflow = status.workflow;
  const capacity = status.capacity && typeof status.capacity === 'object'
    ? status.capacity as Record<string, unknown>
    : null;
  const resumeState = status.resume_state && typeof status.resume_state === 'object'
    ? status.resume_state as Record<string, unknown>
    : null;
  const workflowSource = compact(workflow.source);
  const stateProjectionRule = workflowSource.toLowerCase() === 'supabase'
    ? 'Supabase workflow session and event rows remain the mutable hot-state source. This Obsidian note is a compact visible projection for operators and chat follow-up.'
    : 'Keep mutable state on the active runtime plane and treat this Obsidian note as a compact visible projection, not a replacement ledger.';
  const latestRecall = status.workflow.lastRecallRequest;
  const latestDecision = status.workflow.lastDecisionDistillate;
  const evidenceRefs = Array.isArray(bundle.evidence_refs)
    ? bundle.evidence_refs.map((ref) => buildArtifactRefLabel(ref)).slice(0, 6)
    : [];
  const queuedCandidates = Array.isArray(bundle.autonomous_queue?.candidates)
    ? bundle.autonomous_queue.candidates.map((candidate) => buildGoalCandidateLabel(candidate)).slice(0, 6)
    : [];
  const capabilityDemands = Array.isArray(bundle.capability_demands)
    ? bundle.capability_demands.map((entry) => buildCapabilityDemandLabel(entry)).slice(0, 6)
    : [];
  const compactBootstrap = typeof bundle.compact_bootstrap === 'object' && bundle.compact_bootstrap !== null
    ? bundle.compact_bootstrap as Record<string, unknown>
    : {};
  const remediationLines = hermes.remediation_actions.map((action) => {
    const label = compact(action.label) || action.action_id;
    const description = compact(action.description);
    return description ? `${action.action_id}: ${label} - ${description}` : `${action.action_id}: ${label}`;
  });
  const lines = [
    'Review the current Hermes runtime state below and recommend the next safe bounded action.',
    'Keep the response Obsidian-first and local-surface only.',
    'If a listed remediation action already matches the situation, prefer that action id instead of inventing a new step.',
    'Treat this note as a visible operator projection of the live hot-state plane, not the canonical mutable ledger itself.',
    '',
    'State Ownership',
    `- hot_state_source: ${workflowSource || '(unknown)'}`,
    `- session_id: ${compact(workflow.session_id) || '(unknown)'}`,
    `- workflow_name: ${compact(workflow.workflow_name) || '(unknown)'}`,
    `- projection_rule: ${stateProjectionRule}`,
    '',
    'Hermes Runtime',
    `- readiness: ${compact(hermes.readiness) || '(unknown)'}`,
    `- current_role: ${compact(hermes.current_role) || '(unknown)'}`,
    `- can_continue_without_gpt_session: ${String(hermes.can_continue_without_gpt_session)}`,
    `- queue_enabled: ${String(hermes.queue_enabled)}`,
    `- supervisor_alive: ${String(hermes.supervisor_alive)}`,
    `- has_hot_state: ${String(hermes.has_hot_state)}`,
    `- local_operator_surface: ${String(hermes.local_operator_surface)}`,
  ];

  appendSection(lines, 'Blockers', toList(hermes.blockers));
  appendSection(lines, 'Next Actions', toList(hermes.next_actions));
  appendSection(lines, 'Remediation Actions', remediationLines);

  lines.push(
    '',
    'Workflow Context',
    `- objective: ${compact(workflow.objective) || '(unknown)'}`,
    `- runtime_lane: ${compact(workflow.runtime_lane) || '(unknown)'}`,
    `- status: ${compact(workflow.status) || '(unknown)'}`,
    `- route_mode: ${compact(workflow.route_mode) || '(unknown)'}`,
  );

  lines.push(
    '',
    'Route Guidance',
    `- recommended_mode: ${compact(bundle.routing?.recommended_mode) || '(unknown)'}`,
    `- primary_path_type: ${compact(bundle.routing?.primary_path_type) || '(unknown)'}`,
    `- hot_state: ${compact(bundle.routing?.hot_state) || '(unknown)'}`,
    `- orchestration: ${compact(bundle.routing?.orchestration) || '(unknown)'}`,
    `- semantic_owner: ${compact(bundle.routing?.semantic_owner) || '(unknown)'}`,
    `- artifact_plane: ${compact(bundle.routing?.artifact_plane) || '(unknown)'}`,
    `- candidate_mcp_tools: ${toList(bundle.routing?.candidate_mcp_tools).join(', ') || '(none)'}`,
  );

  lines.push(
    '',
    'Compact Bootstrap',
    `- posture: ${compact(compactBootstrap.posture) || '(unknown)'}`,
    `- start_with: ${toList(compactBootstrap.start_with).join(' -> ') || '(none)'}`,
    `- next_queue_head: ${compact(compactBootstrap.next_queue_head) || '(none)'}`,
    `- latest_decision_distillate: ${compact(compactBootstrap.latest_decision_distillate) || '(none)'}`,
    `- defer_large_docs_until_ambiguous: ${String(Boolean(compactBootstrap.defer_large_docs_until_ambiguous))}`,
  );

  appendSection(lines, 'Capability Demands', capabilityDemands);

  lines.push(
    '',
    'Latest Decision Distillate',
    `- created_at: ${compact(latestDecision?.createdAt) || '(none)'}`,
    `- summary: ${compact(bundle.decision.summary) || '(none)'}`,
    `- next_action: ${compact(bundle.decision.next_action) || compact(latestDecision?.nextAction) || '(none)'}`,
    `- promote_as: ${compact(bundle.decision.promote_as) || compact(latestDecision?.promoteAs) || '(none)'}`,
    `- evidence_id: ${compact(latestDecision?.evidenceId) || '(none)'}`,
    `- source_event: ${compact(latestDecision?.sourceEvent) || '(none)'}`,
    `- tags: ${toList(bundle.decision.tags).join(', ') || '(none)'}`,
  );

  lines.push(
    '',
    'Latest Recall Boundary',
    `- created_at: ${compact(latestRecall?.createdAt) || '(none)'}`,
    `- decision_reason: ${compact(bundle.recall.decision_reason) || compact(latestRecall?.decisionReason) || '(none)'}`,
    `- blocked_action: ${compact(bundle.recall.blocked_action) || compact(latestRecall?.blockedAction) || '(none)'}`,
    `- next_action: ${compact(bundle.recall.next_action) || compact(latestRecall?.nextAction) || '(none)'}`,
    `- requested_by: ${compact(latestRecall?.requestedBy) || '(none)'}`,
    `- failed_steps: ${toList(bundle.recall.failed_step_names).join(', ') || '(none)'}`,
  );

  appendSection(lines, 'Evidence Refs', evidenceRefs);
  appendSection(lines, 'Queued Objectives', queuedCandidates);

  if (capacity) {
    lines.push(
      '',
      'Capacity',
      `- score: ${compact(capacity.score) || '(unknown)'}`,
      `- target: ${compact(capacity.target) || '(unknown)'}`,
      `- state: ${compact(capacity.state) || '(unknown)'}`,
      `- loop_action: ${compact(capacity.loop_action) || '(unknown)'}`,
      `- primary_reason: ${compact(capacity.primary_reason) || '(unknown)'}`,
    );
  }

  if (resumeState) {
    lines.push(
      '',
      'Resume State',
      `- next_action: ${compact(resumeState.next_action) || '(none)'}`,
      `- reason: ${compact(resumeState.reason) || '(unknown)'}`,
      `- owner: ${compact(resumeState.owner) || '(unknown)'}`,
      `- mode: ${compact(resumeState.mode) || '(unknown)'}`,
    );
  }

  return lines.join('\n').trim();
};

const isHermesRuntimeRemediationActionId = (value: unknown): value is HermesRuntimeRemediationActionId => {
  return ['start-supervisor-loop', 'open-progress-packet', 'open-execution-board'].includes(compact(value));
};

const resolveVaultPath = (overridePath?: string | null): string | null => {
  const override = compact(overridePath);
  if (override) {
    return path.resolve(override);
  }

  const configured = compact(getObsidianVaultRoot());
  return configured ? path.resolve(configured) : null;
};

const queueNodeCommand = async (args: string[]): Promise<number | null> => {
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'node', ...args], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    : spawn('node', args, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

  return await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid ?? null);
    });
  });
};

const resolveProgressPacketAbsolutePath = (params: {
  vaultPath?: string | null;
  progressPacketRelativePath?: string | null;
}): string | null => {
  const relativePath = compact(params.progressPacketRelativePath);
  const vaultPath = resolveVaultPath(params.vaultPath);
  if (!relativePath || !vaultPath) {
    return null;
  }
  return path.resolve(vaultPath, relativePath);
};

const includesObjectiveText = (line: string, objective: string): boolean => {
  const normalizedLine = normalizeObjective(line).toLowerCase();
  const normalizedObjective = normalizeObjective(objective).toLowerCase();
  return Boolean(normalizedLine && normalizedObjective) && normalizedLine.includes(normalizedObjective);
};

const buildObjectiveAwareLaunchSections = (params: {
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
  status: OpenJarvisAutopilotStatus;
}): {
  activateFirst: string[];
  readNext: string[];
  workflowCurrentObjective: string;
  launchTargetSource: string | null;
} => {
  const { objective, bundle, status } = params;
  const workflowCurrentObjective = normalizeObjective(status.workflow.objective);
  const bundleTargetObjective = normalizeObjective(bundle.activation_pack.target_objective);
  const objectiveCandidate = status.autonomous_goal_candidates.find(
    (entry) => normalizeObjective(entry?.objective) === objective,
  ) || null;
  const staleObjectives = uniqueStrings([
    bundleTargetObjective || null,
    workflowCurrentObjective || null,
    normalizeObjective(bundle.compact_bootstrap.objective),
    ...status.autonomous_goal_candidates.map((entry) => normalizeObjective(entry?.objective)),
  ]).filter((candidateObjective) => candidateObjective !== objective);
  const filterStaleLines = (values: string[]): string[] => values.filter((value) => {
    const normalizedValue = normalizeObjective(value);
    return Boolean(normalizedValue)
      && !staleObjectives.some((candidateObjective) => includesObjectiveText(normalizedValue, candidateObjective));
  });

  return {
    activateFirst: uniqueStrings([
      `treat ${objective} as the active launch target for this turn`,
      objectiveCandidate?.source_path ? `open ${objectiveCandidate.source_path} first and continue ${objective}` : '',
      ...filterStaleLines(toList(bundle.activation_pack.activate_first)),
    ]).slice(0, 4),
    readNext: uniqueStrings([
      objectiveCandidate?.source_path || null,
      ...filterStaleLines([
        ...toList(bundle.activation_pack.read_next),
        ...toList(bundle.read_first),
      ]),
    ]).slice(0, 4),
    workflowCurrentObjective,
    launchTargetSource: compact(objectiveCandidate?.source) || null,
  };
};

const buildHermesRuntimeLaunchPrompt = (params: {
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
  status: OpenJarvisAutopilotStatus;
  contextProfile: HermesRuntimeContextProfile;
}): string => {
  const {
    objective,
    bundle,
    status,
    contextProfile,
  } = params;
  const launchSections = buildObjectiveAwareLaunchSections({
    objective,
    bundle,
    status,
  });
  const lines = [
    'Continue the next bounded local autonomy task for this workspace.',
    `Primary objective: ${objective}`,
    '',
    'Operating contract',
    '- start from the queued objective and the added continuity packet files first',
    '- keep Hermes visibility local-first and Obsidian-first',
    '- prefer existing routes, MCP tools, and packet guidance over inventing new control paths',
    '- if you hit approval, policy, or architecture boundaries, stop and state the blocker clearly',
    '',
    'Current runtime state',
    `- workflow_status: ${compact(bundle.workflow.status) || '(unknown)'}`,
    `- runtime_lane: ${compact(bundle.runtime_lane) || '(unknown)'}`,
    `- route_mode: ${compact(bundle.route_mode) || '(unknown)'}`,
    `- continuity_next_action: ${compact(bundle.continuity.next_action) || '(none)'}`,
    `- hermes_readiness: ${compact(bundle.hermes_runtime.readiness) || '(unknown)'}`,
    `- queued_objectives_available: ${String(bundle.hermes_runtime.queued_objectives_available)}`,
  ];

  appendSection(lines, 'Activate First', launchSections.activateFirst);
  appendSection(lines, 'Read Next', launchSections.readNext);
  appendSection(lines, 'Tool Calls', toList(bundle.activation_pack.tool_calls).slice(0, 4));
  appendSection(lines, 'Commands', toList(bundle.activation_pack.commands).slice(0, 4));
  appendSection(lines, 'API Surfaces', toList(bundle.activation_pack.api_surfaces).slice(0, 4));
  appendSection(lines, 'MCP Surfaces', toList(bundle.activation_pack.mcp_surfaces).slice(0, 4));
  appendSection(lines, 'Fallback Order', toList(bundle.activation_pack.fallback_order).slice(0, 6));
  appendSection(lines, 'Recall Triggers', toList(bundle.recall_triggers).slice(0, 6));

  lines.push(
    '',
    'Decision Hints',
    `- latest_decision: ${compact(bundle.decision.summary) || '(none)'}`,
    `- latest_recall_blocker: ${compact(bundle.recall.blocked_action) || '(none)'}`,
    `- launch_target: ${objective}`,
    `- launch_target_source: ${launchSections.launchTargetSource || '(none)'}`,
    `- workflow_current_objective: ${launchSections.workflowCurrentObjective || '(unknown)'}`,
    '',
    'Turn Closeout',
    '- before ending the turn, acknowledge the result back into Hermes hot-state with the reentry ack command',
    `- completed example: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed${buildHermesReentryProfileFlag(contextProfile)} --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"`,
    `- blocked example: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=blocked${buildHermesReentryProfileFlag(contextProfile)} --summary="<blocker summary>" --blockedAction="<blocked action>" --nextAction="<required approval or recall step>"`,
    `- failed example: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=failed${buildHermesReentryProfileFlag(contextProfile)} --summary="<failure summary>" --blockedAction="<failed action>" --nextAction="<recovery step>"`,
    '- use the --name=value form exactly; the command records workflow events and can restart the queue-aware supervisor when safe',
  );

  return lines.join('\n').trim();
};

const buildHermesScoutLaunchPrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const profileFiles = collectHermesContextProfileFiles(SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE, params.bundle).slice(0, 8);
  const lines = [
    params.basePrompt,
    '',
    'Scout Contract',
    '- treat this turn as evidence gathering, route mapping, and upstream clarification before mutation',
    '- prefer shared Obsidian, shared MCP, GitHub, and DeepWiki surfaces before broad local markdown archaeology',
    '- keep the multi-plane split explicit: GitHub is the artifact and review plane, Supabase is hot-state, and shared Obsidian is the semantic owner',
    '- return a bounded next step with evidence refs, a short decision distillate, and any capability demand that blocks cheap progress',
  ];

  appendSection(lines, 'Scout Context Files', profileFiles);
  appendSection(lines, 'Scout Outputs', [
    'evidence refs with the exact docs, repo paths, or upstream sources that mattered',
    'one bounded next action that an executor profile can pick up without rereading everything',
    'one capability demand when a missing tool, source, or adapter blocks cheap progress',
  ]);

  return lines.join('\n').trim();
};

const buildHermesExecutorLaunchPrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const profileFiles = collectHermesContextProfileFiles(EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE, params.bundle).slice(0, 8);
  const lines = [
    params.basePrompt,
    '',
    'Executor Contract',
    '- stay inside the current bounded implementation slice and prefer small reversible edits over broad exploration',
    '- reuse the current architecture and runtime control surfaces rather than inventing parallel abstractions',
    '- validate with targeted tests and typecheck before closing out',
  ];

  appendSection(lines, 'Executor Context Files', profileFiles);
  appendSection(lines, 'Executor Validation', [
    'typecheck the touched slice before closeout when code changed',
    'record the exact changed paths or commands that produced the verified outcome',
    'if the work turns into research, stop and relaunch with scout or delegated-operator instead of mixing roles',
  ]);

  return lines.join('\n').trim();
};

const buildHermesDistillerLaunchPrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const profileFiles = collectHermesContextProfileFiles(DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE, params.bundle).slice(0, 8);
  const lines = [
    params.basePrompt,
    '',
    'Distiller Contract',
    '- treat this turn as closeout, compression, and shared-knowledge promotion work rather than new implementation',
    '- reduce the turn into a reusable summary, next action, evidence refs, and a promotion-worthy artifact when operator guidance changed',
    '- prefer changelog, development archaeology, and shared wiki mirror updates over leaving knowledge trapped in workflow events only',
  ];

  appendSection(lines, 'Distiller Context Files', profileFiles);
  appendSection(lines, 'Distiller Closeout Expectations', [
    'write a one-line summary that can become a decision distillate without cleanup',
    'state whether the result should be promoted into shared knowledge and why',
    'if operator-visible guidance changed, use the reentry ack closeout so the shared knowledge mirror is refreshed',
  ]);

  return lines.join('\n').trim();
};

const buildHermesGuardianLaunchPrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const profileFiles = collectHermesContextProfileFiles(GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE, params.bundle).slice(0, 8);
  const lines = [
    params.basePrompt,
    '',
    'Guardian Contract',
    '- prioritize queue health, stale reentry prevention, supervisor continuity, and safe recovery boundaries',
    '- prefer existing remediation actions and restart contracts before inventing new automation',
    '- if the issue is architectural rather than operational, stop and hand it back with a concise blocker and next action',
  ];

  appendSection(lines, 'Guardian Context Files', profileFiles);
  appendSection(lines, 'Guardian Checks', [
    'confirm whether reentry acknowledgment, queue launch state, and supervisor liveness are aligned',
    'treat rollback, recovery, and operator-visible guardrails as first-class outputs',
    'record the exact blocker or recovery step in closeout so the next cycle does not rediscover it',
  ]);

  return lines.join('\n').trim();
};

const buildHermesDelegatedLaunchPrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
}): string => {
  const delegatedFiles = collectHermesContextProfileFiles(DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE, params.bundle).slice(0, 8);
  const lines = [
    params.basePrompt,
    '',
    'Delegated Leverage Contract',
    '- do not stay inside a single pre-baked Hermes role; combine terminal, file, git, browser, GitHub, Obsidian, research, and delegation surfaces when they reduce reacquisition cost',
    '- start from the compact session-open bundle and the attached canonical docs before broad local archaeology',
    '- prefer shared Obsidian and shared MCP knowledge surfaces first when intent, roadmap, decision history, or operator context is involved',
    '- keep the multi-plane ownership split explicit: GitHub settles repo-visible artifacts, Supabase carries hot-state, and shared Obsidian keeps durable meaning',
    '- when an upstream repository, package, or external tool behavior matters, use GitHub or DeepWiki style research before guessing from stale memory',
    '- treat roadmap, execution-board, and runtime-contract docs as live constraints for bounded objective selection and closeout quality',
    '- compress useful findings back into evidence refs, decision distillates, capability demands, and the next bounded action instead of leaving raw transcript residue',
  ];

  appendSection(lines, 'Canonical Context Files', delegatedFiles);
  appendSection(lines, 'Preferred Research Surfaces', [
    'shared Obsidian and shared MCP for roadmap, vision, operator docs, and prior decisions',
    'GitHub or DeepWiki for upstream repository behavior and feature documentation',
    'local repo code, runtime artifacts, and packet state only after the compact bundle narrows the question',
  ]);
  appendSection(lines, 'Leverage Goals', [
    `use Hermes as a delegated local operator for ${params.objective}`,
    'expand beyond packet upkeep when bounded research, repo archaeology, or tool orchestration will cheaply unblock the objective',
    'leave a reusable bounded closeout that the next GPT turn can consume without replaying the whole investigation',
  ]);

  return lines.join('\n').trim();
};

const buildHermesContextProfilePrompt = (params: {
  basePrompt: string;
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
  contextProfile: HermesRuntimeContextProfile;
}): string => {
  switch (params.contextProfile) {
    case DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE:
      return buildHermesDelegatedLaunchPrompt(params);
    case SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE:
      return buildHermesScoutLaunchPrompt(params);
    case EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE:
      return buildHermesExecutorLaunchPrompt(params);
    case DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE:
      return buildHermesDistillerLaunchPrompt(params);
    case GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE:
      return buildHermesGuardianLaunchPrompt(params);
    default:
      return params.basePrompt;
  }
};

const collectRuntimeLaunchFiles = (params: {
  status: OpenJarvisAutopilotStatus;
  bundle: OpenJarvisSessionOpenBundle;
  objective: string;
  contextProfile: HermesRuntimeContextProfile;
  addFilePaths?: string[] | null;
}): string[] => {
  const resumeState = (params.status.resume_state && typeof params.status.resume_state === 'object')
    ? params.status.resume_state as Record<string, unknown>
    : {};
  const candidate = Array.isArray(params.status.autonomous_goal_candidates)
    ? params.status.autonomous_goal_candidates.find((entry) => normalizeObjective(entry?.objective) === normalizeObjective(params.objective))
    : null;
  const candidateSourcePath = compact(candidate?.source_path);
  const normalizedCandidatePath = candidateSourcePath
    ? (path.isAbsolute(candidateSourcePath) ? candidateSourcePath : path.resolve(REPO_ROOT, candidateSourcePath))
    : null;
  return uniqueStrings([
    ...(Array.isArray(params.addFilePaths) ? params.addFilePaths : []),
    ...collectHermesContextProfileFiles(params.contextProfile, params.bundle),
    compact(resumeState.progress_packet_path),
    compact(resumeState.handoff_packet_path),
    normalizedCandidatePath,
  ]).slice(0, MAX_HERMES_RUNTIME_LAUNCH_FILES);
};

const buildHermesSwarmLaunchPrompt = (params: {
  objective: string;
  bundle: OpenJarvisSessionOpenBundle;
  status: OpenJarvisAutopilotStatus;
  contextProfile: HermesRuntimeContextProfile;
  waveId: string;
  boardRelativePath: string | null;
  shardRelativePath: string;
  shard: HermesRuntimeNormalizedSwarmShard;
}): string => {
  const basePrompt = buildHermesRuntimeLaunchPrompt({
    objective: params.objective,
    bundle: params.bundle,
    status: params.status,
    contextProfile: params.contextProfile,
  });
  const profilePrompt = buildHermesContextProfilePrompt({
    basePrompt,
    objective: params.objective,
    bundle: params.bundle,
    contextProfile: params.contextProfile,
  });
  const ackBase = buildHermesSwarmAckFlagBase({
    contextProfile: params.contextProfile,
    boardRelativePath: params.boardRelativePath,
    shardRelativePath: params.shardRelativePath,
    waveId: params.waveId,
    shardId: params.shard.shardId,
  });
  const lines = [
    profilePrompt,
    '',
    'Parallel Swarm Contract',
    `- wave_id: ${params.waveId}`,
    `- shard_id: ${params.shard.shardId}`,
    `- worker_role: ${params.contextProfile}`,
    `- board_path: ${params.boardRelativePath || '(none)'}`,
    `- shard_packet: ${params.shardRelativePath}`,
    `- acceptance_owner: ${params.shard.acceptanceOwner || 'coordinator-gpt'}`,
    `- worktree_path: ${params.shard.worktreePath || '(none)'}`,
    '- do not widen scope outside this shard without recalling the coordinator',
    '- do not edit outside the artifact budget when code changes are involved',
  ];

  appendSection(lines, 'Artifact Budget', params.shard.artifactBudget);
  appendSection(lines, 'Shard Dependencies', params.shard.dependsOn);
  appendSection(lines, 'Recall Condition', [params.shard.recallCondition || 'Recall the coordinator on cross-shard conflicts, policy edges, or architecture changes.']);
  appendSection(lines, 'Definition Of Done', [params.shard.completionDefinition || 'Leave one bounded verified result that the coordinator can accept without replaying the whole turn.']);
  appendSection(lines, 'Swarm Closeout Ack', [
    `completed: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed ${ackBase} --summary="<one line outcome>" --nextAction="<next bounded step or wait boundary>"`,
    `blocked: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=blocked ${ackBase} --summary="<blocker summary>" --blockedAction="<blocked action>" --nextAction="<required recall step>"`,
    `failed: npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=failed ${ackBase} --summary="<failure summary>" --blockedAction="<failed action>" --nextAction="<recovery step>"`,
  ]);

  return lines.join('\n').trim();
};

const collectHermesSwarmLaunchFiles = (params: {
  status: OpenJarvisAutopilotStatus;
  bundle: OpenJarvisSessionOpenBundle;
  shard: HermesRuntimeNormalizedSwarmShard;
  boardAbsolutePath: string | null;
  shardAbsolutePath: string | null;
}): string[] => {
  const shardLaunchFiles: Array<string | null> = [
    ...params.shard.addFilePaths,
    ...params.shard.artifactBudget,
    params.boardAbsolutePath,
    params.shardAbsolutePath,
  ];

  return uniqueStrings([
    ...collectRuntimeLaunchFiles({
      status: params.status,
      bundle: params.bundle,
      objective: params.shard.objective,
      contextProfile: params.shard.contextProfile,
      addFilePaths: shardLaunchFiles.filter((entry): entry is string => Boolean(entry)),
    }),
    ...shardLaunchFiles,
  ]).slice(0, MAX_HERMES_RUNTIME_LAUNCH_FILES);
};

export const createOpenJarvisHermesRuntimeChatNote = async (
  params: HermesRuntimeChatNoteParams = {},
): Promise<HermesRuntimeChatNoteResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const requestTitle = compact(params.title) || DEFAULT_HERMES_RUNTIME_CHAT_TITLE;
  const requesterId = compact(params.requesterId) || DEFAULT_HERMES_RUNTIME_REQUESTER_ID;
  const requesterKind: InboxChatRequesterKind = params.requesterKind === 'bearer' ? 'bearer' : 'session';
  const guildId = compact(params.guildId);

  const finalize = (partial: Omit<HermesRuntimeChatNoteResult, 'startedAt' | 'finishedAt' | 'durationMs' | 'requestTitle'>): HermesRuntimeChatNoteResult => ({
    ...partial,
    requestTitle,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  const vaultPath = resolveVaultPath(params.vaultPath || null);
  if (!vaultPath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      fileName: null,
      notePath: null,
      requestMessage: null,
      errorCode: 'VAULT_PATH_REQUIRED',
      error: 'vault path is required for Hermes runtime chat note creation',
    });
  }

  const status = await getOpenJarvisAutopilotStatus(params);
  const bundle = await getOpenJarvisSessionOpenBundle({
    ...params,
    status,
  });
  const workflowSource = compact(status.workflow.source);
  const evidenceRefs = Array.isArray(bundle.evidence_refs)
    ? bundle.evidence_refs.map((ref) => compact(ref.locator)).filter(Boolean).slice(0, 8)
    : [];
  const capabilityDemandSummaries = Array.isArray(bundle.capability_demands)
    ? bundle.capability_demands.map((entry) => compact(entry.summary)).filter(Boolean).slice(0, 8)
    : [];
  const decisionTags = toList(bundle.decision.tags).slice(0, 8);
  const requestMessage = buildHermesRuntimeChatRequest({
    status,
    bundle,
  });
  const note = buildInboxChatNote({
    message: requestMessage,
    title: requestTitle,
    guildId,
    requesterId,
    requesterKind,
    now: new Date(),
  });
  const result = await writeObsidianNoteWithAdapter({
    guildId,
    vaultPath,
    fileName: note.fileName,
    content: note.content,
    tags: [...note.tags, 'hermes-runtime'],
    properties: {
      ...note.properties,
      source: 'hermes-runtime-chat',
      hermes_runtime_readiness: status.hermes_runtime.readiness,
      hermes_runtime_role: status.hermes_runtime.current_role,
      runtime_lane: compact(status.workflow.runtime_lane) || null,
      workflow_source: workflowSource || null,
      workflow_session_id: compact(status.workflow.session_id) || null,
      workflow_status: compact(status.workflow.status) || null,
      state_projection: workflowSource.toLowerCase() === 'supabase'
        ? 'supabase-hot-state-to-obsidian-projection'
        : 'runtime-hot-state-to-obsidian-projection',
      route_recommended_mode: compact(bundle.routing?.recommended_mode) || null,
      route_artifact_plane: compact(bundle.routing?.artifact_plane) || null,
      decision_summary: compact(bundle.decision.summary) || null,
      decision_next_action: compact(bundle.decision.next_action) || null,
      decision_tags: decisionTags.length > 0 ? decisionTags : null,
      recall_blocked_action: compact(bundle.recall.blocked_action) || null,
      capability_demands: capabilityDemandSummaries.length > 0 ? capabilityDemandSummaries : null,
      compact_bootstrap_next_queue_head: compact(bundle.compact_bootstrap?.next_queue_head) || null,
      evidence_refs: evidenceRefs.length > 0 ? evidenceRefs : null,
    },
    trustedSource: true,
  });

  if (!result?.path) {
    return finalize({
      ok: false,
      completion: 'skipped',
      fileName: note.fileName,
      notePath: null,
      requestMessage,
      errorCode: 'WRITE_FAILED',
      error: 'failed to create Hermes runtime Obsidian chat note',
    });
  }

  return finalize({
    ok: true,
    completion: 'created',
    fileName: note.fileName,
    notePath: result.path,
    requestMessage,
    errorCode: null,
    error: null,
  });
};

export const enqueueOpenJarvisHermesRuntimeObjectives = async (
  params: HermesRuntimeQueueObjectiveParams = {},
): Promise<HermesRuntimeQueueObjectiveResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;
  const replaceExisting = params.replaceExisting === true;
  const requestedObjectives = uniqueStrings([
    compact(params.objective),
    ...toList(params.objectives),
  ]);

  const finalize = (partial: Omit<HermesRuntimeQueueObjectiveResult, 'startedAt' | 'finishedAt' | 'durationMs' | 'requestedObjectives'>): HermesRuntimeQueueObjectiveResult => ({
    ...partial,
    requestedObjectives,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  if (requestedObjectives.length === 0) {
    return finalize({
      ok: false,
      completion: 'skipped',
      queuedObjectives: [],
      handoffPacketPath: null,
      errorCode: 'VALIDATION',
      error: 'at least one objective is required',
    });
  }

  const vaultPath = resolveVaultPath(params.vaultPath || null);
  if (!vaultPath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      queuedObjectives: [],
      handoffPacketPath: null,
      errorCode: 'VAULT_PATH_REQUIRED',
      error: 'vault path is required for Hermes queue writes',
    });
  }

  const status = await getOpenJarvisAutopilotStatus(params);
  const resumeState = (status.resume_state && typeof status.resume_state === 'object')
    ? status.resume_state as Record<string, unknown>
    : {};
  const handoffPacketRelativePath = resolveHandoffPacketRelativePath(resumeState);
  const handoffContent = await readVaultDocument(vaultPath, handoffPacketRelativePath);
  if (handoffContent === null) {
    return finalize({
      ok: false,
      completion: 'skipped',
      queuedObjectives: [],
      handoffPacketPath: resolveVaultAbsolutePath(vaultPath, handoffPacketRelativePath),
      errorCode: 'HANDOFF_PACKET_MISSING',
      error: 'handoff packet is missing for Hermes queue writes',
    });
  }

  const existingQueue = extractBulletSection(handoffContent, SAFE_QUEUE_SECTION_HEADING);
  const queuedObjectives = uniqueStrings(replaceExisting
    ? requestedObjectives
    : [
      ...requestedObjectives,
      ...existingQueue,
    ]).slice(0, MAX_SAFE_QUEUE_ITEMS);
  const handoffPacketPath = resolveVaultRelativePath(vaultPath, handoffPacketRelativePath)
    || resolveVaultAbsolutePath(vaultPath, handoffPacketRelativePath);

  if (dryRun) {
    return finalize({
      ok: true,
      completion: 'skipped',
      queuedObjectives,
      handoffPacketPath,
      errorCode: null,
      error: null,
    });
  }

  const nextContent = replaceBulletSection(handoffContent, SAFE_QUEUE_SECTION_HEADING, queuedObjectives);
  const writtenHandoffPacketPath = await writeVaultDocument({
    vaultPath,
    relativePath: handoffPacketRelativePath,
    content: nextContent,
  });

  if (!writtenHandoffPacketPath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      queuedObjectives: existingQueue,
      handoffPacketPath: resolveVaultAbsolutePath(vaultPath, handoffPacketRelativePath),
      errorCode: 'WRITE_FAILED',
      error: 'failed to update the Hermes handoff packet queue',
    });
  }

  const completion = areStringListsEqual(queuedObjectives, existingQueue) ? 'skipped' : 'updated';
  return finalize({
    ok: true,
    completion,
    queuedObjectives,
    handoffPacketPath: writtenHandoffPacketPath,
    errorCode: null,
    error: null,
  });
};

export const autoQueueOpenJarvisHermesRuntimeObjectives = async (
  params: HermesRuntimeAutoQueueParams = {},
): Promise<HermesRuntimeAutoQueueResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const finalize = (partial: Omit<HermesRuntimeAutoQueueResult, 'startedAt' | 'finishedAt' | 'durationMs'>): HermesRuntimeAutoQueueResult => ({
    ...partial,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  const status = params.status || await getOpenJarvisAutopilotStatus(params);
  const bundle = params.bundle || await getOpenJarvisSessionOpenBundle({
    ...params,
    status,
  });
  const capacity = status.capacity && typeof status.capacity === 'object'
    ? status.capacity as Record<string, unknown>
    : null;
  const loopAction = compact(capacity?.loop_action).toLowerCase();

  if (status.hermes_runtime.queued_objectives_available === true && status.autonomous_goal_candidates.length > 0) {
    return finalize({
      ok: true,
      completion: 'skipped',
      synthesizedObjectives: [],
      queueObjective: null,
      errorCode: null,
      error: null,
    });
  }

  if (loopAction === 'escalate') {
    return finalize({
      ok: true,
      completion: 'skipped',
      synthesizedObjectives: [],
      queueObjective: null,
      errorCode: null,
      error: null,
    });
  }

  const synthesizedObjectives = synthesizeRuntimeQueuedObjectives({
    status,
    bundle,
  });

  if (synthesizedObjectives.length === 0) {
    return finalize({
      ok: true,
      completion: 'skipped',
      synthesizedObjectives: [],
      queueObjective: null,
      errorCode: 'NO_SYNTHESIZED_OBJECTIVES',
      error: 'no bounded queued objective could be synthesized from the current Hermes runtime state',
    });
  }

  const queueObjective = await enqueueOpenJarvisHermesRuntimeObjectives({
    ...params,
    objective: null,
    objectives: synthesizedObjectives,
    dryRun: params.dryRun === true,
  });

  return finalize({
    ok: queueObjective.ok,
    completion: queueObjective.ok ? queueObjective.completion : 'skipped',
    synthesizedObjectives,
    queueObjective,
    errorCode: queueObjective.ok ? null : queueObjective.errorCode,
    error: queueObjective.ok ? null : queueObjective.error,
  });
};

const summarizeHermesRuntimeStatus = (status: OpenJarvisAutopilotStatus) => ({
  readiness: compact(status.hermes_runtime.readiness) || null,
  currentRole: compact(status.hermes_runtime.current_role) || null,
  supervisorAlive: status.hermes_runtime.supervisor_alive === true,
  queuedObjectivesAvailable: status.hermes_runtime.queued_objectives_available === true,
});

export const prepareOpenJarvisHermesSessionStart = async (
  params: HermesSessionStartPrepParams = {},
): Promise<HermesSessionStartPrepResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const createChatNote = params.createChatNote !== false;
  const startSupervisor = params.startSupervisor !== false;
  const requestedObjectives = uniqueStrings([
    compact(params.objective),
    ...toList(params.objectives),
  ]);
  const sharedObsidianPreferred = shouldPreferSharedObsidianIngress();

  const finalize = (partial: Omit<HermesSessionStartPrepResult, 'startedAt' | 'finishedAt' | 'durationMs' | 'sharedObsidianPreferred'>): HermesSessionStartPrepResult => ({
    ...partial,
    sharedObsidianPreferred,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  try {
    const status = await getOpenJarvisAutopilotStatus(params);
    const bundle = await getOpenJarvisSessionOpenBundle({
      ...params,
      status,
    });
    const statusSummary = summarizeHermesRuntimeStatus(status);
    const vaultPath = resolveVaultPath(params.vaultPath || null);

    if ((createChatNote || requestedObjectives.length > 0) && !vaultPath) {
      return finalize({
        ok: false,
        completion: 'skipped',
        statusSummary,
        bundle,
        chatNote: null,
        queueObjective: null,
        remediation: null,
        errorCode: 'VAULT_PATH_REQUIRED',
        error: 'vault path is required for session-start Obsidian projection',
      });
    }

    const queueObjective = requestedObjectives.length > 0
      ? await enqueueOpenJarvisHermesRuntimeObjectives({
        ...params,
        objective: null,
        objectives: requestedObjectives,
        vaultPath,
        dryRun: params.dryRun === true,
      })
      : null;

    const canStartSupervisor = startSupervisor
      && status.hermes_runtime.supervisor_alive !== true
      && status.hermes_runtime.remediation_actions.some((action) => action.action_id === 'start-supervisor-loop');

    const remediation = canStartSupervisor
      ? await runOpenJarvisHermesRuntimeRemediation({
        ...params,
        actionId: 'start-supervisor-loop',
        vaultPath,
        dryRun: params.dryRun === true,
        visibleTerminal: params.visibleTerminal !== false,
        autoLaunchQueuedChat: params.autoLaunchQueuedChat === true,
        autoLaunchQueuedSwarm: params.autoLaunchQueuedSwarm === true,
        autoLaunchQueuedChatContextProfile: params.contextProfile || null,
      })
      : null;

    const chatNote = createChatNote
      ? await createOpenJarvisHermesRuntimeChatNote({
        ...params,
        title: compact(params.title) || null,
        guildId: compact(params.guildId) || null,
        requesterId: compact(params.requesterId) || DEFAULT_HERMES_RUNTIME_REQUESTER_ID,
        requesterKind: params.requesterKind === 'bearer' ? 'bearer' : 'session',
        vaultPath,
      })
      : null;

    const ok = (queueObjective?.ok ?? true)
      && (remediation?.ok ?? true)
      && (chatNote?.ok ?? true);

    return finalize({
      ok,
      completion: ok ? 'prepared' : 'skipped',
      statusSummary,
      bundle,
      chatNote,
      queueObjective,
      remediation,
      errorCode: ok ? null : 'PREP_FAILED',
      error: ok ? null : 'one or more session-start preparation actions failed',
    });
  } catch (error) {
    return finalize({
      ok: false,
      completion: 'skipped',
      statusSummary: null,
      bundle: null,
      chatNote: null,
      queueObjective: null,
      remediation: null,
      errorCode: 'PREP_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const launchOpenJarvisHermesChatSession = async (
  params: HermesRuntimeLaunchChatParams = {},
): Promise<HermesRuntimeLaunchChatResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;
  const requestedContextProfile = normalizeHermesRuntimeContextProfile(params.contextProfile);

  const finalize = (partial: Omit<HermesRuntimeLaunchChatResult, 'startedAt' | 'finishedAt' | 'durationMs'>): HermesRuntimeLaunchChatResult => ({
    ...partial,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  const status = await getOpenJarvisAutopilotStatus(params);
  const resolvedObjective = normalizeObjective(params.objective)
    || normalizeObjective(status.autonomous_goal_candidates?.[0]?.objective)
    || normalizeObjective(status.workflow.objective);
  if (!resolvedObjective) {
    return finalize({
      ok: false,
      completion: 'skipped',
      objective: null,
      contextProfile: null,
      prompt: null,
      addFilePaths: [],
      command: null,
      pid: null,
      errorCode: 'VALIDATION',
      error: 'no queued or active objective is available for VS Code chat launch',
    });
  }

  const bundle = await getOpenJarvisSessionOpenBundle({
    ...params,
    status,
  });
  const contextProfile = inferHermesRuntimeContextProfile({
    requestedProfile: requestedContextProfile,
    objective: resolvedObjective,
    bundle,
    status,
  });
  const basePrompt = compact(params.prompt) || buildHermesRuntimeLaunchPrompt({
    objective: resolvedObjective,
    bundle,
    status,
    contextProfile,
  });
  const prompt = buildHermesContextProfilePrompt({
    basePrompt,
    objective: resolvedObjective,
    bundle,
    contextProfile,
  });
  const addFilePaths = collectRuntimeLaunchFiles({
    status,
    bundle,
    objective: resolvedObjective,
    contextProfile,
    addFilePaths: params.addFilePaths || null,
  });
  const resumeState = (status.resume_state && typeof status.resume_state === 'object')
    ? status.resume_state as Record<string, unknown>
    : {};
  const packetPath = compact(resumeState.handoff_packet_path) || compact(resumeState.progress_packet_path) || null;

  const bridgeResult = await runHermesVsCodeBridge({
    action: 'chat',
    prompt,
    chatMode: compact(params.chatMode) || DEFAULT_HERMES_CHAT_MODE,
    addFilePaths,
    allowedRoots: params.allowedRoots || null,
    maximize: params.maximize !== false,
    newWindow: params.newWindow === true,
    reuseWindow: params.newWindow === true ? false : params.reuseWindow !== false,
    packetPath,
    vaultPath: params.vaultPath || null,
    dryRun,
    reason: `launch queued GPT task for ${resolvedObjective}`,
  });

  return finalize({
    ok: bridgeResult.ok,
    completion: bridgeResult.completion === 'completed' ? 'queued' : bridgeResult.completion,
    objective: resolvedObjective,
    contextProfile,
    prompt,
    addFilePaths,
    command: bridgeResult.command,
    pid: bridgeResult.pid,
    errorCode: bridgeResult.ok
      ? null
      : (bridgeResult.errorCode === 'CODE_CLI_MISSING'
        ? 'CODE_CLI_MISSING'
        : (['PACKET_PATH_MISSING', 'PACKET_NOT_FOUND'].includes(String(bridgeResult.errorCode || ''))
          ? 'PACKET_PATH_MISSING'
          : 'COMMAND_FAILED')),
    error: bridgeResult.error,
    bridgeResult,
  });
};

export const launchOpenJarvisHermesSwarmWave = async (
  params: HermesRuntimeLaunchSwarmParams = {},
): Promise<HermesRuntimeLaunchSwarmResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;

  const finalize = (partial: Omit<HermesRuntimeLaunchSwarmResult, 'startedAt' | 'finishedAt' | 'durationMs'>): HermesRuntimeLaunchSwarmResult => ({
    ...partial,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  const vaultPath = resolveVaultPath(params.vaultPath || null);
  if (!vaultPath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId: null,
      waveObjective: null,
      boardPath: null,
      shardPaths: [],
      launches: [],
      errorCode: 'VAULT_PATH_REQUIRED',
      error: 'vault path is required for Hermes swarm planning and launch',
    });
  }

  const status = await getOpenJarvisAutopilotStatus(params);
  const bundle = await getOpenJarvisSessionOpenBundle({
    ...params,
    status,
  });
  const waveObjective = normalizeObjective(params.waveObjective)
    || normalizeObjective(status.autonomous_goal_candidates?.[0]?.objective)
    || normalizeObjective(status.workflow.objective);
  if (!waveObjective) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId: null,
      waveObjective: null,
      boardPath: null,
      shardPaths: [],
      launches: [],
      errorCode: 'VALIDATION',
      error: 'wave objective is required for Hermes swarm launch',
    });
  }

  const shards = normalizeHermesSwarmShards({
    shards: params.shards,
    waveObjective,
    includeDistiller: params.includeDistiller === true,
  });
  if (shards.length === 0) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId: null,
      waveObjective,
      boardPath: null,
      shardPaths: [],
      launches: [],
      errorCode: 'VALIDATION',
      error: 'at least one valid swarm shard is required',
    });
  }

  const waveId = buildHermesSwarmWaveId(waveObjective);
  const boardRelativePath = resolveVaultRelativePath(vaultPath, params.boardPath || DEFAULT_HERMES_SWARM_BOARD_RELATIVE_PATH);
  const boardAbsolutePath = boardRelativePath ? resolveVaultAbsolutePath(vaultPath, boardRelativePath) : null;
  if (!boardRelativePath || !boardAbsolutePath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId,
      waveObjective,
      boardPath: null,
      shardPaths: [],
      launches: [],
      errorCode: 'VALIDATION',
      error: 'swarm board path could not be resolved inside the vault root',
    });
  }

  const shardPlans = shards.map((shard, index) => {
    const shardRelativePath = `${DEFAULT_HERMES_SWARM_SHARDS_DIR}/${waveId}/${String(index + 1).padStart(2, '0')}-${shard.shardId}.md`;
    const shardAbsolutePath = resolveVaultAbsolutePath(vaultPath, shardRelativePath);
    const prompt = buildHermesSwarmLaunchPrompt({
      objective: shard.objective,
      bundle,
      status,
      contextProfile: shard.contextProfile,
      waveId,
      boardRelativePath,
      shardRelativePath,
      shard,
    });
    return {
      shard,
      shardRelativePath,
      shardAbsolutePath,
      prompt,
    };
  });

  if (!dryRun) {
    const initialBoardContent = buildHermesSwarmBoardContent({
      waveId,
      waveObjective,
      boardRelativePath,
      shards: shardPlans.map((entry) => ({
        shard: entry.shard,
        shardPath: entry.shardRelativePath,
        state: 'planned',
      })),
    });
    const writtenBoardPath = await writeVaultDocument({
      vaultPath,
      relativePath: boardRelativePath,
      content: initialBoardContent,
    });
    if (!writtenBoardPath) {
      return finalize({
        ok: false,
        completion: 'skipped',
        waveId,
        waveObjective,
        boardPath: boardRelativePath,
        shardPaths: shardPlans.map((entry) => entry.shardRelativePath),
        launches: [],
        errorCode: 'WRITE_FAILED',
        error: 'failed to write the Hermes swarm board note',
      });
    }

    for (const shardPlan of shardPlans) {
      const content = buildHermesSwarmShardPacketContent({
        waveId,
        boardRelativePath,
        shardRelativePath: shardPlan.shardRelativePath,
        shard: shardPlan.shard,
        state: 'planned',
        prompt: shardPlan.prompt,
      });
      const writtenShardPath = await writeVaultDocument({
        vaultPath,
        relativePath: shardPlan.shardRelativePath,
        content,
      });
      if (!writtenShardPath) {
        return finalize({
          ok: false,
          completion: 'skipped',
          waveId,
          waveObjective,
          boardPath: boardRelativePath,
          shardPaths: shardPlans.map((entry) => entry.shardRelativePath),
          launches: [],
          errorCode: 'WRITE_FAILED',
          error: `failed to write the Hermes swarm shard packet for ${shardPlan.shard.shardId}`,
        });
      }
    }
  }

  const launches: HermesRuntimeLaunchSwarmShardResult[] = [];
  let overallOk = true;

  for (const shardPlan of shardPlans) {
    const addFilePaths = collectHermesSwarmLaunchFiles({
      status,
      bundle,
      shard: shardPlan.shard,
      boardAbsolutePath,
      shardAbsolutePath: shardPlan.shardAbsolutePath,
    });
    const launchResult = await launchOpenJarvisHermesChatSession({
      ...params,
      objective: shardPlan.shard.objective,
      prompt: shardPlan.prompt,
      contextProfile: shardPlan.shard.contextProfile,
      addFilePaths,
      allowedRoots: shardPlan.shard.worktreePath ? [shardPlan.shard.worktreePath] : null,
      maximize: params.maximize !== false,
      newWindow: params.newWindow !== false,
      reuseWindow: params.newWindow === true ? false : params.reuseWindow === true,
      dryRun,
      vaultPath,
    });
    const shardResult: HermesRuntimeLaunchSwarmShardResult = {
      shardId: shardPlan.shard.shardId,
      objective: shardPlan.shard.objective,
      contextProfile: shardPlan.shard.contextProfile,
      boardPath: boardRelativePath,
      shardPath: shardPlan.shardRelativePath,
      worktreePath: shardPlan.shard.worktreePath,
      completion: launchResult.completion,
      command: launchResult.command,
      pid: launchResult.pid,
      errorCode: launchResult.errorCode,
      error: launchResult.error,
      launchResult,
    };
    launches.push(shardResult);
    overallOk = overallOk && launchResult.ok;

    if (!dryRun) {
      const nextShardContent = buildHermesSwarmShardPacketContent({
        waveId,
        boardRelativePath,
        shardRelativePath: shardPlan.shardRelativePath,
        shard: shardPlan.shard,
        state: launchResult.ok ? 'queued' : 'failed',
        prompt: shardPlan.prompt,
        launchCommand: launchResult.command,
        pid: launchResult.pid,
      });
      const writtenShardPath = await writeVaultDocument({
        vaultPath,
        relativePath: shardPlan.shardRelativePath,
        content: nextShardContent,
      });
      if (!writtenShardPath) {
        overallOk = false;
      }
    }
  }

  if (!dryRun) {
    const finalBoardContent = buildHermesSwarmBoardContent({
      waveId,
      waveObjective,
      boardRelativePath,
      shards: launches.map((launchResult) => ({
        shard: shardPlans.find((entry) => entry.shard.shardId === launchResult.shardId)?.shard || shardPlans[0].shard,
        shardPath: launchResult.shardPath,
        state: launchResult.error ? 'failed' : (launchResult.completion === 'queued' ? 'queued' : 'planned'),
        pid: launchResult.pid,
      })),
    });
    const writtenBoardPath = await writeVaultDocument({
      vaultPath,
      relativePath: boardRelativePath,
      content: finalBoardContent,
    });
    if (!writtenBoardPath) {
      overallOk = false;
    }
  }

  return finalize({
    ok: overallOk,
    completion: dryRun ? 'skipped' : 'queued',
    waveId,
    waveObjective,
    boardPath: boardRelativePath,
    shardPaths: shardPlans.map((entry) => entry.shardRelativePath),
    launches,
    errorCode: overallOk ? null : 'WRITE_FAILED',
    error: overallOk ? null : 'one or more swarm artifacts or launches failed',
  });
};

export const recordOpenJarvisHermesSwarmCloseout = async (
  params: HermesRuntimeSwarmCloseoutParams,
): Promise<HermesRuntimeSwarmCloseoutResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;
  const shardId = slugifyHermesToken(params.shardId, 'shard');
  const workerRole = normalizeHermesRuntimeContextProfile(params.workerRole);
  const vaultPath = resolveVaultPath(params.vaultPath || null);

  const finalize = (partial: Omit<HermesRuntimeSwarmCloseoutResult, 'startedAt' | 'finishedAt' | 'durationMs'>): HermesRuntimeSwarmCloseoutResult => ({
    ...partial,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  if (!vaultPath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId: toNullableString(params.waveId),
      shardId: toNullableString(params.shardId),
      workerRole,
      boardPath: toNullableString(params.boardPath),
      shardPath: toNullableString(params.shardPath),
      errorCode: 'VAULT_PATH_REQUIRED',
      error: 'vault path is required to record Hermes swarm closeout state',
    });
  }

  const boardRelativePath = params.boardPath ? resolveVaultRelativePath(vaultPath, params.boardPath) : null;
  const shardRelativePath = params.shardPath ? resolveVaultRelativePath(vaultPath, params.shardPath) : null;
  if (!boardRelativePath && !shardRelativePath) {
    return finalize({
      ok: false,
      completion: 'skipped',
      waveId: toNullableString(params.waveId),
      shardId: toNullableString(params.shardId),
      workerRole,
      boardPath: null,
      shardPath: null,
      errorCode: 'VALIDATION',
      error: 'at least one board or shard path is required for swarm closeout recording',
    });
  }

  const acknowledgedAt = new Date().toISOString();
  const closeoutLine = buildHermesSwarmCloseoutLine({
    acknowledgedAt,
    waveId: toNullableString(params.waveId),
    shardId,
    workerRole,
    completionStatus: params.completionStatus,
    summary: toNullableString(params.summary),
    nextAction: toNullableString(params.nextAction),
    blockedAction: toNullableString(params.blockedAction),
  });

  if (dryRun) {
    return finalize({
      ok: true,
      completion: 'skipped',
      waveId: toNullableString(params.waveId),
      shardId,
      workerRole,
      boardPath: boardRelativePath,
      shardPath: shardRelativePath,
      errorCode: null,
      error: null,
    });
  }

  if (boardRelativePath) {
    const boardContent = await readVaultDocument(vaultPath, boardRelativePath);
    if (boardContent === null) {
      return finalize({
        ok: false,
        completion: 'skipped',
        waveId: toNullableString(params.waveId),
        shardId,
        workerRole,
        boardPath: boardRelativePath,
        shardPath: shardRelativePath,
        errorCode: 'WRITE_FAILED',
        error: 'failed to read the Hermes swarm board note',
      });
    }
    const nextBoardContent = upsertBulletSectionItem({
      content: boardContent,
      heading: HERMES_SWARM_CLOSEOUTS_SECTION_HEADING,
      match: (item) => item.includes(`shard_id=${shardId}`),
      nextItem: closeoutLine,
      maxItems: 16,
    });
    const writtenBoardPath = await writeVaultDocument({
      vaultPath,
      relativePath: boardRelativePath,
      content: nextBoardContent,
    });
    if (!writtenBoardPath) {
      return finalize({
        ok: false,
        completion: 'skipped',
        waveId: toNullableString(params.waveId),
        shardId,
        workerRole,
        boardPath: boardRelativePath,
        shardPath: shardRelativePath,
        errorCode: 'WRITE_FAILED',
        error: 'failed to update the Hermes swarm board note',
      });
    }
  }

  if (shardRelativePath) {
    const shardContent = await readVaultDocument(vaultPath, shardRelativePath);
    if (shardContent === null) {
      return finalize({
        ok: false,
        completion: 'skipped',
        waveId: toNullableString(params.waveId),
        shardId,
        workerRole,
        boardPath: boardRelativePath,
        shardPath: shardRelativePath,
        errorCode: 'WRITE_FAILED',
        error: 'failed to read the Hermes swarm shard packet',
      });
    }
    const nextStatusLines = [
      `state: ${params.completionStatus}`,
      `wave_id: ${toNullableString(params.waveId) || '(none)'}`,
      `shard_id: ${shardId}`,
      `worker_role: ${workerRole}`,
      `summary: ${toNullableString(params.summary) || '(none)'}`,
      `next_action: ${toNullableString(params.nextAction) || '(none)'}`,
      `blocked_action: ${toNullableString(params.blockedAction) || '(none)'}`,
      `acknowledged_at: ${acknowledgedAt}`,
    ];
    let nextShardContent = replaceBulletSection(shardContent, HERMES_SWARM_STATUS_SECTION_HEADING, nextStatusLines);
    nextShardContent = replaceBulletSection(nextShardContent, HERMES_SWARM_LATEST_CLOSEOUT_SECTION_HEADING, [closeoutLine]);
    nextShardContent = upsertBulletSectionItem({
      content: nextShardContent,
      heading: HERMES_SWARM_ACK_HISTORY_SECTION_HEADING,
      match: (item) => item === closeoutLine,
      nextItem: closeoutLine,
      maxItems: 12,
    });
    const writtenShardPath = await writeVaultDocument({
      vaultPath,
      relativePath: shardRelativePath,
      content: nextShardContent,
    });
    if (!writtenShardPath) {
      return finalize({
        ok: false,
        completion: 'skipped',
        waveId: toNullableString(params.waveId),
        shardId,
        workerRole,
        boardPath: boardRelativePath,
        shardPath: shardRelativePath,
        errorCode: 'WRITE_FAILED',
        error: 'failed to update the Hermes swarm shard packet',
      });
    }
  }

  return finalize({
    ok: true,
    completion: 'updated',
    waveId: toNullableString(params.waveId),
    shardId,
    workerRole,
    boardPath: boardRelativePath,
    shardPath: shardRelativePath,
    errorCode: null,
    error: null,
  });
};

const buildGoalCycleCommand = (params: {
  runtimeLane?: string | null;
  sessionPath?: string | null;
  vaultPath?: string | null;
  capacityTarget?: number | null;
  gcpCapacityRecoveryRequested?: boolean;
  visibleTerminal?: boolean;
  autoLaunchQueuedChat?: boolean;
  autoLaunchQueuedChatContextProfile?: string | null;
  autoLaunchQueuedSwarm?: boolean;
  autoLaunchQueuedSwarmIncludeDistiller?: boolean;
  autoLaunchQueuedSwarmExecutorWorktreePath?: string | null;
  autoLaunchQueuedSwarmExecutorArtifactBudget?: string[] | null;
  dryRun?: boolean;
}): string[] => {
  const args = [
    'scripts/run-openjarvis-goal-cycle.mjs',
    '--resumeFromPackets=true',
    '--continuousLoop=true',
    '--autoSelectQueuedObjective=true',
    '--maxCycles=0',
    '--maxIdleChecks=0',
    `--dryRun=${params.dryRun === true ? 'true' : 'false'}`,
    `--visibleTerminal=${params.visibleTerminal === false ? 'false' : 'true'}`,
  ];

  const runtimeLane = compact(params.runtimeLane);
  if (runtimeLane) {
    args.push(`--runtimeLane=${runtimeLane}`);
  }
  const sessionPath = compact(params.sessionPath);
  if (sessionPath) {
    args.push(`--sessionPath=${sessionPath}`);
  }
  const vaultPath = compact(params.vaultPath);
  if (vaultPath) {
    args.push(`--vaultPath=${vaultPath}`);
  }
  if (Number.isFinite(Number(params.capacityTarget))) {
    args.push(`--capacityTarget=${Number(params.capacityTarget)}`);
  }
  if (params.gcpCapacityRecoveryRequested === true) {
    args.push('--gcpCapacityRecovery=true');
  }
  if (params.autoLaunchQueuedSwarm === true) {
    args.push('--autoLaunchQueuedSwarm=true');
  }
  if (params.autoLaunchQueuedChat === true) {
    args.push('--autoLaunchQueuedChat=true');
  }
  const autoLaunchQueuedChatContextProfile = compact(params.autoLaunchQueuedChatContextProfile);
  if (params.autoLaunchQueuedSwarm === true) {
    if (params.autoLaunchQueuedSwarmIncludeDistiller === true) {
      args.push('--autoLaunchQueuedSwarmIncludeDistiller=true');
    }
    const executorWorktreePath = compact(params.autoLaunchQueuedSwarmExecutorWorktreePath);
    if (executorWorktreePath) {
      args.push(`--autoLaunchQueuedSwarmExecutorWorktreePath=${executorWorktreePath}`);
    }
    const executorArtifactBudget = toList(params.autoLaunchQueuedSwarmExecutorArtifactBudget)
      .map((entry) => compact(entry))
      .filter(Boolean);
    if (executorArtifactBudget.length > 0) {
      args.push(`--autoLaunchQueuedSwarmExecutorArtifactBudget=${executorArtifactBudget.join(',')}`);
    }
  } else if (autoLaunchQueuedChatContextProfile) {
    args.push(`--autoLaunchQueuedChatContextProfile=${autoLaunchQueuedChatContextProfile}`);
  }

  return args;
};

export const runOpenJarvisHermesRuntimeRemediation = async (
  params: HermesRuntimeRemediationParams = {},
): Promise<HermesRuntimeRemediationResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const actionId = isHermesRuntimeRemediationActionId(params.actionId) ? params.actionId : null;
  const dryRun = params.dryRun === true;

  const finalize = (partial: Omit<HermesRuntimeRemediationResult, 'startedAt' | 'finishedAt' | 'durationMs' | 'dryRun'>): HermesRuntimeRemediationResult => ({
    ...partial,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  });

  if (!actionId) {
    return finalize({
      ok: false,
      actionId: null,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'VALIDATION',
      error: 'actionId is required',
    });
  }

  const status = await getOpenJarvisAutopilotStatus(params);
  const resumeState = (status.resume_state && typeof status.resume_state === 'object')
    ? status.resume_state as Record<string, unknown>
    : {};
  const progressPacketRelativePath = compact(resumeState.progress_packet_relative_path);
  const progressPacketAbsolutePath = resolveProgressPacketAbsolutePath({
    vaultPath: params.vaultPath || null,
    progressPacketRelativePath,
  });

  if (actionId === 'start-supervisor-loop') {
    const commandArgs = buildGoalCycleCommand({
      runtimeLane: params.runtimeLane || status.workflow.runtime_lane || null,
      sessionPath: params.sessionPath || null,
      vaultPath: params.vaultPath || null,
      capacityTarget: params.capacityTarget ?? null,
      gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested === true,
      visibleTerminal: params.visibleTerminal !== false,
      autoLaunchQueuedChat: params.autoLaunchQueuedChat === true,
      autoLaunchQueuedChatContextProfile: params.autoLaunchQueuedChatContextProfile || null,
      autoLaunchQueuedSwarm: params.autoLaunchQueuedSwarm === true,
      autoLaunchQueuedSwarmIncludeDistiller: params.autoLaunchQueuedSwarmIncludeDistiller === true,
      autoLaunchQueuedSwarmExecutorWorktreePath: params.autoLaunchQueuedSwarmExecutorWorktreePath || null,
      autoLaunchQueuedSwarmExecutorArtifactBudget: params.autoLaunchQueuedSwarmExecutorArtifactBudget || null,
      dryRun,
    });
    const command = ['node', ...commandArgs].join(' ');

    if (dryRun) {
      return finalize({
        ok: true,
        actionId,
        completion: 'queued',
        command,
        pid: null,
        stdoutLines: [],
        stderrLines: [],
        errorCode: null,
        error: null,
      });
    }

    try {
      const pid = await queueNodeCommand(commandArgs);
      return finalize({
        ok: true,
        actionId,
        completion: 'queued',
        command,
        pid,
        stdoutLines: [],
        stderrLines: [],
        errorCode: null,
        error: null,
      });
    } catch (error) {
      return finalize({
        ok: false,
        actionId,
        completion: 'skipped',
        command,
        pid: null,
        stdoutLines: [],
        stderrLines: [],
        errorCode: 'COMMAND_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!progressPacketAbsolutePath) {
    return finalize({
      ok: false,
      actionId,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'PACKET_PATH_MISSING',
      error: 'progress packet path could not be resolved for Hermes bridge remediation',
    });
  }

  const bridgeResult = await runHermesVsCodeBridge({
    action: 'open',
    targetPath: actionId === 'open-execution-board' ? EXECUTION_BOARD_PATH : progressPacketAbsolutePath,
    packetPath: progressPacketAbsolutePath,
    vaultPath: params.vaultPath || null,
    dryRun,
  });

  return finalize({
    ok: bridgeResult.ok,
    actionId,
    completion: bridgeResult.completion,
    command: bridgeResult.command,
    pid: bridgeResult.pid,
    stdoutLines: bridgeResult.stdoutLines,
    stderrLines: bridgeResult.stderrLines,
    errorCode: bridgeResult.ok ? null : (bridgeResult.errorCode === 'PACKET_PATH_MISSING' ? 'PACKET_PATH_MISSING' : 'COMMAND_FAILED'),
    error: bridgeResult.error,
    bridgeResult,
  });
};

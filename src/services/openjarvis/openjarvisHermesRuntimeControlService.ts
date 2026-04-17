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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../../');
const EXECUTION_BOARD_PATH = path.resolve(REPO_ROOT, 'docs/planning/EXECUTION_BOARD.md');
const DEFAULT_HERMES_RUNTIME_CHAT_TITLE = 'Hermes Runtime Handoff';
const DEFAULT_HERMES_RUNTIME_REQUESTER_ID = 'hermes-runtime';
const DEFAULT_HERMES_CHAT_MODE = 'agent';
const DEFAULT_HANDOFF_PACKET_RELATIVE_PATH = 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md';
const DEFAULT_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'default';
const AUTO_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'auto';
const DELEGATED_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'delegated-operator';
const SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'scout';
const EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'executor';
const DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'distiller';
const GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE: HermesRuntimeContextProfile = 'guardian';
const MAX_HERMES_RUNTIME_LAUNCH_FILES = 12;
const SAFE_QUEUE_SECTION_HEADING = 'Safe Autonomous Queue For Hermes';
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

  const signalText = [
    params.objective,
    compact(params.bundle.decision.summary),
    compact(params.bundle.decision.next_action),
    compact(params.bundle.decision.promote_as),
    compact(params.bundle.recall.blocked_action),
    compact(params.bundle.recall.next_action),
    ...params.bundle.capability_demands.map((entry) => compact(entry.summary)),
    ...params.bundle.capability_demands.map((entry) => compact(entry.missing_capability)),
    ...params.bundle.hermes_runtime.blockers,
    ...params.bundle.hermes_runtime.next_actions,
    compact(params.status.workflow.lastDecisionDistillate?.summary),
    compact(params.status.workflow.lastDecisionDistillate?.nextAction),
  ].join(' ');

  if (
    params.bundle.hermes_runtime.awaiting_reentry_acknowledgment_stale === true
    || matchesHermesContextProfilePattern(signalText, HERMES_GUARDIAN_OBJECTIVE_PATTERNS)
  ) {
    return GUARDIAN_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (
    compact(params.bundle.workflow.status).toLowerCase() === 'released'
    && matchesHermesContextProfilePattern(signalText, HERMES_DISTILLER_OBJECTIVE_PATTERNS)
  ) {
    return DISTILLER_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (matchesHermesContextProfilePattern(signalText, HERMES_SCOUT_OBJECTIVE_PATTERNS)) {
    return SCOUT_HERMES_RUNTIME_CONTEXT_PROFILE;
  }

  if (matchesHermesContextProfilePattern(signalText, HERMES_EXECUTOR_OBJECTIVE_PATTERNS)) {
    return EXECUTOR_HERMES_RUNTIME_CONTEXT_PROFILE;
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

const buildGoalCycleCommand = (params: {
  runtimeLane?: string | null;
  sessionPath?: string | null;
  vaultPath?: string | null;
  capacityTarget?: number | null;
  gcpCapacityRecoveryRequested?: boolean;
  visibleTerminal?: boolean;
  autoLaunchQueuedChat?: boolean;
  autoLaunchQueuedChatContextProfile?: string | null;
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
  if (params.autoLaunchQueuedChat === true) {
    args.push('--autoLaunchQueuedChat=true');
  }
  const autoLaunchQueuedChatContextProfile = compact(params.autoLaunchQueuedChatContextProfile);
  if (autoLaunchQueuedChatContextProfile) {
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

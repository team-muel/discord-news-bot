import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { executeExternalAction } from '../tools/externalAdapterRegistry';

export type OpenJarvisMemorySyncSection = 'obsidian' | 'repo' | 'supabase';
export type OpenJarvisMemorySyncStatusValue = 'disabled' | 'missing' | 'invalid' | 'pending' | 'stale' | 'fresh';
export type OpenJarvisMemoryIndexStatusValue = 'pending' | 'completed' | 'skipped' | 'failed' | null;
export type OpenJarvisSchedulerTaskStatusValue = 'active' | 'paused' | 'completed' | 'cancelled' | null;
export type OpenJarvisSchedulerScheduleType = 'cron' | 'interval' | 'once' | null;

export type OpenJarvisMemorySyncDoc = {
  section: OpenJarvisMemorySyncSection;
  fileName: string;
  sourceRef: string;
};

export type OpenJarvisMemoryIndexStatus = {
  attempted: boolean | null;
  status: OpenJarvisMemoryIndexStatusValue;
  completedAt: string | null;
  outputSummary: string | null;
  reason: string | null;
};

export type OpenJarvisMemorySyncCounts = {
  total: number;
  obsidian: number;
  repo: number;
  supabase: number;
};

export type OpenJarvisMemorySyncStatus = {
  configured: boolean;
  summaryPath: string;
  exists: boolean;
  status: OpenJarvisMemorySyncStatusValue;
  healthy: boolean | null;
  generatedAt: string | null;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  dryRun: boolean | null;
  forced: boolean | null;
  vaultPath: string | null;
  obsidianAdapterSummary: string | null;
  supabaseAvailability: string | null;
  counts: OpenJarvisMemorySyncCounts | null;
  docs: OpenJarvisMemorySyncDoc[];
  memoryIndex: OpenJarvisMemoryIndexStatus;
  issues: string[];
};

export type OpenJarvisMemorySyncRunParams = {
  dryRun?: boolean;
  force?: boolean;
  guildId?: string | null;
};

export type OpenJarvisMemorySyncRunResult = {
  ok: boolean;
  dryRun: boolean;
  force: boolean;
  guildId: string | null;
  scriptName: string;
  command: string;
  completion: 'queued';
  pid: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdoutLines: string[];
  stderrLines: string[];
  statusBefore: OpenJarvisMemorySyncStatus;
  statusAfter: OpenJarvisMemorySyncStatus;
  error: string | null;
};

export type OpenJarvisManagedMemoryMaintenanceParams = OpenJarvisMemorySyncRunParams & {
  agentName?: string | null;
  timeoutMs?: number | null;
};

export type OpenJarvisMemorySyncBlockingExecution = {
  ok: boolean;
  command: string;
  exitCode: number;
  stdoutLines: string[];
  stderrLines: string[];
  error: string | null;
};

export type OpenJarvisManagedMemoryMaintenanceResult = {
  ok: boolean;
  dryRun: boolean;
  force: boolean;
  guildId: string | null;
  agentName: string;
  agentId: string | null;
  agentCreated: boolean;
  managedAgentReady: boolean;
  managedMessageAccepted: boolean;
  managedRunTriggered: boolean;
  latestTraceId: string | null;
  latestTraceOutcome: string | null;
  feedbackRecorded: boolean | null;
  feedbackScore: number | null;
  completion: 'completed' | 'skipped';
  syncExecution: OpenJarvisMemorySyncBlockingExecution;
  statusBefore: OpenJarvisMemorySyncStatus;
  statusAfter: OpenJarvisMemorySyncStatus;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
};

export type OpenJarvisSchedulerTask = {
  id: string;
  prompt: string;
  scheduleType: OpenJarvisSchedulerScheduleType;
  scheduleValue: string | null;
  status: OpenJarvisSchedulerTaskStatusValue;
  nextRun: string | null;
  agent: string | null;
  rawLine: string;
};

export type OpenJarvisMemorySyncScheduleStatus = {
  available: boolean;
  healthy: boolean | null;
  configuredPrompt: string;
  configuredAgent: string;
  configuredTools: string[];
  configuredScheduleType: Exclude<OpenJarvisSchedulerScheduleType, null>;
  configuredScheduleValue: string;
  daemonCommand: string;
  daemonRecommended: boolean;
  taskId: string | null;
  taskStatus: OpenJarvisSchedulerTaskStatusValue;
  taskScheduleType: OpenJarvisSchedulerScheduleType;
  nextRun: string | null;
  matchingTaskCount: number;
  activeTaskCount: number;
  issues: string[];
  tasks: OpenJarvisSchedulerTask[];
};

export type OpenJarvisMemorySyncScheduleParams = {
  prompt?: string | null;
  scheduleType?: string | null;
  scheduleValue?: string | number | null;
  agent?: string | null;
  tools?: string[] | string | null;
  resumeIfPaused?: boolean;
  dryRun?: boolean;
};

export type OpenJarvisMemorySyncScheduleEnsureResult = {
  ok: boolean;
  dryRun: boolean;
  completion: 'created' | 'resumed' | 'skipped';
  command: string | null;
  taskId: string | null;
  taskCreated: boolean;
  taskResumed: boolean;
  configuredPrompt: string;
  configuredAgent: string;
  configuredTools: string[];
  configuredScheduleType: Exclude<OpenJarvisSchedulerScheduleType, null>;
  configuredScheduleValue: string;
  statusBefore: OpenJarvisMemorySyncScheduleStatus;
  statusAfter: OpenJarvisMemorySyncScheduleStatus;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
};

export type OpenJarvisSchedulerDaemonStartParams = {
  dryRun?: boolean;
  pollIntervalSeconds?: number | null;
};

export type OpenJarvisSchedulerDaemonStartResult = {
  ok: boolean;
  dryRun: boolean;
  completion: 'queued' | 'skipped';
  command: string;
  pid: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
};

type RawOpenJarvisMemorySyncSummary = {
  generatedAt?: unknown;
  dryRun?: unknown;
  forced?: unknown;
  vaultPath?: unknown;
  obsidianAdapterSummary?: unknown;
  supabaseAvailability?: unknown;
  counts?: Record<string, unknown> | null;
  docs?: unknown;
  memoryIndex?: Record<string, unknown> | null;
};

const execFileAsync = promisify(execFile);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../../');
const MEMORY_SYNC_SCRIPT_RELATIVE_PATH = 'scripts/sync-openjarvis-memory.ts';
const MEMORY_SYNC_SCRIPT_PATH = path.resolve(REPO_ROOT, MEMORY_SYNC_SCRIPT_RELATIVE_PATH);
const DEFAULT_SUMMARY_PATH = path.resolve(moduleDir, '../../../tmp/openjarvis-memory-feed/summary.json');
const DEFAULT_STALE_AFTER_MINUTES = 24 * 60;
const DEFAULT_BLOCKING_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MANAGED_MEMORY_AGENT_NAME = 'repo-memory-maintainer';
const DEFAULT_MEMORY_SYNC_SCHEDULE_PROMPT = String(
  process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_PROMPT || 'Check discord-news-bot memory sync',
).trim() || 'Check discord-news-bot memory sync';
const DEFAULT_MEMORY_SYNC_SCHEDULE_TYPE: Exclude<OpenJarvisSchedulerScheduleType, null> = 'interval';
const DEFAULT_MEMORY_SYNC_SCHEDULE_VALUE = String(process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_VALUE || '3600').trim() || '3600';
const DEFAULT_MEMORY_SYNC_SCHEDULE_AGENT = String(process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_AGENT || 'orchestrator').trim() || 'orchestrator';
const DEFAULT_MEMORY_SYNC_SCHEDULE_TOOLS = String(process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_TOOLS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const DEFAULT_SCHEDULER_POLL_INTERVAL_SECONDS = 60;
const VALID_DOC_SECTIONS = new Set<OpenJarvisMemorySyncSection>(['obsidian', 'repo', 'supabase']);
const VALID_MEMORY_INDEX_STATUSES = new Set<Exclude<OpenJarvisMemoryIndexStatusValue, null>>(['pending', 'completed', 'skipped', 'failed']);
const VALID_SCHEDULER_STATUSES = new Set<Exclude<OpenJarvisSchedulerTaskStatusValue, null>>(['active', 'paused', 'completed', 'cancelled']);
const VALID_SCHEDULER_TYPES = new Set<Exclude<OpenJarvisSchedulerScheduleType, null>>(['cron', 'interval', 'once']);

const parseBool = (value: string | undefined): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parseBoolAny = (keys: string[]): boolean => {
  return keys.some((key) => parseBool(process.env[key]));
};

const toIsoTimestamp = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const toOptionalString = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const normalizeSchedulerPrompt = (value: unknown): string => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeSchedulerTools = (value: string[] | string | null | undefined): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeSchedulerType = (value: unknown): Exclude<OpenJarvisSchedulerScheduleType, null> => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_SCHEDULER_TYPES.has(normalized as Exclude<OpenJarvisSchedulerScheduleType, null>)
    ? normalized as Exclude<OpenJarvisSchedulerScheduleType, null>
    : DEFAULT_MEMORY_SYNC_SCHEDULE_TYPE;
};

const normalizeSchedulerValue = (value: unknown, scheduleType: Exclude<OpenJarvisSchedulerScheduleType, null>): string => {
  const normalized = String(value ?? '').trim();
  if (normalized) {
    return normalized;
  }
  if (scheduleType === 'interval') {
    return DEFAULT_MEMORY_SYNC_SCHEDULE_VALUE;
  }
  return DEFAULT_MEMORY_SYNC_SCHEDULE_VALUE;
};

const normalizeSchedulerPollIntervalSeconds = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 5
    ? Math.floor(numeric)
    : DEFAULT_SCHEDULER_POLL_INTERVAL_SECONDS;
};

const toSchedulerTaskStatus = (value: unknown): OpenJarvisSchedulerTaskStatusValue => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_SCHEDULER_STATUSES.has(normalized as Exclude<OpenJarvisSchedulerTaskStatusValue, null>)
    ? normalized as Exclude<OpenJarvisSchedulerTaskStatusValue, null>
    : null;
};

const toSchedulerScheduleType = (value: unknown): OpenJarvisSchedulerScheduleType => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_SCHEDULER_TYPES.has(normalized as Exclude<OpenJarvisSchedulerScheduleType, null>)
    ? normalized as Exclude<OpenJarvisSchedulerScheduleType, null>
    : null;
};

const toFiniteCount = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

const resolveSummaryPath = (): string => {
  const override = String(process.env.OPENJARVIS_MEMORY_SYNC_SUMMARY_PATH || '').trim();
  return override ? path.resolve(override) : DEFAULT_SUMMARY_PATH;
};

const resolveStaleAfterMinutes = (): number => {
  const raw = Number(String(process.env.OPENJARVIS_MEMORY_SYNC_STALE_AFTER_MINUTES || '').trim() || DEFAULT_STALE_AFTER_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_STALE_AFTER_MINUTES;
};

const formatCommand = (command: string, args: string[]): string => {
  return [command, ...args]
    .map((part) => (/\s|"/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
};

const buildSchedulerDaemonCommand = (pollIntervalSeconds: number): string => {
  return formatCommand('jarvis', ['scheduler', 'start', '--poll-interval', String(pollIntervalSeconds)]);
};

const buildSchedulerCreateCommand = (params: {
  prompt: string;
  scheduleType: Exclude<OpenJarvisSchedulerScheduleType, null>;
  scheduleValue: string;
  agent: string;
  tools: string[];
}): string => {
  const args = ['scheduler', 'create', params.prompt, '--type', params.scheduleType, '--value', params.scheduleValue];
  if (params.agent) {
    args.push('--agent', params.agent);
  }
  if (params.tools.length > 0) {
    args.push('--tools', params.tools.join(','));
  }
  return formatCommand('jarvis', args);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeOutputLines = (value: unknown, maxLines = 20): string[] => {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
};

const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '');

const normalizeSchedulerTableLine = (line: string): string => stripAnsi(String(line || '')).replace(/[\u2500-\u257f]/g, '|').trim();

const parseSchedulerTaskLine = (line: string): OpenJarvisSchedulerTask | null => {
  const normalized = normalizeSchedulerTableLine(line);
  if (!normalized || /^scheduled tasks$/i.test(normalized) || /^no scheduled tasks found\.?$/i.test(normalized)) {
    return null;
  }

  const segments = (normalized.includes('|')
    ? normalized.split('|')
    : normalized.split(/\s{2,}/))
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (segments.length < 6) {
    return null;
  }

  const [id, prompt, scheduleType, status, nextRun, agent] = segments;
  if (!id || /^id$/i.test(id) || /^prompt$/i.test(prompt) || !toSchedulerScheduleType(scheduleType) || !toSchedulerTaskStatus(status)) {
    return null;
  }

  return {
    id,
    prompt,
    scheduleType: toSchedulerScheduleType(scheduleType),
    scheduleValue: null,
    status: toSchedulerTaskStatus(status),
    nextRun: /^n\/a$/i.test(nextRun) ? null : toOptionalString(nextRun),
    agent: toOptionalString(agent),
    rawLine: normalized,
  };
};

const parseSchedulerTasks = (lines: string[]): OpenJarvisSchedulerTask[] => {
  const seen = new Set<string>();
  const tasks: OpenJarvisSchedulerTask[] = [];
  for (const line of lines) {
    const task = parseSchedulerTaskLine(line);
    if (!task || seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    tasks.push(task);
  }
  return tasks;
};

const matchesSchedulerPrompt = (taskPrompt: string, configuredPrompt: string): boolean => {
  const normalizedTaskPrompt = normalizeSchedulerPrompt(taskPrompt).toLowerCase();
  const normalizedConfiguredPrompt = normalizeSchedulerPrompt(configuredPrompt).toLowerCase();
  if (!normalizedTaskPrompt || !normalizedConfiguredPrompt) {
    return false;
  }
  if (normalizedTaskPrompt === normalizedConfiguredPrompt) {
    return true;
  }
  const deTruncatedTaskPrompt = normalizedTaskPrompt.replace(/\.\.\.$/, '');
  return normalizedConfiguredPrompt.startsWith(deTruncatedTaskPrompt) || normalizedTaskPrompt.startsWith(normalizedConfiguredPrompt);
};

const parseSchedulerCreateSummary = (lines: string[]): {
  taskId: string | null;
  scheduleType: OpenJarvisSchedulerScheduleType;
  scheduleValue: string | null;
  nextRun: string | null;
  agent: string | null;
} => {
  const createdLine = lines.find((line) => /^created task\s+/i.test(stripAnsi(line)));
  const taskId = createdLine
    ? toOptionalString(stripAnsi(createdLine).replace(/^created task\s+/i, ''))
    : null;

  return {
    taskId,
    scheduleType: toSchedulerScheduleType(extractFieldValue(lines, 'Type')),
    scheduleValue: extractFieldValue(lines, 'Value'),
    nextRun: extractFieldValue(lines, 'Next run'),
    agent: extractFieldValue(lines, 'Agent'),
  };
};

const buildMemorySyncInvocation = (dryRun: boolean, extraArgs: string[]): { args: string[]; command: string } => {
  if (!fs.existsSync(MEMORY_SYNC_SCRIPT_PATH)) {
    throw new Error(`OpenJarvis memory sync script is missing: ${MEMORY_SYNC_SCRIPT_PATH}`);
  }

  const args = [
    '--import',
    'tsx',
    MEMORY_SYNC_SCRIPT_PATH,
    ...(dryRun ? ['--dryRun=true'] : []),
    ...extraArgs,
  ];

  const displayArgs = [
    '--import',
    'tsx',
    MEMORY_SYNC_SCRIPT_RELATIVE_PATH,
    ...(dryRun ? ['--dryRun=true'] : []),
    ...extraArgs,
  ];

  return {
    args,
    command: formatCommand('node', displayArgs),
  };
};

const queueMemorySyncScript = async (dryRun: boolean, extraArgs: string[]): Promise<{ command: string; pid: number | null }> => {
  const invocation = buildMemorySyncInvocation(dryRun, extraArgs);
  const child = spawn(process.execPath, invocation.args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  const pid = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid ?? null);
    });
  });

  return {
    command: invocation.command,
    pid,
  };
};

const executeMemorySyncScriptBlocking = async (
  dryRun: boolean,
  extraArgs: string[],
  timeoutMs: number,
): Promise<OpenJarvisMemorySyncBlockingExecution> => {
  const invocation = buildMemorySyncInvocation(dryRun, extraArgs);

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, invocation.args, {
      cwd: REPO_ROOT,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return {
      ok: true,
      command: invocation.command,
      exitCode: 0,
      stdoutLines: normalizeOutputLines(stdout),
      stderrLines: normalizeOutputLines(stderr),
      error: null,
    };
  } catch (error) {
    const execError = error as Error & {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      ok: false,
      command: invocation.command,
      exitCode: typeof execError.code === 'number' ? execError.code : -1,
      stdoutLines: normalizeOutputLines(execError.stdout),
      stderrLines: normalizeOutputLines(execError.stderr),
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const extractFieldValue = (lines: string[], fieldName: string): string | null => {
  const prefix = `${fieldName.toLowerCase()}:`;
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(prefix));
  return line ? line.slice(prefix.length).trim() || null : null;
};

const parseManagedAgentIdFromList = (lines: string[], agentName: string): string | null => {
  const pattern = new RegExp(`^\\[\\d+\\]\\s+(\\S+)\\s+${escapeRegExp(agentName)}\\s+[—-]\\s+`);
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
};

const parseManagedTraceSummary = (lines: string[]): { traceId: string | null; outcome: string | null } => {
  const line = lines.find((candidate) => /^\[\d+\]\s+\S+\s+\[[^\]]+\]/.test(candidate));
  if (!line) {
    return { traceId: null, outcome: null };
  }
  const match = line.match(/^\[\d+\]\s+(\S+)\s+\[([^\]]+)\]/);
  return {
    traceId: match?.[1] || null,
    outcome: match?.[2] || null,
  };
};

const buildScheduleStatusFromSnapshot = (params: {
  prompt: string;
  agent: string;
  tools: string[];
  scheduleType: Exclude<OpenJarvisSchedulerScheduleType, null>;
  scheduleValue: string;
  available: boolean;
  tasks: OpenJarvisSchedulerTask[];
  issues: string[];
}): OpenJarvisMemorySyncScheduleStatus => {
  const matchingTasks = params.tasks.filter((task) => matchesSchedulerPrompt(task.prompt, params.prompt));
  const primaryTask = matchingTasks[0] || null;
  return {
    available: params.available,
    healthy: params.available ? primaryTask?.status === 'active' : false,
    configuredPrompt: params.prompt,
    configuredAgent: params.agent,
    configuredTools: params.tools,
    configuredScheduleType: params.scheduleType,
    configuredScheduleValue: params.scheduleValue,
    daemonCommand: buildSchedulerDaemonCommand(DEFAULT_SCHEDULER_POLL_INTERVAL_SECONDS),
    daemonRecommended: matchingTasks.length > 0,
    taskId: primaryTask?.id || null,
    taskStatus: primaryTask?.status || null,
    taskScheduleType: primaryTask?.scheduleType || null,
    nextRun: primaryTask?.nextRun || null,
    matchingTaskCount: matchingTasks.length,
    activeTaskCount: params.tasks.filter((task) => task.status === 'active').length,
    issues: params.issues,
    tasks: params.tasks,
  };
};

const resolveManagedMemoryAgent = async (agentName: string): Promise<{
  agentId: string | null;
  agentCreated: boolean;
  warnings: string[];
}> => {
  const warnings: string[] = [];
  const listResult = await executeExternalAction('openjarvis', 'jarvis.agent.list');
  if (listResult.ok) {
    const existingAgentId = parseManagedAgentIdFromList(listResult.output, agentName);
    if (existingAgentId) {
      return {
        agentId: existingAgentId,
        agentCreated: false,
        warnings,
      };
    }
  } else {
    warnings.push(`managed agent list unavailable: ${listResult.error || listResult.summary}`);
  }

  const createResult = await executeExternalAction('openjarvis', 'jarvis.agent.create', {
    name: agentName,
    agentType: 'monitor_operative',
    config: {
      schedule_type: 'manual',
      owner: 'repo-memory-maintenance',
    },
  });
  if (!createResult.ok) {
    warnings.push(`managed agent create failed: ${createResult.error || createResult.summary}`);
    return {
      agentId: null,
      agentCreated: false,
      warnings,
    };
  }

  return {
    agentId: extractFieldValue(createResult.output, 'id'),
    agentCreated: true,
    warnings,
  };
};

const buildManagedMemoryMaintenanceMessage = (params: {
  guildId: string | null;
  force: boolean;
}): string => {
  return [
    'Track and summarize this repository OpenJarvis memory maintenance cycle.',
    params.guildId ? `guild_scope: ${params.guildId}` : 'guild_scope: all-configured',
    `refresh_mode: ${params.force ? 'force' : 'normal'}`,
    'execution_contract: the repo-owned scripts/sync-openjarvis-memory.ts flow remains the canonical executor for this bounded task.',
    'closeout: confirm whether the projection summary refreshed and whether memory indexing completed or was skipped with an explicit reason.',
  ].join('\n');
};

const normalizeDocs = (value: unknown): OpenJarvisMemorySyncDoc[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const section = String((entry as Record<string, unknown>).section || '').trim() as OpenJarvisMemorySyncSection;
    if (!VALID_DOC_SECTIONS.has(section)) {
      return [];
    }
    const fileName = toOptionalString((entry as Record<string, unknown>).fileName);
    const sourceRef = toOptionalString((entry as Record<string, unknown>).sourceRef);
    if (!fileName || !sourceRef) {
      return [];
    }
    return [{ section, fileName, sourceRef }];
  });
};

const normalizeMemoryIndex = (value: Record<string, unknown> | null | undefined): OpenJarvisMemoryIndexStatus => {
  const rawStatus = toOptionalString(value?.status);
  const status = rawStatus && VALID_MEMORY_INDEX_STATUSES.has(rawStatus as Exclude<OpenJarvisMemoryIndexStatusValue, null>)
    ? rawStatus as Exclude<OpenJarvisMemoryIndexStatusValue, null>
    : null;
  const attempted = typeof value?.attempted === 'boolean' ? value.attempted : null;

  return {
    attempted,
    status,
    completedAt: toIsoTimestamp(value?.completedAt),
    outputSummary: toOptionalString(value?.outputSummary),
    reason: toOptionalString(value?.reason),
  };
};

const createBaseStatus = (params: {
  configured: boolean;
  summaryPath: string;
  staleAfterMinutes: number;
  status: OpenJarvisMemorySyncStatusValue;
  healthy: boolean | null;
  issues: string[];
  exists: boolean;
}): OpenJarvisMemorySyncStatus => ({
  configured: params.configured,
  summaryPath: params.summaryPath,
  exists: params.exists,
  status: params.status,
  healthy: params.healthy,
  generatedAt: null,
  ageMinutes: null,
  staleAfterMinutes: params.staleAfterMinutes,
  dryRun: null,
  forced: null,
  vaultPath: null,
  obsidianAdapterSummary: null,
  supabaseAvailability: null,
  counts: null,
  docs: [],
  memoryIndex: {
    attempted: null,
    status: null,
    completedAt: null,
    outputSummary: null,
    reason: null,
  },
  issues: params.issues,
});

export const getOpenJarvisMemorySyncStatus = (): OpenJarvisMemorySyncStatus => {
  const configured = parseBoolAny(['OPENJARVIS_MEMORY_SYNC_ENABLED', 'OPENJARVIS_LEARNING_LOOP_ENABLED']);
  const summaryPath = resolveSummaryPath();
  const staleAfterMinutes = resolveStaleAfterMinutes();

  if (!fs.existsSync(summaryPath)) {
    return createBaseStatus({
      configured,
      summaryPath,
      staleAfterMinutes,
      status: configured ? 'missing' : 'disabled',
      healthy: configured ? false : null,
      issues: configured
        ? ['OpenJarvis memory sync summary is missing. Run the projection sync to refresh authoritative memory.']
        : ['OpenJarvis memory sync is currently disabled by runtime env flags.'],
      exists: false,
    });
  }

  let parsed: RawOpenJarvisMemorySyncSummary;
  try {
    parsed = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as RawOpenJarvisMemorySyncSummary;
  } catch (error) {
    return createBaseStatus({
      configured,
      summaryPath,
      staleAfterMinutes,
      status: 'invalid',
      healthy: false,
      issues: [`OpenJarvis memory sync summary could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
      exists: true,
    });
  }

  const generatedAt = toIsoTimestamp(parsed.generatedAt);
  const dryRun = typeof parsed.dryRun === 'boolean' ? parsed.dryRun : null;
  const forced = typeof parsed.forced === 'boolean' ? parsed.forced : null;
  const docs = normalizeDocs(parsed.docs);
  const counts: OpenJarvisMemorySyncCounts = {
    total: toFiniteCount(parsed.counts?.total),
    obsidian: toFiniteCount(parsed.counts?.obsidian),
    repo: toFiniteCount(parsed.counts?.repo),
    supabase: toFiniteCount(parsed.counts?.supabase),
  };
  const memoryIndex = normalizeMemoryIndex(parsed.memoryIndex);
  const ageMinutes = generatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(generatedAt)) / 60_000))
    : null;
  const stale = ageMinutes === null ? true : ageMinutes > staleAfterMinutes;

  const issues: string[] = [];
  if (!configured) {
    issues.push('OpenJarvis memory sync is currently disabled by runtime env flags.');
  }
  if (!generatedAt) {
    issues.push('OpenJarvis memory sync summary is missing a valid generatedAt timestamp.');
  }
  if (stale) {
    issues.push(`OpenJarvis memory projection is older than ${staleAfterMinutes} minutes.`);
  }
  if (dryRun) {
    issues.push('The latest OpenJarvis memory projection was generated in dry-run mode only.');
  }
  if (counts.total <= 0) {
    issues.push('OpenJarvis memory projection contains no collected documents.');
  }
  if (counts.obsidian <= 0) {
    issues.push('OpenJarvis memory projection collected no Obsidian documents.');
  }
  const supabaseAvailability = toOptionalString(parsed.supabaseAvailability);
  if (supabaseAvailability && supabaseAvailability !== 'ok') {
    issues.push(`OpenJarvis memory sync reported Supabase availability as ${supabaseAvailability}.`);
  }
  if (memoryIndex.status === 'pending') {
    issues.push('jarvis memory index is still pending for the latest projection.');
  }
  if (memoryIndex.status === 'skipped') {
    issues.push(`jarvis memory index was skipped${memoryIndex.reason ? `: ${memoryIndex.reason}` : '.'}`);
  }
  if (memoryIndex.status === 'failed') {
    issues.push(`jarvis memory index failed${memoryIndex.reason ? `: ${memoryIndex.reason}` : '.'}`);
  }

  let status: OpenJarvisMemorySyncStatusValue;
  if (!configured) {
    status = 'disabled';
  } else if (!generatedAt) {
    status = 'invalid';
  } else if (memoryIndex.status === 'pending') {
    status = 'pending';
  } else if (stale || dryRun || memoryIndex.status !== 'completed') {
    status = 'stale';
  } else {
    status = 'fresh';
  }

  return {
    configured,
    summaryPath,
    exists: true,
    status,
    healthy: status === 'fresh' ? true : configured ? false : null,
    generatedAt,
    ageMinutes,
    staleAfterMinutes,
    dryRun,
    forced,
    vaultPath: toOptionalString(parsed.vaultPath),
    obsidianAdapterSummary: toOptionalString(parsed.obsidianAdapterSummary),
    supabaseAvailability,
    counts,
    docs,
    memoryIndex,
    issues,
  };
};

export const runOpenJarvisMemorySync = async (params: OpenJarvisMemorySyncRunParams = {}): Promise<OpenJarvisMemorySyncRunResult> => {
  const dryRun = params.dryRun !== false;
  const force = params.force === true;
  const guildId = toOptionalString(params.guildId);
  const scriptName = dryRun ? 'openjarvis:memory:sync:dry' : 'openjarvis:memory:sync';
  const extraArgs = [
    force ? '--force=true' : null,
    guildId ? `--guildId=${guildId}` : null,
  ].filter((value): value is string => Boolean(value));
  const statusBefore = getOpenJarvisMemorySyncStatus();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    const { command, pid } = await queueMemorySyncScript(dryRun, extraArgs);
    const statusAfter = getOpenJarvisMemorySyncStatus();
    return {
      ok: true,
      dryRun,
      force,
      guildId,
      scriptName,
      command,
      completion: 'queued',
      pid,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      stdoutLines: [],
      stderrLines: [],
      statusBefore,
      statusAfter,
      error: null,
    };
  } catch (error) {
    const command = (() => {
      try {
        return buildMemorySyncInvocation(dryRun, extraArgs).command;
      } catch {
        return formatCommand('node', [
          '--import',
          'tsx',
          MEMORY_SYNC_SCRIPT_RELATIVE_PATH,
          ...(dryRun ? ['--dryRun=true'] : []),
          ...extraArgs,
        ]);
      }
    })();
    const statusAfter = getOpenJarvisMemorySyncStatus();
    return {
      ok: false,
      dryRun,
      force,
      guildId,
      scriptName,
      command,
      completion: 'queued',
      pid: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      stdoutLines: [],
      stderrLines: [],
      statusBefore,
      statusAfter,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const runOpenJarvisManagedMemoryMaintenance = async (
  params: OpenJarvisManagedMemoryMaintenanceParams = {},
): Promise<OpenJarvisManagedMemoryMaintenanceResult> => {
  const dryRun = params.dryRun === true;
  const force = params.force === true;
  const guildId = toOptionalString(params.guildId);
  const agentName = toOptionalString(params.agentName) || DEFAULT_MANAGED_MEMORY_AGENT_NAME;
  const timeoutMsRaw = Number(params.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.floor(timeoutMsRaw)
    : DEFAULT_BLOCKING_TIMEOUT_MS;
  const extraArgs = [
    force ? '--force=true' : null,
    guildId ? `--guildId=${guildId}` : null,
  ].filter((value): value is string => Boolean(value));
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const statusBefore = getOpenJarvisMemorySyncStatus();
  const warnings: string[] = [];
  const emptyExecution: OpenJarvisMemorySyncBlockingExecution = {
    ok: true,
    command: buildMemorySyncInvocation(dryRun, extraArgs).command,
    exitCode: 0,
    stdoutLines: [],
    stderrLines: [],
    error: null,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun,
      force,
      guildId,
      agentName,
      agentId: null,
      agentCreated: false,
      managedAgentReady: false,
      managedMessageAccepted: false,
      managedRunTriggered: false,
      latestTraceId: null,
      latestTraceOutcome: null,
      feedbackRecorded: null,
      feedbackScore: null,
      completion: 'skipped',
      syncExecution: emptyExecution,
      statusBefore,
      statusAfter: statusBefore,
      warnings,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      error: null,
    };
  }

  const managedAgent = await resolveManagedMemoryAgent(agentName);
  warnings.push(...managedAgent.warnings);

  let managedMessageAccepted = false;
  let managedRunTriggered = false;
  if (managedAgent.agentId) {
    const messageResult = await executeExternalAction('openjarvis', 'jarvis.agent.message', {
      agentId: managedAgent.agentId,
      content: buildManagedMemoryMaintenanceMessage({ guildId, force }),
      mode: 'queued',
    });
    managedMessageAccepted = messageResult.ok;
    if (!messageResult.ok) {
      warnings.push(`managed agent message failed: ${messageResult.error || messageResult.summary}`);
    }

    const runResult = await executeExternalAction('openjarvis', 'jarvis.agent.run', {
      agentId: managedAgent.agentId,
    });
    managedRunTriggered = runResult.ok;
    if (!runResult.ok) {
      warnings.push(`managed agent run failed: ${runResult.error || runResult.summary}`);
    }
  } else {
    warnings.push('managed agent is unavailable, so trace and feedback closure will be partial for this cycle.');
  }

  const syncExecution = await executeMemorySyncScriptBlocking(false, extraArgs, timeoutMs);
  const statusAfter = getOpenJarvisMemorySyncStatus();

  let latestTraceId: string | null = null;
  let latestTraceOutcome: string | null = null;
  let feedbackRecorded: boolean | null = null;
  let feedbackScore: number | null = null;

  if (managedAgent.agentId) {
    const traceResult = await executeExternalAction('openjarvis', 'jarvis.agent.traces.list', {
      agentId: managedAgent.agentId,
      limit: 1,
    });
    if (traceResult.ok) {
      const traceSummary = parseManagedTraceSummary(traceResult.output);
      latestTraceId = traceSummary.traceId;
      latestTraceOutcome = traceSummary.outcome;
    } else {
      warnings.push(`managed agent trace lookup failed: ${traceResult.error || traceResult.summary}`);
    }
  }

  if (latestTraceId) {
    feedbackScore = syncExecution.ok && statusAfter.status === 'fresh'
      ? 1
      : syncExecution.ok
        ? 0.5
        : 0.1;
    const feedbackResult = await executeExternalAction('openjarvis', 'jarvis.feedback', {
      traceId: latestTraceId,
      score: feedbackScore,
    });
    feedbackRecorded = feedbackResult.ok;
    if (!feedbackResult.ok) {
      warnings.push(`managed agent feedback failed: ${feedbackResult.error || feedbackResult.summary}`);
    }
  } else if (managedAgent.agentId) {
    warnings.push('managed agent trace was not available after the maintenance run.');
  }

  if (statusAfter.status !== 'fresh') {
    warnings.push(`memory status after maintenance is ${statusAfter.status}.`);
  }

  return {
    ok: syncExecution.ok,
    dryRun,
    force,
    guildId,
    agentName,
    agentId: managedAgent.agentId,
    agentCreated: managedAgent.agentCreated,
    managedAgentReady: Boolean(managedAgent.agentId),
    managedMessageAccepted,
    managedRunTriggered,
    latestTraceId,
    latestTraceOutcome,
    feedbackRecorded,
    feedbackScore,
    completion: 'completed',
    syncExecution,
    statusBefore,
    statusAfter,
    warnings,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    error: syncExecution.error,
  };
};

export const getOpenJarvisMemorySyncScheduleStatus = async (
  params: OpenJarvisMemorySyncScheduleParams = {},
): Promise<OpenJarvisMemorySyncScheduleStatus> => {
  const prompt = normalizeSchedulerPrompt(params.prompt || DEFAULT_MEMORY_SYNC_SCHEDULE_PROMPT);
  const scheduleType = normalizeSchedulerType(params.scheduleType);
  const scheduleValue = normalizeSchedulerValue(params.scheduleValue, scheduleType);
  const agent = toOptionalString(params.agent) || DEFAULT_MEMORY_SYNC_SCHEDULE_AGENT;
  const tools = normalizeSchedulerTools(params.tools ?? DEFAULT_MEMORY_SYNC_SCHEDULE_TOOLS);
  const listResult = await executeExternalAction('openjarvis', 'jarvis.scheduler.list', {});

  if (!listResult.ok) {
    return buildScheduleStatusFromSnapshot({
      prompt,
      agent,
      tools,
      scheduleType,
      scheduleValue,
      available: false,
      tasks: [],
      issues: [`OpenJarvis scheduler list is unavailable: ${listResult.error || listResult.summary}`],
    });
  }

  const tasks = parseSchedulerTasks(listResult.output);
  const matchingTasks = tasks.filter((task) => matchesSchedulerPrompt(task.prompt, prompt));
  const issues: string[] = [];
  if (matchingTasks.length === 0) {
    issues.push('No matching OpenJarvis memory-sync scheduler task is currently registered.');
  }
  if (matchingTasks.length > 1) {
    issues.push('Multiple matching OpenJarvis memory-sync scheduler tasks were found; clean up duplicates to keep 24h automation deterministic.');
  }
  if (matchingTasks[0] && matchingTasks[0].status !== 'active') {
    issues.push(`The matching OpenJarvis memory-sync scheduler task is ${matchingTasks[0].status}.`);
  }

  return buildScheduleStatusFromSnapshot({
    prompt,
    agent,
    tools,
    scheduleType,
    scheduleValue,
    available: true,
    tasks,
    issues,
  });
};

export const ensureOpenJarvisMemorySyncSchedule = async (
  params: OpenJarvisMemorySyncScheduleParams = {},
): Promise<OpenJarvisMemorySyncScheduleEnsureResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;
  const prompt = normalizeSchedulerPrompt(params.prompt || DEFAULT_MEMORY_SYNC_SCHEDULE_PROMPT);
  const scheduleType = normalizeSchedulerType(params.scheduleType);
  const scheduleValue = normalizeSchedulerValue(params.scheduleValue, scheduleType);
  const agent = toOptionalString(params.agent) || DEFAULT_MEMORY_SYNC_SCHEDULE_AGENT;
  const tools = normalizeSchedulerTools(params.tools ?? DEFAULT_MEMORY_SYNC_SCHEDULE_TOOLS);
  const resumeIfPaused = params.resumeIfPaused !== false;
  const warnings = [
    'OpenJarvis scheduler tasks execute agent prompts. The repo-owned sync script remains the canonical direct refresh path.',
  ];
  const statusBefore = await getOpenJarvisMemorySyncScheduleStatus({
    prompt,
    scheduleType,
    scheduleValue,
    agent,
    tools,
  });

  const finalize = (partial: Omit<OpenJarvisMemorySyncScheduleEnsureResult, 'dryRun' | 'configuredPrompt' | 'configuredAgent' | 'configuredTools' | 'configuredScheduleType' | 'configuredScheduleValue' | 'statusBefore' | 'startedAt' | 'finishedAt' | 'durationMs' | 'warnings'>): OpenJarvisMemorySyncScheduleEnsureResult => ({
    dryRun,
    configuredPrompt: prompt,
    configuredAgent: agent,
    configuredTools: tools,
    configuredScheduleType: scheduleType,
    configuredScheduleValue: scheduleValue,
    statusBefore,
    warnings,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ...partial,
  });

  if (!statusBefore.available) {
    return finalize({
      ok: false,
      completion: 'skipped',
      command: null,
      taskId: null,
      taskCreated: false,
      taskResumed: false,
      statusAfter: statusBefore,
      error: statusBefore.issues[0] || 'OpenJarvis scheduler is unavailable',
    });
  }

  if (statusBefore.taskId && statusBefore.taskStatus === 'active') {
    return finalize({
      ok: true,
      completion: 'skipped',
      command: null,
      taskId: statusBefore.taskId,
      taskCreated: false,
      taskResumed: false,
      statusAfter: statusBefore,
      error: null,
    });
  }

  if (statusBefore.taskId && statusBefore.taskStatus === 'paused' && resumeIfPaused) {
    const command = formatCommand('jarvis', ['scheduler', 'resume', statusBefore.taskId]);
    if (dryRun) {
      return finalize({
        ok: true,
        completion: 'resumed',
        command,
        taskId: statusBefore.taskId,
        taskCreated: false,
        taskResumed: true,
        statusAfter: statusBefore,
        error: null,
      });
    }

    const resumeResult = await executeExternalAction('openjarvis', 'jarvis.scheduler.resume', {
      taskId: statusBefore.taskId,
    });
    if (!resumeResult.ok) {
      return finalize({
        ok: false,
        completion: 'skipped',
        command,
        taskId: statusBefore.taskId,
        taskCreated: false,
        taskResumed: false,
        statusAfter: statusBefore,
        error: resumeResult.error || resumeResult.summary,
      });
    }

    const statusAfter = await getOpenJarvisMemorySyncScheduleStatus({ prompt, scheduleType, scheduleValue, agent, tools });
    return finalize({
      ok: true,
      completion: 'resumed',
      command,
      taskId: statusBefore.taskId,
      taskCreated: false,
      taskResumed: true,
      statusAfter,
      error: null,
    });
  }

  const command = buildSchedulerCreateCommand({
    prompt,
    scheduleType,
    scheduleValue,
    agent,
    tools,
  });
  if (dryRun) {
    return finalize({
      ok: true,
      completion: 'created',
      command,
      taskId: statusBefore.taskId,
      taskCreated: true,
      taskResumed: false,
      statusAfter: statusBefore,
      error: null,
    });
  }

  const createResult = await executeExternalAction('openjarvis', 'jarvis.scheduler.create', {
    prompt,
    scheduleType,
    scheduleValue,
    agent,
    tools,
  });
  if (!createResult.ok) {
    return finalize({
      ok: false,
      completion: 'skipped',
      command,
      taskId: statusBefore.taskId,
      taskCreated: false,
      taskResumed: false,
      statusAfter: statusBefore,
      error: createResult.error || createResult.summary,
    });
  }

  const createSummary = parseSchedulerCreateSummary(createResult.output);
  const statusAfter = await getOpenJarvisMemorySyncScheduleStatus({ prompt, scheduleType, scheduleValue, agent, tools });
  return finalize({
    ok: true,
    completion: 'created',
    command,
    taskId: createSummary.taskId || statusAfter.taskId,
    taskCreated: true,
    taskResumed: false,
    statusAfter,
    error: null,
  });
};

export const startOpenJarvisSchedulerDaemon = async (
  params: OpenJarvisSchedulerDaemonStartParams = {},
): Promise<OpenJarvisSchedulerDaemonStartResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const dryRun = params.dryRun === true;
  const pollIntervalSeconds = normalizeSchedulerPollIntervalSeconds(params.pollIntervalSeconds);
  const command = buildSchedulerDaemonCommand(pollIntervalSeconds);

  const finalize = (partial: Omit<OpenJarvisSchedulerDaemonStartResult, 'dryRun' | 'command' | 'startedAt' | 'finishedAt' | 'durationMs'>): OpenJarvisSchedulerDaemonStartResult => ({
    dryRun,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ...partial,
  });

  if (dryRun) {
    return finalize({
      ok: true,
      completion: 'queued',
      pid: null,
      error: null,
    });
  }

  try {
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'jarvis', 'scheduler', 'start', '--poll-interval', String(pollIntervalSeconds)], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      : spawn('jarvis', ['scheduler', 'start', '--poll-interval', String(pollIntervalSeconds)], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

    const pid = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve(child.pid ?? null);
      });
    });

    return finalize({
      ok: true,
      completion: 'queued',
      pid,
      error: null,
    });
  } catch (error) {
    return finalize({
      ok: false,
      completion: 'skipped',
      pid: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
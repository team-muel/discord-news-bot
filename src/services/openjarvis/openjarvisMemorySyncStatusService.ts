import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type OpenJarvisMemorySyncSection = 'obsidian' | 'repo' | 'supabase';
export type OpenJarvisMemorySyncStatusValue = 'disabled' | 'missing' | 'invalid' | 'pending' | 'stale' | 'fresh';
export type OpenJarvisMemoryIndexStatusValue = 'pending' | 'completed' | 'skipped' | 'failed' | null;

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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../../');
const MEMORY_SYNC_SCRIPT_RELATIVE_PATH = 'scripts/sync-openjarvis-memory.ts';
const MEMORY_SYNC_SCRIPT_PATH = path.resolve(REPO_ROOT, MEMORY_SYNC_SCRIPT_RELATIVE_PATH);
const DEFAULT_SUMMARY_PATH = path.resolve(moduleDir, '../../../tmp/openjarvis-memory-feed/summary.json');
const DEFAULT_STALE_AFTER_MINUTES = 24 * 60;
const VALID_DOC_SECTIONS = new Set<OpenJarvisMemorySyncSection>(['obsidian', 'repo', 'supabase']);
const VALID_MEMORY_INDEX_STATUSES = new Set<Exclude<OpenJarvisMemoryIndexStatusValue, null>>(['pending', 'completed', 'skipped', 'failed']);

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
import 'dotenv/config';
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArg, parseBool, parseBoolEnvAny } from './lib/cliArgs.mjs';
import { SUPABASE_KEY, SUPABASE_URL, createScriptClient, isMissingRelationError } from './lib/supabaseClient.mjs';
import { getObsidianAdapterRuntimeStatus, readObsidianFileWithAdapter } from '../src/services/obsidian/router.ts';
import { getObsidianVaultRoot } from '../src/utils/obsidianEnv.ts';

type ProjectionSection = 'obsidian' | 'repo' | 'supabase';

type ProjectionDoc = {
  fileName: string;
  title: string;
  content: string;
  sourceRef: string;
  section: ProjectionSection;
};

type MemoryIndexSummary = {
  attempted: boolean;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  completedAt: string | null;
  outputSummary: string | null;
  reason: string | null;
};

export type ProjectionSummary = {
  generatedAt: string;
  dryRun: boolean;
  enabled: boolean;
  forced: boolean;
  vaultPath: string;
  obsidianAdapterSummary: string;
  supabaseAvailability: string;
  counts: {
    total: number;
    obsidian: number;
    repo: number;
    supabase: number;
  };
  docs: Array<{ section: ProjectionSection; fileName: string; sourceRef: string }>;
  memoryIndex: MemoryIndexSummary;
};

type WeeklyReportRow = {
  report_key?: string | null;
  report_kind?: string | null;
  guild_id?: string | null;
  baseline_summary?: unknown;
  candidate_summary?: unknown;
  delta_summary?: unknown;
  top_actions?: unknown;
  created_at?: string | null;
};

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'tmp', 'openjarvis-memory-feed');
const INDEX_TIMEOUT_MS = Math.max(10_000, Number(process.env.OPENJARVIS_MEMORY_INDEX_TIMEOUT_MS || '60000') || 60_000);
const MAX_DOC_CHARS = Math.max(2_000, Number(process.env.OPENJARVIS_MEMORY_SYNC_MAX_DOC_CHARS || '24000') || 24_000);
const ENABLED = parseBoolEnvAny(['OPENJARVIS_MEMORY_SYNC_ENABLED', 'OPENJARVIS_LEARNING_LOOP_ENABLED'], false);
const ALLOW_MISSING_SUPABASE = parseBool(parseArg('allowMissingSupabase', process.env.OPENJARVIS_MEMORY_SYNC_ALLOW_MISSING_SUPABASE || 'true'), true);

const runJarvisCli = async (args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> => {
  if (process.platform === 'win32') {
    return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'jarvis', ...args], {
      timeout: timeoutMs,
      windowsHide: true,
    });
  }
  return execFileAsync('jarvis', args, {
    timeout: timeoutMs,
    windowsHide: true,
  });
};

const DEFAULT_OBSIDIAN_SOURCES = [
  {
    title: 'Runtime Name And Surface Matrix',
    vaultPath: 'ops/control-tower/CANONICAL_MAP.md',
    fallbackPath: 'docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md',
  },
  {
    title: 'Obsidian Transition Plan',
    vaultPath: 'plans/runtime/OBSIDIAN_TRANSITION_PLAN.md',
    fallbackPath: 'docs/planning/OBSIDIAN_TRANSITION_PLAN.md',
  },
  {
    title: 'OpenJarvis-Centered Transition Order',
    vaultPath: 'ops/contexts/repos/openjarvis-centered-local-first-transition-order.md',
    fallbackPath: 'docs/ARCHITECTURE_INDEX.md',
  },
] as const;

const DEFAULT_REPO_SOURCES = [
  {
    title: 'Architecture Index',
    filePath: 'docs/ARCHITECTURE_INDEX.md',
  },
  {
    title: 'Team Shareable User Memory',
    filePath: 'docs/planning/TEAM_SHAREABLE_USER_MEMORY.md',
  },
] as const;

const DEFAULT_REPORT_KINDS = [
  'go_no_go_weekly',
  'llm_latency_weekly',
  'hybrid_weekly',
  'rollback_rehearsal_weekly',
  'memory_queue_weekly',
  'self_improvement_patterns',
] as const;

const sanitizeName = (value: string): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
};

const clip = (value: string, maxChars = MAX_DOC_CHARS): string => {
  const safe = String(value || '').trim();
  if (safe.length <= maxChars) return safe;
  return `${safe.slice(0, maxChars)}\n\n[truncated_for_openjarvis_memory_sync]`;
};

const asJsonBlock = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

const ensureCleanDir = (dirPath: string): void => {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
};

const resolveVaultPath = (): string => {
  return String(
    parseArg('vaultPath', getObsidianVaultRoot() || process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || 'docs'),
  ).trim() || 'docs';
};

export const resolveObsidianAdapterSummary = (status: {
  accessPosture?: { summary?: string | null } | null;
  selectedByCapability?: Record<string, string | null> | null;
} | null | undefined): string => {
  const postureSummary = String(status?.accessPosture?.summary || '').trim();
  if (postureSummary) {
    return postureSummary;
  }

  const selectedByCapability = status?.selectedByCapability || {};
  const writeAdapter = String(selectedByCapability.write_note || '').trim() || 'unknown';
  const readAdapter = String(selectedByCapability.read_file || selectedByCapability.read_lore || '').trim() || 'unknown';
  const searchAdapter = String(selectedByCapability.search_vault || '').trim() || 'unknown';
  return `adapter-summary-unavailable (write=${writeAdapter}, read=${readAdapter}, search=${searchAdapter})`;
};

const loadObsidianDocs = async (vaultPath: string): Promise<{ docs: ProjectionDoc[]; adapterSummary: string }> => {
  let adapterSummary = 'adapter-status-unavailable';
  let status: ReturnType<typeof getObsidianAdapterRuntimeStatus> | null = null;
  try {
    status = getObsidianAdapterRuntimeStatus();
    adapterSummary = resolveObsidianAdapterSummary(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    adapterSummary = `adapter-status-unavailable: ${message}`;
  }
  const docs: ProjectionDoc[] = [];

  for (const source of DEFAULT_OBSIDIAN_SOURCES) {
    let content = await readObsidianFileWithAdapter({ vaultPath, filePath: source.vaultPath });
    let sourceRef = `vault:${source.vaultPath}`;
    if (content === null) {
      const fallbackAbs = path.resolve(ROOT, source.fallbackPath);
      if (fs.existsSync(fallbackAbs)) {
        content = fs.readFileSync(fallbackAbs, 'utf8');
        sourceRef = `repo:${source.fallbackPath}`;
      }
    }
    if (content === null) continue;
    docs.push({
      fileName: `${sanitizeName(source.title)}.md`,
      title: source.title,
      content: [
        `# ${source.title}`,
        '',
        `- authoritative_source: ${sourceRef}`,
        `- synced_at: ${new Date().toISOString()}`,
        '',
        clip(content),
      ].join('\n'),
      sourceRef,
      section: 'obsidian',
    });
  }

  return {
    docs,
    adapterSummary,
  };
};

const loadRepoDocs = (): ProjectionDoc[] => {
  const docs: ProjectionDoc[] = [];
  for (const source of DEFAULT_REPO_SOURCES) {
    const absolutePath = path.resolve(ROOT, source.filePath);
    if (!fs.existsSync(absolutePath)) continue;
    const content = fs.readFileSync(absolutePath, 'utf8');
    docs.push({
      fileName: `${sanitizeName(source.title)}.md`,
      title: source.title,
      content: [
        `# ${source.title}`,
        '',
        `- source: repo:${source.filePath}`,
        `- synced_at: ${new Date().toISOString()}`,
        '',
        clip(content),
      ].join('\n'),
      sourceRef: `repo:${source.filePath}`,
      section: 'repo',
    });
  }
  return docs;
};

export const pickLatestReportRows = (rows: WeeklyReportRow[]): WeeklyReportRow[] => {
  const latestByKind = new Map<string, WeeklyReportRow>();
  for (const row of rows) {
    const kind = String(row.report_kind || '').trim();
    if (!kind || latestByKind.has(kind)) continue;
    latestByKind.set(kind, row);
  }
  return DEFAULT_REPORT_KINDS
    .map((kind) => latestByKind.get(kind))
    .filter((row): row is WeeklyReportRow => Boolean(row));
};

export const buildProjectionSummary = (params: {
  generatedAt?: string;
  dryRun: boolean;
  enabled: boolean;
  forced: boolean;
  vaultPath: string;
  obsidianAdapterSummary: string;
  supabaseAvailability: string;
  docs: ProjectionDoc[];
  memoryIndex: MemoryIndexSummary;
}): ProjectionSummary => {
  const docs = params.docs || [];
  return {
    generatedAt: params.generatedAt || new Date().toISOString(),
    dryRun: params.dryRun,
    enabled: params.enabled,
    forced: params.forced,
    vaultPath: params.vaultPath,
    obsidianAdapterSummary: params.obsidianAdapterSummary,
    supabaseAvailability: params.supabaseAvailability,
    counts: {
      total: docs.length,
      obsidian: docs.filter((doc) => doc.section === 'obsidian').length,
      repo: docs.filter((doc) => doc.section === 'repo').length,
      supabase: docs.filter((doc) => doc.section === 'supabase').length,
    },
    docs: docs.map((doc) => ({ section: doc.section, fileName: doc.fileName, sourceRef: doc.sourceRef })),
    memoryIndex: params.memoryIndex,
  };
};

const loadSupabaseDocs = async (guildId: string | null): Promise<{ docs: ProjectionDoc[]; availability: string }> => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { docs: [], availability: 'missing_credentials' };
  }

  const client = createScriptClient();
  try {
    let query = client
      .from('agent_weekly_reports')
      .select('report_key, report_kind, guild_id, baseline_summary, candidate_summary, delta_summary, top_actions, created_at')
      .in('report_kind', [...DEFAULT_REPORT_KINDS])
      .order('created_at', { ascending: false })
      .limit(100);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { data, error } = await query;
    if (error) {
      if (ALLOW_MISSING_SUPABASE && isMissingRelationError(error, 'agent_weekly_reports')) {
        return { docs: [], availability: 'missing_table' };
      }
      throw new Error(error.message || 'AGENT_WEEKLY_REPORTS_QUERY_FAILED');
    }

    const docs = pickLatestReportRows(Array.isArray(data) ? data : []).map((row) => ({
      fileName: `${sanitizeName(String(row.report_kind || 'weekly-report'))}.md`,
      title: `Supabase ${String(row.report_kind || 'weekly-report')}`,
      content: [
        `# Supabase ${String(row.report_kind || 'weekly-report')}`,
        '',
        `- source: supabase:agent_weekly_reports:${String(row.report_key || '').trim() || 'unknown'}`,
        `- created_at: ${String(row.created_at || '').trim() || 'unknown'}`,
        `- guild_id: ${String(row.guild_id || '*').trim() || '*'}`,
        '',
        '## baseline_summary',
        '```json',
        clip(asJsonBlock(row.baseline_summary), Math.max(2_000, Math.floor(MAX_DOC_CHARS / 2))),
        '```',
        '',
        '## candidate_summary',
        '```json',
        clip(asJsonBlock(row.candidate_summary), Math.max(1_000, Math.floor(MAX_DOC_CHARS / 4))),
        '```',
        '',
        '## delta_summary',
        '```json',
        clip(asJsonBlock(row.delta_summary), Math.max(1_000, Math.floor(MAX_DOC_CHARS / 4))),
        '```',
        '',
        '## top_actions',
        '```json',
        clip(asJsonBlock(row.top_actions), Math.max(1_000, Math.floor(MAX_DOC_CHARS / 4))),
        '```',
      ].join('\n'),
      sourceRef: `supabase:agent_weekly_reports:${String(row.report_key || '').trim() || 'unknown'}`,
      section: 'supabase' as ProjectionSection,
    }));

    return { docs, availability: 'ok' };
  } catch (error) {
    if (ALLOW_MISSING_SUPABASE && isMissingRelationError(error, 'agent_weekly_reports')) {
      return { docs: [], availability: 'missing_table' };
    }
    throw error;
  }
};

const writeProjectionDocs = (docs: ProjectionDoc[]): void => {
  ensureCleanDir(OUTPUT_DIR);
  for (const doc of docs) {
    const targetDir = path.join(OUTPUT_DIR, doc.section);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, doc.fileName), `${doc.content}\n`, 'utf8');
  }
};

const writeSummary = (summary: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
};

const runJarvisMemoryIndex = async (): Promise<string> => {
  await runJarvisCli(['--version'], 10_000);
  const { stdout } = await runJarvisCli(['memory', 'index', OUTPUT_DIR], INDEX_TIMEOUT_MS);
  return stdout.trim();
};

async function main() {
  const dryRun = parseBool(parseArg('dryRun', 'false'));
  const force = parseBool(parseArg('force', 'false'));
  const guildId = String(parseArg('guildId', '')).trim() || null;
  const vaultPath = resolveVaultPath();

  if (!ENABLED && !dryRun && !force) {
    console.log('[OPENJARVIS-MEMORY-SYNC] skipped: OPENJARVIS_MEMORY_SYNC_ENABLED/OPENJARVIS_LEARNING_LOOP_ENABLED is false');
    return;
  }

  const { docs: obsidianDocs, adapterSummary } = await loadObsidianDocs(vaultPath);
  const repoDocs = loadRepoDocs();
  const { docs: supabaseDocs, availability } = await loadSupabaseDocs(guildId);
  const allDocs = [...obsidianDocs, ...repoDocs, ...supabaseDocs];

  if (allDocs.length === 0) {
    console.log('[OPENJARVIS-MEMORY-SYNC] skipped: no projection documents were collected');
    return;
  }

  writeProjectionDocs(allDocs);
  const summary = buildProjectionSummary({
    generatedAt: new Date().toISOString(),
    dryRun,
    enabled: ENABLED,
    forced: force,
    vaultPath,
    obsidianAdapterSummary: adapterSummary,
    supabaseAvailability: availability,
    docs: allDocs,
    memoryIndex: {
      attempted: !dryRun,
      status: dryRun ? 'skipped' : 'pending',
      completedAt: null,
      outputSummary: null,
      reason: dryRun ? 'dry_run' : null,
    },
  });
  writeSummary(summary);

  console.log(`[OPENJARVIS-MEMORY-SYNC] projection prepared: docs=${allDocs.length} obsidian=${obsidianDocs.length} repo=${repoDocs.length} supabase=${supabaseDocs.length}`);
  console.log(`[OPENJARVIS-MEMORY-SYNC] obsidian routing: ${adapterSummary}`);
  console.log(`[OPENJARVIS-MEMORY-SYNC] supabase availability: ${availability}`);

  if (dryRun) {
    console.log(`[OPENJARVIS-MEMORY-SYNC] dry-run only: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`);
    return;
  }

  try {
    const output = await runJarvisMemoryIndex();
    summary.memoryIndex = {
      attempted: true,
      status: 'completed',
      completedAt: new Date().toISOString(),
      outputSummary: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5).join(' | ') || 'jarvis memory index completed',
      reason: null,
    };
    writeSummary(summary);
    if (output) {
      console.log(`[OPENJARVIS-MEMORY-SYNC] jarvis memory index output: ${output.split(/\r?\n/).slice(0, 5).join(' | ')}`);
    } else {
      console.log('[OPENJARVIS-MEMORY-SYNC] jarvis memory index completed');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.includes('openjarvis_rust')
      ? 'missing_native_extension'
      : /not recognized|ENOENT|not found/i.test(message)
        ? 'cli_unavailable'
        : message;
    summary.memoryIndex = {
      attempted: true,
      status: reason === message ? 'failed' : 'skipped',
      completedAt: new Date().toISOString(),
      outputSummary: null,
      reason,
    };
    writeSummary(summary);
    if (message.includes('openjarvis_rust')) {
      console.log('[OPENJARVIS-MEMORY-SYNC] jarvis memory index skipped: local OpenJarvis install is missing openjarvis_rust; full native extension build is required for memory indexing');
    } else {
      console.log(`[OPENJARVIS-MEMORY-SYNC] jarvis memory index skipped: ${message}`);
    }
  }
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error('[OPENJARVIS-MEMORY-SYNC] FAIL', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
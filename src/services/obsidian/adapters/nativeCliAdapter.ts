import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { parseBooleanEnv, parseIntegerEnv } from '../../../utils/env';
import type {
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianNoteWriteInput,
  ObsidianReadFileQuery,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianVaultAdapter,
} from '../types';

const execFileAsync = promisify(execFile);

// ── Configuration ──────────────────────────────────
const NATIVE_CLI_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_NATIVE_CLI_ENABLED, false);

const getNativeCliPath = (): string =>
  String(process.env.OBSIDIAN_NATIVE_CLI_PATH || '').trim();

const getVaultName = (): string =>
  String(process.env.OBSIDIAN_VAULT_NAME || 'docs').trim();

const getLoreMaxHints = (): number => {
  const raw = parseIntegerEnv(process.env.OBSIDIAN_NATIVE_CLI_LORE_MAX_HINTS, 8);
  return Math.max(1, Math.min(20, raw));
};

const getLoreMaxChars = (): number => {
  const raw = parseIntegerEnv(process.env.OBSIDIAN_NATIVE_CLI_LORE_MAX_CHARS, 280);
  return Math.max(80, Math.min(800, raw));
};

const getTimeoutMs = (): number => {
  const raw = parseIntegerEnv(process.env.OBSIDIAN_NATIVE_CLI_TIMEOUT_MS, 10_000);
  return Math.max(2_000, Math.min(30_000, raw));
};

// ── Argument sanitization ──────────────────────────
const sanitizeArg = (value: unknown, maxLen = 300): string =>
  String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/[|&;$`<>]/g, ' ')
    .replace(/\$\(|\)\s*;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

// ── Core runner ────────────────────────────────────
const runNativeCli = async (
  args: string[],
  timeout?: number,
): Promise<string | null> => {
  const cliPath = getNativeCliPath();
  if (!cliPath) return null;

  try {
    const { stdout } = await execFileAsync(cliPath, args, {
      timeout: timeout ?? getTimeoutMs(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout || '');
  } catch {
    return null;
  }
};

// ── JSON parsing helpers ───────────────────────────
const tryParseJsonArray = <T = unknown>(output: string | null): T[] => {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output.trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// ── search_vault ───────────────────────────────────
const searchVault = async (
  params: ObsidianSearchQuery,
): Promise<ObsidianSearchResult[]> => {
  const safeQuery = sanitizeArg(params.query, 300);
  const limit = Math.max(1, Math.min(50, Math.trunc(params.limit)));
  const vaultName = sanitizeArg(getVaultName(), 120);

  const output = await runNativeCli([
    'search',
    `query=${safeQuery}`,
    `vault=${vaultName}`,
    `limit=${limit}`,
    'format=json',
  ]);

  const items = tryParseJsonArray<string>(output);
  return items
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((filePath, idx) => ({
      filePath,
      title: path.basename(filePath, path.extname(filePath)) || 'Untitled',
      score: 1 - idx * 0.05,
    }));
};

// ── read_file ──────────────────────────────────────
const readFileFromVault = async (
  params: ObsidianReadFileQuery,
): Promise<string | null> => {
  const safePath = sanitizeArg(params.filePath, 400);
  if (!safePath) return null;

  const vaultName = sanitizeArg(getVaultName(), 120);
  return runNativeCli([
    'read',
    `path=${safePath}`,
    `vault=${vaultName}`,
  ]);
};

// ── graph_metadata (backlinks + links + tags) ──────
const getGraphMetadata = async (): Promise<Record<string, ObsidianNode>> => {
  const vaultName = sanitizeArg(getVaultName(), 120);

  // Get all files as a starting point
  const filesOutput = await runNativeCli([
    'files',
    `vault=${vaultName}`,
    'ext=md',
    'format=json',
  ]);

  // Use the search output as fallback if files command doesn't support JSON
  const filePaths = tryParseJsonArray<string>(filesOutput).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );

  if (filePaths.length === 0) return {};

  // Get tags for all files at once
  const tagsOutput = await runNativeCli([
    'tags',
    `vault=${vaultName}`,
    'counts',
    'format=json',
  ]);
  const tagsData = tryParseJsonArray<{ tag: string; count: number }>(tagsOutput);
  const globalTags = new Set(tagsData.map((t) => (t as any)?.tag ?? String(t)).filter(Boolean));

  const metadata: Record<string, ObsidianNode> = {};

  // Build metadata for a subset of files (cap at 200 to avoid timeout)
  const cappedPaths = filePaths.slice(0, 200);

  for (const filePath of cappedPaths) {
    metadata[filePath] = {
      filePath,
      title: path.basename(filePath, path.extname(filePath)),
      tags: [],
      backlinks: [],
      links: [],
    };
  }

  // Batch: fetch backlinks and links for high-value files
  const highValuePaths = cappedPaths.slice(0, 50);
  for (const filePath of highValuePaths) {
    const safeFile = sanitizeArg(filePath, 400);

    const [backlinksOutput, linksOutput, fileTagsOutput] = await Promise.all([
      runNativeCli(['backlinks', `path=${safeFile}`, `vault=${vaultName}`, 'format=json']),
      runNativeCli(['links', `path=${safeFile}`, `vault=${vaultName}`, 'format=json']),
      runNativeCli(['tags', `path=${safeFile}`, `vault=${vaultName}`, 'format=json']),
    ]);

    const backlinks = tryParseJsonArray<{ file: string }>(backlinksOutput)
      .map((b) => (b as any)?.file ?? String(b))
      .filter(Boolean);

    const links = tryParseJsonArray<string>(linksOutput)
      .map((l) => typeof l === 'string' ? l : (l as any)?.file ?? String(l))
      .filter(Boolean);

    const tags = tryParseJsonArray<string>(fileTagsOutput)
      .map((t) => typeof t === 'string' ? t : (t as any)?.tag ?? String(t))
      .filter(Boolean);

    if (metadata[filePath]) {
      metadata[filePath].backlinks = backlinks;
      metadata[filePath].links = links;
      metadata[filePath].tags = tags;
    }
  }

  return metadata;
};

// ── write_note ─────────────────────────────────────
const writeNote = async (
  params: ObsidianNoteWriteInput,
): Promise<{ path: string }> => {
  const vaultName = sanitizeArg(getVaultName(), 120);
  const safeName = sanitizeArg(params.fileName, 200);
  const safeContent = String(params.content || '');

  if (!safeName) {
    throw new Error('writeNote: fileName is required');
  }

  const guildPrefix = params.guildId ? `guilds/${sanitizeArg(params.guildId, 40)}/` : '';
  const targetPath = `${guildPrefix}${safeName}`;

  const output = await runNativeCli([
    'create',
    `name=${safeName}`,
    `path=${targetPath}`,
    `vault=${vaultName}`,
    `content=${safeContent}`,
  ]);

  if (output === null) {
    throw new Error('writeNote: native CLI returned no output');
  }

  // Set tags if provided
  if (params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      const safeTag = sanitizeArg(tag, 60);
      if (safeTag) {
        await runNativeCli([
          'property:set',
          `path=${targetPath}`,
          `vault=${vaultName}`,
          'name=tags',
          `value=${safeTag}`,
          'type=list',
        ]);
      }
    }
  }

  // Set properties if provided
  if (params.properties) {
    for (const [key, value] of Object.entries(params.properties)) {
      if (value === null || value === undefined) continue;
      const safeKey = sanitizeArg(key, 60);
      const safeValue = sanitizeArg(String(value), 200);
      if (safeKey && safeValue) {
        await runNativeCli([
          'property:set',
          `path=${targetPath}`,
          `vault=${vaultName}`,
          `name=${safeKey}`,
          `value=${safeValue}`,
        ]);
      }
    }
  }

  return { path: targetPath };
};

// ── read_lore (graph-first retrieval) ──────────────
const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const safeGoal = sanitizeArg(params.goal, 300);
  const safeGuildId = sanitizeArg(params.guildId, 80);
  if (!safeGoal) return [];

  const maxHints = getLoreMaxHints();
  const maxChars = getLoreMaxChars();

  // Phase 1: Search for relevant files
  const searchResults = await searchVault({
    vaultPath: params.vaultPath,
    query: safeGoal,
    limit: Math.max(maxHints * 2, 12),
  });

  if (searchResults.length === 0) return [];

  // Phase 2: Rank — guild-scoped files first
  const guildPrefix = safeGuildId ? `guilds/${safeGuildId}/` : '';
  const ranked = [...searchResults].sort((a, b) => {
    if (guildPrefix) {
      const aGuild = a.filePath.includes(guildPrefix) ? 1 : 0;
      const bGuild = b.filePath.includes(guildPrefix) ? 1 : 0;
      if (aGuild !== bGuild) return bGuild - aGuild;
    }
    return b.score - a.score;
  });

  // Phase 3: Enrich with backlinks for context density
  const vaultName = sanitizeArg(getVaultName(), 120);
  const out: string[] = [];
  const visited = new Set<string>();

  for (const item of ranked) {
    if (out.length >= maxHints) break;
    if (visited.has(item.filePath)) continue;
    visited.add(item.filePath);

    // Read content + backlinks in parallel
    const safeFile = sanitizeArg(item.filePath, 400);
    const [content, backlinksOutput] = await Promise.all([
      readFileFromVault({ vaultPath: params.vaultPath, filePath: item.filePath }),
      runNativeCli(['backlinks', `path=${safeFile}`, `vault=${vaultName}`, 'format=json']),
    ]);

    if (!content) continue;

    const backlinks = tryParseJsonArray<{ file: string }>(backlinksOutput)
      .map((b) => (b as any)?.file ?? String(b))
      .filter(Boolean);

    const excerpt = String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .slice(0, 5)
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);

    if (!excerpt) continue;

    const backlinkSuffix = backlinks.length > 0
      ? ` [←${backlinks.length}]`
      : '';

    out.push(`[obsidian-native] ${item.filePath}${backlinkSuffix} :: ${excerpt}`);
  }

  return out;
};

// ── Export ──────────────────────────────────────────
export const nativeCliObsidianAdapter: ObsidianVaultAdapter = {
  id: 'native-cli',
  capabilities: ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note'],
  isAvailable: () => NATIVE_CLI_ENABLED && getNativeCliPath().length > 0,
  readLore,
  searchVault,
  readFile: readFileFromVault,
  getGraphMetadata,
  writeNote,
};

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type {
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianReadFileQuery,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianVaultAdapter,
} from '../types';

const execFileAsync = promisify(execFile);

const getHeadlessCommand = (): string => {
  return String(process.env.OBSIDIAN_HEADLESS_COMMAND || 'ob').trim();
};

const getVaultName = (): string => {
  return String(process.env.OBSIDIAN_VAULT_NAME || 'docs').trim();
};

const isHeadlessEnabled = (): boolean => {
  return String(process.env.OBSIDIAN_HEADLESS_ENABLED || '').trim().toLowerCase() === 'true';
};

const getHeadlessLoreMaxHints = (): number => {
  const raw = Number(process.env.OBSIDIAN_HEADLESS_LORE_MAX_HINTS ?? 6);
  if (!Number.isFinite(raw)) {
    return 6;
  }
  return Math.max(1, Math.min(12, Math.trunc(raw)));
};

const getHeadlessLoreMaxChars = (): number => {
  const raw = Number(process.env.OBSIDIAN_HEADLESS_LORE_MAX_CHARS ?? 220);
  if (!Number.isFinite(raw)) {
    return 220;
  }
  return Math.max(80, Math.min(600, Math.trunc(raw)));
};

const sanitizeArg = (value: unknown, maxLen = 300): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\r?\n/g, ' ')
  .replace(/[|&;$`<>]/g, ' ')
  .replace(/\$\(|\)\s*;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLen);

const runHeadless = async (args: string[], timeout = 15000): Promise<string | null> => {
  const command = getHeadlessCommand();
  if (!command) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout || '');
  } catch {
    return null;
  }
};

const parseSearchResults = (output: string): ObsidianSearchResult[] => {
  const text = String(output || '').trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((row) => {
          const r = row as Record<string, unknown>;
          const filePath = String(r.path || r.filePath || '').trim();
          if (!filePath) return null;
          const scoreRaw = Number(r.score ?? r.rank ?? 0.5);
          const score = Number.isFinite(scoreRaw) ? scoreRaw : 0.5;
          const title = String(r.title || path.basename(filePath, path.extname(filePath)) || 'Untitled').trim();
          return { filePath, title, score };
        })
        .filter((row): row is ObsidianSearchResult => Boolean(row));
    }
  } catch {
    // Fallback to text parsing.
  }

  const out: ObsidianSearchResult[] = [];
  for (const line of text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)) {
    const parts = line.split('|').map((v) => v.trim()).filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    const filePath = parts[0];
    let title = path.basename(filePath, path.extname(filePath)) || 'Untitled';
    let score = 0.5;

    if (parts.length >= 2) {
      const numericIndex = parts.findIndex((part) => /^-?\d+(\.\d+)?$/.test(part));
      if (numericIndex >= 0) {
        score = Number(parts[numericIndex]);
      }

      const nonNumeric = parts.filter((part) => !/^-?\d+(\.\d+)?$/.test(part));
      if (nonNumeric.length >= 2) {
        title = nonNumeric[1] || title;
      }
    }

    out.push({ filePath, title, score: Number.isFinite(score) ? score : 0.5 });
  }

  return out;
};

const parseGraphMetadata = (output: string): Record<string, ObsidianNode> => {
  try {
    const data = JSON.parse(String(output || ''));
    if (!Array.isArray(data)) {
      return {};
    }

    const metadata: Record<string, ObsidianNode> = {};
    for (const item of data) {
      const r = item as Record<string, unknown>;
      const filePath = String(r.path || r.filePath || '').trim();
      if (!filePath) {
        continue;
      }
      metadata[filePath] = {
        filePath,
        title: String(r.title || path.basename(filePath, path.extname(filePath)) || '').trim() || undefined,
        tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        backlinks: Array.isArray(r.backlinks) ? (r.backlinks as unknown[]).map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        links: Array.isArray(r.links) ? (r.links as unknown[]).map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        category: r.category ? String(r.category) : undefined,
      };
    }

    return metadata;
  } catch {
    return {};
  }
};

const toLoreHint = (filePath: string, markdown: string): string | null => {
  const maxChars = getHeadlessLoreMaxChars();
  const joined = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .slice(0, 5)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!joined) {
    return null;
  }

  return `[obsidian-headless] ${filePath} :: ${joined.slice(0, maxChars)}`;
};

const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const safeGuildId = sanitizeArg(params.guildId, 80);
  const safeGoal = sanitizeArg(params.goal, 220);
  if (!safeGoal) {
    return [];
  }

  const maxHints = getHeadlessLoreMaxHints();
  const searchResults = await searchVault({
    vaultPath: params.vaultPath,
    query: safeGoal,
    limit: Math.max(maxHints * 2, 8),
  });

  if (searchResults.length === 0) {
    return [];
  }

  const guildPrefix = safeGuildId ? `guilds/${safeGuildId}/` : '';
  const ranked = [...searchResults].sort((a, b) => {
    if (!guildPrefix) {
      return b.score - a.score;
    }
    const aGuild = a.filePath.includes(guildPrefix) ? 1 : 0;
    const bGuild = b.filePath.includes(guildPrefix) ? 1 : 0;
    if (aGuild !== bGuild) {
      return bGuild - aGuild;
    }
    return b.score - a.score;
  });

  const out: string[] = [];
  const visited = new Set<string>();
  for (const item of ranked) {
    if (out.length >= maxHints) {
      break;
    }
    if (visited.has(item.filePath)) {
      continue;
    }
    visited.add(item.filePath);

    const markdown = await readFileFromVault({
      vaultPath: params.vaultPath,
      filePath: item.filePath,
    });
    if (!markdown) {
      continue;
    }

    const hint = toLoreHint(item.filePath, markdown);
    if (hint) {
      out.push(hint);
    }
  }

  return out;
};

const searchVault = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  const safeQuery = sanitizeArg(params.query, 220);
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(params.limit)));
  const vaultName = sanitizeArg(getVaultName(), 120);

  const primary = await runHeadless([
    'search',
    `vault=${vaultName}`,
    `query=${safeQuery}`,
    `limit=${safeLimit}`,
    'format=json',
  ], 15000);

  if (primary) {
    const parsed = parseSearchResults(primary);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const legacy = await runHeadless([
    'search',
    '--query',
    safeQuery,
    '--vault-name',
    vaultName,
    '--limit',
    String(safeLimit),
  ], 15000);

  return legacy ? parseSearchResults(legacy) : [];
};

const readFileFromVault = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const safePath = sanitizeArg(params.filePath, 400);
  if (!safePath) {
    return null;
  }

  const vaultName = sanitizeArg(getVaultName(), 120);

  const primary = await runHeadless([
    'read',
    `vault=${vaultName}`,
    `path=${safePath}`,
  ], 12000);

  if (primary !== null) {
    return primary;
  }

  const legacy = await runHeadless([
    'read',
    safePath,
    '--vault-name',
    vaultName,
  ], 12000);

  return legacy;
};

const getGraphMetadata = async (): Promise<Record<string, ObsidianNode>> => {
  const vaultName = sanitizeArg(getVaultName(), 120);
  const out = await runHeadless([
    'search',
    `vault=${vaultName}`,
    'query=tag:',
    'limit=200',
    'format=json',
  ], 20000);

  if (!out) {
    return {};
  }

  return parseGraphMetadata(out);
};

export const headlessCliObsidianAdapter: ObsidianVaultAdapter = {
  id: 'headless-cli',
  capabilities: ['read_lore', 'search_vault', 'read_file', 'graph_metadata'],
  isAvailable: () => isHeadlessEnabled() && getHeadlessCommand().length > 0,
  readLore,
  searchVault,
  readFile: readFileFromVault,
  getGraphMetadata,
};

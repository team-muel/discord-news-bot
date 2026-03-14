import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type {
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

const sanitizeArg = (value: unknown, maxLen = 300): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\r?\n/g, ' ')
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
          const filePath = String((row as any)?.path || (row as any)?.filePath || '').trim();
          if (!filePath) return null;
          const scoreRaw = Number((row as any)?.score ?? (row as any)?.rank ?? 0.5);
          const score = Number.isFinite(scoreRaw) ? scoreRaw : 0.5;
          const title = String((row as any)?.title || path.basename(filePath, path.extname(filePath)) || 'Untitled').trim();
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
      const filePath = String((item as any)?.path || (item as any)?.filePath || '').trim();
      if (!filePath) {
        continue;
      }
      metadata[filePath] = {
        filePath,
        title: String((item as any)?.title || path.basename(filePath, path.extname(filePath)) || '').trim() || undefined,
        tags: Array.isArray((item as any)?.tags) ? (item as any).tags.map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        backlinks: Array.isArray((item as any)?.backlinks) ? (item as any).backlinks.map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        links: Array.isArray((item as any)?.links) ? (item as any).links.map((v: unknown) => String(v || '').trim()).filter(Boolean) : [],
        category: (item as any)?.category ? String((item as any).category) : undefined,
      };
    }

    return metadata;
  } catch {
    return {};
  }
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
  capabilities: ['search_vault', 'read_file', 'graph_metadata'],
  isAvailable: () => isHeadlessEnabled() && getHeadlessCommand().length > 0,
  searchVault,
  readFile: readFileFromVault,
  getGraphMetadata,
};

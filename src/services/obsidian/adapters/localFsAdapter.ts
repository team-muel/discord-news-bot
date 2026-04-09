/**
 * Local filesystem Obsidian adapter — fallback adapter that reads/writes
 * directly from the vault directory using Node.js fs operations.
 *
 * Used as a last-resort fallback when CLI-based adapters are unavailable
 * or return empty results. Supports basic read/write/search capabilities
 * but lacks Obsidian plugin integration (no graph metadata from plugins,
 * no plugin commands).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OBSIDIAN_LOCAL_FS_ENABLED, OBSIDIAN_VAULT_PATH } from '../../../config';
import { parseBooleanEnv } from '../../../utils/env';
import { atomicWriteFile } from '../../../utils/atomicWrite';
import type {
  ObsidianLoreQuery,
  ObsidianNoteWriteInput,
  ObsidianReadFileQuery,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianNode,
  ObsidianVaultAdapter,
} from '../types';

const isAvailable = (): boolean => OBSIDIAN_LOCAL_FS_ENABLED && OBSIDIAN_VAULT_PATH.length > 0;

// ── Git auto-push after write ────────────────────────────────────────────────

const VAULT_GIT_AUTOPUSH_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_VAULT_GIT_AUTOPUSH, false);
const VAULT_GIT_AUTOPUSH_DEBOUNCE_MS = parseInt(process.env.OBSIDIAN_VAULT_GIT_AUTOPUSH_DEBOUNCE_MS || '30000', 10);

const execFileAsync = promisify(execFile);
let _gitPushTimer: ReturnType<typeof setTimeout> | null = null;

const VAULT_GIT_SSH_KEY = process.env.OBSIDIAN_VAULT_GIT_SSH_KEY || '';

const scheduleGitPush = (vaultDir: string): void => {
  if (!VAULT_GIT_AUTOPUSH_ENABLED) return;
  if (_gitPushTimer) clearTimeout(_gitPushTimer);
  _gitPushTimer = setTimeout(() => {
    _gitPushTimer = null;
    const repoRoot = path.resolve(vaultDir, '..');
    const env = { ...process.env };
    if (VAULT_GIT_SSH_KEY) {
      env.GIT_SSH_COMMAND = `ssh -i ${VAULT_GIT_SSH_KEY} -o StrictHostKeyChecking=no`;
    }
    const opts = { cwd: repoRoot, env };
    execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts)
      .then(({ stdout: branchOut }) => {
        const branch = branchOut.trim() || 'main';
        // Only add vault data dirs that actually exist
        return execFileAsync('git', ['add', '--', 'docs/guilds/'], opts)
          .then(() => execFileAsync('git', ['diff', '--cached', '--quiet'], opts).catch(() => 'HAS_CHANGES'))
          .then((result) => {
            if (result === 'HAS_CHANGES') {
              return execFileAsync('git', ['commit', '-m', `chore: vault sync ${new Date().toISOString()}`], opts);
            }
          })
          .then(() => execFileAsync('git', ['push', 'origin', branch], opts));
      })
      .then(() => {
        console.error('[local-fs] git push completed');
      })
      .catch((err: Error) => {
        console.error('[local-fs] git push failed (non-fatal):', err.message);
      });
  }, VAULT_GIT_AUTOPUSH_DEBOUNCE_MS);
};

const resolveVaultPath = (vaultPath: string): string => {
  const resolved = path.resolve(vaultPath || OBSIDIAN_VAULT_PATH || '.');
  return resolved;
};

type VaultEntry = {
  filePath: string;
  title: string;
  content: string;
  tags: string[];
  links: string[];
};

const normalizeRelativePath = (value: string): string => value.replace(/\\/g, '/');

const extractTitle = (content: string, filePath: string): string => {
  const heading = content.split('\n').find((line) => line.startsWith('#'));
  return heading?.replace(/^#+\s*/, '').trim() || path.basename(filePath, '.md');
};

const extractTags = (content: string): string[] => {
  const tags = new Set<string>();

  for (const match of content.matchAll(/(^|\s)#([a-zA-Z0-9_-]+)/g)) {
    const value = String(match[2] || '').trim().toLowerCase();
    if (value) tags.add(value);
  }

  const frontmatterBracket = content.match(/^---[\s\S]*?^tags:\s*\[([^\]]*)\]/m);
  if (frontmatterBracket?.[1]) {
    for (const token of frontmatterBracket[1].split(',')) {
      const value = token.trim().replace(/^#/, '').toLowerCase();
      if (value) tags.add(value);
    }
  }

  const frontmatterList = content.match(/^---[\s\S]*?^tags:\s*\n([\s\S]*?)(?:^\w|^---)/m);
  if (frontmatterList?.[1]) {
    for (const match of frontmatterList[1].matchAll(/^\s*-\s*(.+)$/gm)) {
      const value = String(match[1] || '').trim().replace(/^#/, '').toLowerCase();
      if (value) tags.add(value);
    }
  }

  return [...tags];
};

const extractLinks = (content: string): string[] => {
  return Array.from(content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g))
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
};

const collectMarkdownFiles = async (vaultDir: string, relativeDir = ''): Promise<string[]> => {
  const currentDir = path.join(vaultDir, relativeDir);
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(vaultDir, relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(normalizeRelativePath(relativePath));
    }
  }

  return files;
};

const loadVaultEntries = async (vaultDir: string): Promise<VaultEntry[]> => {
  const files = await collectMarkdownFiles(vaultDir);
  const entries: VaultEntry[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(path.join(vaultDir, filePath), 'utf-8');
      entries.push({
        filePath,
        title: extractTitle(content, filePath),
        content,
        tags: extractTags(content),
        links: extractLinks(content),
      });
    } catch {
      // Skip unreadable files.
    }
  }

  return entries;
};

const resolveLinkTarget = (rawTarget: string, aliases: Map<string, string>): string | null => {
  const normalized = normalizeRelativePath(String(rawTarget || '').trim())
    .replace(/\.md$/i, '')
    .toLowerCase();
  if (!normalized) return null;
  return aliases.get(normalized) || aliases.get(path.posix.basename(normalized)) || null;
};

const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const vaultDir = resolveVaultPath(params.vaultPath);
  try {
    await fs.access(vaultDir);
  } catch {
    return [];
  }

  const hints: string[] = [];
  try {
    const entries = await loadVaultEntries(vaultDir);
    const goal = (params.goal || '').toLowerCase();
    for (const entry of entries) {
      if (hints.length >= 8) break;
      if (entry.content.toLowerCase().includes(goal) || entry.title.toLowerCase().includes(goal)) {
        hints.push(`[local-fs] ${entry.title}`);
      }
    }
  } catch {
    // Vault directory not readable
  }
  return hints;
};

const searchVault = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  const vaultDir = resolveVaultPath(params.vaultPath);
  const results: ObsidianSearchResult[] = [];
  const limit = Math.min(params.limit || 10, 50);
  const query = (params.query || '').toLowerCase();
  const tagQuery = query.startsWith('tag:') ? query.slice(4).replace(/^#/, '').trim() : '';

  try {
    const entries = await loadVaultEntries(vaultDir);

    for (const entry of entries) {
      if (results.length >= limit) break;
      let score = 0;

      if (tagQuery) {
        if (entry.tags.includes(tagQuery)) score += 3;
      } else {
        if (entry.title.toLowerCase().includes(query)) score += 1.2;
        if (entry.filePath.toLowerCase().includes(query)) score += 0.8;
        if (entry.content.toLowerCase().includes(query)) score += 1;
      }

      if (score > 0) {
        results.push({ filePath: entry.filePath, title: entry.title, score });
      }
    }
  } catch {
    // Vault not readable
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
};

const readFile = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  const fullPath = path.join(resolveVaultPath(params.vaultPath), params.filePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
};

const getGraphMetadata = async (params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  const vaultDir = resolveVaultPath(params.vaultPath);
  const graph: Record<string, ObsidianNode> = {};

  try {
    const entries = await loadVaultEntries(vaultDir);
    const aliases = new Map<string, string>();

    for (const entry of entries) {
      const fileStem = entry.filePath.replace(/\.md$/i, '').toLowerCase();
      aliases.set(fileStem, entry.filePath);
      aliases.set(path.posix.basename(fileStem), entry.filePath);
    }

    for (const entry of entries) {
      graph[entry.filePath] = {
        filePath: entry.filePath,
        title: entry.title,
        tags: entry.tags,
        backlinks: [],
        links: entry.links
          .map((link) => resolveLinkTarget(link, aliases) || normalizeRelativePath(link))
          .filter(Boolean),
      };
    }

    for (const [sourcePath, node] of Object.entries(graph)) {
      for (const targetPath of node.links) {
        if (graph[targetPath] && !graph[targetPath].backlinks.includes(sourcePath)) {
          graph[targetPath].backlinks.push(sourcePath);
        }
      }
    }
  } catch {
    // Vault not readable
  }
  return graph;
};

const writeNote = async (params: ObsidianNoteWriteInput): Promise<{ path: string }> => {
  const vaultDir = resolveVaultPath(params.vaultPath);
  const filePath = path.join(vaultDir, params.fileName);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(filePath, params.content);
  scheduleGitPush(vaultDir);

  return { path: params.fileName };
};

export const localFsObsidianAdapter: ObsidianVaultAdapter = {
  id: 'local-fs',
  capabilities: ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note'],
  isAvailable,
  readLore,
  searchVault,
  readFile,
  getGraphMetadata,
  writeNote,
};

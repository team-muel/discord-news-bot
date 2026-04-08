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

const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const vaultDir = resolveVaultPath(params.vaultPath);
  try {
    await fs.access(vaultDir);
  } catch {
    return [];
  }

  // Simple keyword search through markdown files in the vault root
  const hints: string[] = [];
  try {
    const files = await fs.readdir(vaultDir);
    const mdFiles = files.filter((f) => f.endsWith('.md')).slice(0, 50);

    const goal = (params.goal || '').toLowerCase();
    for (const file of mdFiles) {
      if (hints.length >= 8) break;
      try {
        const content = await fs.readFile(path.join(vaultDir, file), 'utf-8');
        if (content.toLowerCase().includes(goal)) {
          const firstLine = content.split('\n').find((l) => l.trim().length > 0) || file;
          hints.push(`[local-fs] ${firstLine.replace(/^#+\s*/, '').trim()}`);
        }
      } catch {
        // Skip unreadable files
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

  try {
    const files = await fs.readdir(vaultDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      if (results.length >= limit) break;
      try {
        const content = await fs.readFile(path.join(vaultDir, file), 'utf-8');
        if (content.toLowerCase().includes(query)) {
          const title = content.split('\n').find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '').trim() || file.replace('.md', '');
          results.push({ filePath: file, title, score: 0.5 });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Vault not readable
  }
  return results;
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
    const files = await fs.readdir(vaultDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      try {
        const content = await fs.readFile(path.join(vaultDir, file), 'utf-8');
        const tags = Array.from(content.matchAll(/#([a-zA-Z0-9_-]+)/g)).map((m) => m[1]);
        const links = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g)).map((m) => m[1]);
        graph[file] = {
          filePath: file,
          title: file.replace('.md', ''),
          tags,
          backlinks: [],
          links,
        };
      } catch {
        // Skip
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

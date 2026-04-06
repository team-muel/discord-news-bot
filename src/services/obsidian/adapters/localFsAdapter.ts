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
import { parseBooleanEnv } from '../../../utils/env';
import type {
  ObsidianLoreQuery,
  ObsidianNoteWriteInput,
  ObsidianReadFileQuery,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianNode,
  ObsidianVaultAdapter,
} from '../types';

const LOCAL_FS_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_LOCAL_FS_ENABLED, false);
const VAULT_PATH = String(process.env.OBSIDIAN_VAULT_PATH || '').trim();

const isAvailable = (): boolean => LOCAL_FS_ENABLED && VAULT_PATH.length > 0;

const resolveVaultPath = (vaultPath: string): string => {
  const resolved = path.resolve(vaultPath || VAULT_PATH || '.');
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
  await fs.writeFile(filePath, params.content, 'utf-8');

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

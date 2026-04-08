/**
 * Remote MCP Obsidian Adapter — routes vault operations through a remote
 * MCP Unified HTTP server (e.g. GCP VM) that has direct filesystem access
 * to the Obsidian vault.
 *
 * This solves the core problem: Render's ephemeral filesystem cannot persist
 * vault writes, and CLI-based adapters require local Obsidian. By routing
 * through the remote MCP server that runs alongside headless Obsidian on
 * the GCP VM, all vault operations (read/write/search/graph) are durable.
 *
 * Environment:
 *   OBSIDIAN_REMOTE_MCP_ENABLED  — enable this adapter (default: false)
 *   OBSIDIAN_REMOTE_MCP_URL      — base URL of the MCP HTTP server (e.g. http://34.56.232.61:8850)
 *   OBSIDIAN_REMOTE_MCP_TOKEN    — auth token (must match MCP_WORKER_AUTH_TOKEN on the remote)
 *   OBSIDIAN_REMOTE_MCP_TIMEOUT_MS — request timeout (default: 15000)
 */

import { parseBooleanEnv, parseMinIntEnv, parseStringEnv } from '../../../utils/env';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';
import type {
  ObsidianFileInfo,
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianNoteWriteInput,
  ObsidianOutlineHeading,
  ObsidianReadFileQuery,
  ObsidianSearchContextResult,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianTask,
  ObsidianVaultAdapter,
} from '../types';

// ── Config ─────────────────────────────────────────
const ENABLED = parseBooleanEnv(process.env.OBSIDIAN_REMOTE_MCP_ENABLED, false);
const BASE_URL = parseStringEnv(process.env.OBSIDIAN_REMOTE_MCP_URL, '').replace(/\/+$/, '');
const AUTH_TOKEN = parseStringEnv(process.env.OBSIDIAN_REMOTE_MCP_TOKEN, '');
const TIMEOUT_MS = parseMinIntEnv(process.env.OBSIDIAN_REMOTE_MCP_TIMEOUT_MS, 15_000, 3_000);

// ── Remote MCP call helper ─────────────────────────
type McpResult = {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const callRemoteTool = async (
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpResult> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: toolName, arguments: args }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as McpResult;
  } finally {
    clearTimeout(timer);
  }
};

const extractText = (result: McpResult): string => {
  if (!result.content || !Array.isArray(result.content)) return '';
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
};

const extractJson = <T>(result: McpResult): T | null => {
  const text = extractText(result);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const safeCall = async <T>(
  toolName: string,
  args: Record<string, unknown>,
  parser: (result: McpResult) => T,
  fallback: T,
): Promise<T> => {
  try {
    const result = await callRemoteTool(toolName, args);
    if (result.isError) {
      logger.warn('[OBSIDIAN-REMOTE-MCP] %s returned error: %s', toolName, extractText(result));
      return fallback;
    }
    return parser(result);
  } catch (err) {
    logger.warn('[OBSIDIAN-REMOTE-MCP] %s failed: %s', toolName, getErrorMessage(err));
    return fallback;
  }
};

// ── Adapter implementations ────────────────────────

const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  return safeCall(
    'obsidian.rag',
    { question: params.goal, guildId: params.guildId, contextMode: 'metadata_first' },
    (result) => {
      const data = extractJson<{ answer?: string; sources?: Array<{ filePath: string; title?: string }> }>(result);
      if (!data) return [];
      const hints: string[] = [];
      if (data.sources) {
        for (const s of data.sources.slice(0, 8)) {
          hints.push(`[remote-mcp] ${s.title || s.filePath}`);
        }
      }
      if (hints.length === 0 && data.answer) {
        hints.push(`[remote-mcp] ${data.answer.slice(0, 280)}`);
      }
      return hints;
    },
    [],
  );
};

const searchVault = async (params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> => {
  return safeCall(
    'obsidian.search',
    { keyword: params.query, maxResults: params.limit },
    (result) => {
      const data = extractJson<ObsidianSearchResult[]>(result);
      return data ?? [];
    },
    [],
  );
};

const readFile = async (params: ObsidianReadFileQuery): Promise<string | null> => {
  return safeCall(
    'obsidian.read',
    { filePath: params.filePath },
    (result) => {
      const text = extractText(result);
      return text || null;
    },
    null,
  );
};

const getGraphMetadata = async (_params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> => {
  return safeCall(
    'obsidian.graph',
    {},
    (result) => {
      const data = extractJson<{ nodes?: Record<string, ObsidianNode> }>(result);
      return data?.nodes ?? {};
    },
    {},
  );
};

const writeNote = async (params: ObsidianNoteWriteInput): Promise<{ path: string }> => {
  const result = await callRemoteTool('obsidian.write', {
    fileName: params.fileName,
    content: params.content,
    guildId: params.guildId,
  });

  if (result.isError) {
    throw new Error(`remote writeNote failed: ${extractText(result)}`);
  }

  const data = extractJson<{ ok?: boolean; path?: string }>(result);
  if (!data?.path) {
    throw new Error('remote writeNote: no path in response');
  }
  return { path: data.path };
};

const dailyAppend = async (params: { content: string }): Promise<boolean> => {
  return safeCall(
    'obsidian.daily.append',
    { content: params.content },
    () => true,
    false,
  );
};

const dailyRead = async (): Promise<string | null> => {
  return safeCall(
    'obsidian.daily.read',
    {},
    (result) => extractText(result) || null,
    null,
  );
};

const listTasks = async (): Promise<ObsidianTask[]> => {
  return safeCall(
    'obsidian.tasks',
    {},
    (result) => extractJson<ObsidianTask[]>(result) ?? [],
    [],
  );
};

const toggleTask = async (params: { filePath: string; line: number }): Promise<boolean> => {
  return safeCall(
    'obsidian.task.toggle',
    { filePath: params.filePath, line: params.line },
    () => true,
    false,
  );
};

const getOutline = async (params: { vaultPath: string; filePath: string }): Promise<ObsidianOutlineHeading[]> => {
  return safeCall(
    'obsidian.outline',
    { filePath: params.filePath },
    (result) => extractJson<ObsidianOutlineHeading[]>(result) ?? [],
    [],
  );
};

const searchContext = async (params: { vaultPath: string; query: string; limit?: number }): Promise<ObsidianSearchContextResult[]> => {
  return safeCall(
    'obsidian.search.context',
    { query: params.query, limit: params.limit ?? 50 },
    (result) => extractJson<ObsidianSearchContextResult[]>(result) ?? [],
    [],
  );
};

const readProperty = async (params: { vaultPath: string; filePath: string; name: string }): Promise<string | null> => {
  return safeCall(
    'obsidian.property.read',
    { filePath: params.filePath, name: params.name },
    (result) => extractText(result) || null,
    null,
  );
};

const setProperty = async (params: { vaultPath: string; filePath: string; name: string; value: string }): Promise<boolean> => {
  return safeCall(
    'obsidian.property.set',
    { filePath: params.filePath, name: params.name, value: params.value },
    () => true,
    false,
  );
};

const listFiles = async (params: { vaultPath: string; folder?: string; extension?: string }): Promise<ObsidianFileInfo[]> => {
  return safeCall(
    'obsidian.files',
    { folder: params.folder, extension: params.extension },
    (result) => extractJson<ObsidianFileInfo[]>(result) ?? [],
    [],
  );
};

const appendContent = async (params: { vaultPath: string; filePath: string; content: string }): Promise<boolean> => {
  return safeCall(
    'obsidian.append',
    { filePath: params.filePath, content: params.content },
    () => true,
    false,
  );
};

// ── Export ──────────────────────────────────────────
export const remoteMcpObsidianAdapter: ObsidianVaultAdapter = {
  id: 'remote-mcp',
  capabilities: [
    'read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note',
    'daily_note', 'task_management',
    'outline', 'search_context', 'property_read', 'set_property', 'files_list', 'append_content',
  ],
  isAvailable: () => ENABLED && BASE_URL.length > 0,
  readLore,
  searchVault,
  readFile,
  getGraphMetadata,
  writeNote,
  dailyAppend,
  dailyRead,
  listTasks,
  toggleTask,
  getOutline,
  searchContext,
  readProperty,
  setProperty,
  listFiles,
  appendContent,
};

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
 *   OBSIDIAN_REMOTE_MCP_ENABLED  — enable this adapter (default: false, auto-enabled when URL is set)
 *   MCP_SHARED_MCP_URL           — canonical shared full-catalog MCP ingress (preferred)
 *   OBSIDIAN_REMOTE_MCP_URL      — legacy Obsidian alias ingress (compatible fallback)
 *   MCP_SHARED_MCP_TOKEN         — shared MCP auth token (preferred)
 *   OBSIDIAN_REMOTE_MCP_TOKEN    — legacy Obsidian auth token alias (falls back to MCP_WORKER_AUTH_TOKEN)
 *   OBSIDIAN_REMOTE_MCP_TIMEOUT_MS — request timeout (default: 15000)
 */

import { parseBooleanEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../../utils/env';
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

export type RemoteMcpBaseUrlSource = 'shared-mcp' | 'legacy-obsidian' | 'unconfigured';

const stripTrailingSlash = (value: string): string => String(value || '').trim().replace(/\/+$/, '');

const rewriteTerminalPath = (baseUrl: string, fromPath: string, toPath: string): string | null => {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  if (!normalizedBaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(normalizedBaseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    if (normalizedPath !== fromPath) {
      return null;
    }
    parsed.pathname = toPath;
    parsed.search = '';
    parsed.hash = '';
    return stripTrailingSlash(parsed.toString());
  } catch {
    return null;
  }
};

const SHARED_BASE_URL = parseUrlEnv(process.env.MCP_SHARED_MCP_URL, '');
const LEGACY_BASE_URL = parseUrlEnv(process.env.OBSIDIAN_REMOTE_MCP_URL, '');
const BASE_URL = SHARED_BASE_URL || LEGACY_BASE_URL;
const BASE_URL_SOURCE: RemoteMcpBaseUrlSource = SHARED_BASE_URL
  ? 'shared-mcp'
  : LEGACY_BASE_URL
    ? 'legacy-obsidian'
    : 'unconfigured';
const LEGACY_ALIAS_URL = rewriteTerminalPath(BASE_URL, '/mcp', '/obsidian');
const CANONICAL_SHARED_URL = rewriteTerminalPath(BASE_URL, '/obsidian', '/mcp') || BASE_URL;
const USES_CANONICAL_SHARED_INGRESS = BASE_URL_SOURCE === 'shared-mcp' || Boolean(LEGACY_ALIAS_URL);

// ── Config ─────────────────────────────────────────
const ENABLED = parseBooleanEnv(process.env.OBSIDIAN_REMOTE_MCP_ENABLED, BASE_URL.length > 0);
const AUTH_TOKEN = parseStringEnv(
  process.env.MCP_SHARED_MCP_TOKEN
    ?? process.env.OBSIDIAN_REMOTE_MCP_TOKEN
    ?? process.env.MCP_WORKER_AUTH_TOKEN,
  '',
);
const TIMEOUT_MS = parseMinIntEnv(process.env.OBSIDIAN_REMOTE_MCP_TIMEOUT_MS, 15_000, 3_000);

export type RemoteMcpAdapterProbeStatus = {
  reachable: boolean | null;
  authValid: boolean | null;
  toolDiscoveryOk: boolean | null;
  remoteObsidianStatusOk: boolean | null;
  error: string | null;
};

export type RemoteMcpAdapterDiagnostics = {
  enabled: boolean;
  configured: boolean;
  baseUrl: string | null;
  baseUrlSource: RemoteMcpBaseUrlSource;
  canonicalBaseUrl: string | null;
  compatibilityBaseUrl: string | null;
  usesCanonicalSharedIngress: boolean;
  authConfigured: boolean;
  lastToolName: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastProbeAt: string | null;
  lastProbe: RemoteMcpAdapterProbeStatus;
  remoteAdapterRuntime: Record<string, unknown> | null;
};

const createEmptyProbeStatus = (): RemoteMcpAdapterProbeStatus => ({
  reachable: null,
  authValid: null,
  toolDiscoveryOk: null,
  remoteObsidianStatusOk: null,
  error: null,
});

const getConfigDiagnostics = (): Pick<RemoteMcpAdapterDiagnostics, 'enabled' | 'configured' | 'baseUrl' | 'baseUrlSource' | 'canonicalBaseUrl' | 'compatibilityBaseUrl' | 'usesCanonicalSharedIngress' | 'authConfigured'> => ({
  enabled: ENABLED,
  configured: ENABLED && BASE_URL.length > 0,
  baseUrl: BASE_URL || null,
  baseUrlSource: BASE_URL_SOURCE,
  canonicalBaseUrl: CANONICAL_SHARED_URL || null,
  compatibilityBaseUrl: LEGACY_ALIAS_URL || (BASE_URL_SOURCE === 'legacy-obsidian' ? BASE_URL || null : null),
  usesCanonicalSharedIngress: USES_CANONICAL_SHARED_INGRESS,
  authConfigured: AUTH_TOKEN.length > 0,
});

let remoteDiagnostics: RemoteMcpAdapterDiagnostics = {
  ...getConfigDiagnostics(),
  lastToolName: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastProbeAt: null,
  lastProbe: createEmptyProbeStatus(),
  remoteAdapterRuntime: null,
};

const toIsoNow = (): string => new Date().toISOString();

const updateDiagnostics = (
  patch: Partial<RemoteMcpAdapterDiagnostics> & { lastProbe?: Partial<RemoteMcpAdapterProbeStatus> },
): void => {
  remoteDiagnostics = {
    ...remoteDiagnostics,
    ...getConfigDiagnostics(),
    ...patch,
    lastProbe: {
      ...remoteDiagnostics.lastProbe,
      ...(patch.lastProbe ?? {}),
    },
  };
};

const recordToolSuccess = (toolName: string): void => {
  updateDiagnostics({
    lastToolName: toolName,
    lastSuccessAt: toIsoNow(),
    lastError: null,
    consecutiveFailures: 0,
  });
};

const recordToolFailure = (toolName: string, error: string): void => {
  updateDiagnostics({
    lastToolName: toolName,
    lastErrorAt: toIsoNow(),
    lastError: error,
    consecutiveFailures: remoteDiagnostics.consecutiveFailures + 1,
  });
};

export const getRemoteMcpAdapterDiagnostics = (): RemoteMcpAdapterDiagnostics => ({
  ...remoteDiagnostics,
  ...getConfigDiagnostics(),
  lastProbe: { ...remoteDiagnostics.lastProbe },
  remoteAdapterRuntime: remoteDiagnostics.remoteAdapterRuntime ? { ...remoteDiagnostics.remoteAdapterRuntime } : null,
});

export const __resetRemoteMcpAdapterDiagnostics = (): void => {
  remoteDiagnostics = {
    ...getConfigDiagnostics(),
    lastToolName: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastProbeAt: null,
    lastProbe: createEmptyProbeStatus(),
    remoteAdapterRuntime: null,
  };
};

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

// ── Remote MCP call helper ─────────────────────────
type McpResult = {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const callRemoteTool = async (
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpResult> => {
  if (!BASE_URL) {
    throw new Error('REMOTE_MCP_URL_NOT_CONFIGURED');
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetchWithTimeout(`${BASE_URL}/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: toolName, arguments: args }),
    });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as McpResult;
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
      const errorText = extractText(result) || 'remote tool returned isError';
      logger.warn('[OBSIDIAN-REMOTE-MCP] %s returned error: %s', toolName, errorText);
      recordToolFailure(toolName, errorText);
      return fallback;
    }
    const parsed = parser(result);
    recordToolSuccess(toolName);
    return parsed;
  } catch (err) {
    const errorText = getErrorMessage(err);
    logger.warn('[OBSIDIAN-REMOTE-MCP] %s failed: %s', toolName, errorText);
    recordToolFailure(toolName, errorText);
    return fallback;
  }
};

export const probeRemoteMcpAdapter = async (): Promise<RemoteMcpAdapterDiagnostics> => {
  const probeStartedAt = toIsoNow();

  if (!ENABLED) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        error: 'remote_mcp_disabled',
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
  }

  if (!BASE_URL) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        error: 'remote_mcp_url_not_configured',
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
  }

  try {
    const healthResponse = await fetchWithTimeout(`${BASE_URL}/health`);
    if (!healthResponse.ok) {
      updateDiagnostics({
        lastProbeAt: probeStartedAt,
        lastProbe: {
          ...createEmptyProbeStatus(),
          reachable: false,
          error: `health_http_${healthResponse.status}`,
        },
        remoteAdapterRuntime: null,
      });
      return getRemoteMcpAdapterDiagnostics();
    }
  } catch (error) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        reachable: false,
        error: getErrorMessage(error),
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
  }

  if (!AUTH_TOKEN) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        reachable: true,
        authValid: false,
        error: 'remote_mcp_token_not_configured',
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
  }

  try {
    const discoverResponse = await fetchWithTimeout(`${BASE_URL}/tools/discover`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    });
    if (discoverResponse.status === 401) {
      updateDiagnostics({
        lastProbeAt: probeStartedAt,
        lastProbe: {
          ...createEmptyProbeStatus(),
          reachable: true,
          authValid: false,
          toolDiscoveryOk: false,
          error: 'remote_mcp_auth_failed',
        },
        remoteAdapterRuntime: null,
      });
      return getRemoteMcpAdapterDiagnostics();
    }
    if (!discoverResponse.ok) {
      updateDiagnostics({
        lastProbeAt: probeStartedAt,
        lastProbe: {
          ...createEmptyProbeStatus(),
          reachable: true,
          authValid: true,
          toolDiscoveryOk: false,
          error: `tools_discover_http_${discoverResponse.status}`,
        },
        remoteAdapterRuntime: null,
      });
      return getRemoteMcpAdapterDiagnostics();
    }
  } catch (error) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        reachable: true,
        authValid: true,
        toolDiscoveryOk: false,
        error: getErrorMessage(error),
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
  }

  try {
    const statusResult = await callRemoteTool('obsidian.adapter.status', {});
    if (statusResult.isError) {
      updateDiagnostics({
        lastProbeAt: probeStartedAt,
        lastProbe: {
          ...createEmptyProbeStatus(),
          reachable: true,
          authValid: true,
          toolDiscoveryOk: true,
          remoteObsidianStatusOk: false,
          error: extractText(statusResult) || 'remote_obsidian_status_error',
        },
        remoteAdapterRuntime: null,
      });
      return getRemoteMcpAdapterDiagnostics();
    }

    const remoteAdapterRuntime = extractJson<Record<string, unknown>>(statusResult);
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        reachable: true,
        authValid: true,
        toolDiscoveryOk: true,
        remoteObsidianStatusOk: remoteAdapterRuntime !== null,
        error: remoteAdapterRuntime ? null : 'remote_obsidian_status_parse_failed',
      },
      remoteAdapterRuntime: remoteAdapterRuntime ?? null,
    });
    return getRemoteMcpAdapterDiagnostics();
  } catch (error) {
    updateDiagnostics({
      lastProbeAt: probeStartedAt,
      lastProbe: {
        ...createEmptyProbeStatus(),
        reachable: true,
        authValid: true,
        toolDiscoveryOk: true,
        remoteObsidianStatusOk: false,
        error: getErrorMessage(error),
      },
      remoteAdapterRuntime: null,
    });
    return getRemoteMcpAdapterDiagnostics();
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
    const errorText = extractText(result) || 'remote writeNote failed';
    recordToolFailure('obsidian.write', errorText);
    throw new Error(`remote writeNote failed: ${errorText}`);
  }

  const data = extractJson<{ ok?: boolean; path?: string }>(result);
  if (!data?.path) {
    recordToolFailure('obsidian.write', 'remote writeNote: no path in response');
    throw new Error('remote writeNote: no path in response');
  }
  recordToolSuccess('obsidian.write');
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

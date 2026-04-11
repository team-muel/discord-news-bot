/**
 * MCP Proxy Adapter
 *
 * Fetches tool catalogs from registered upstream MCP servers (with TTL caching)
 * and forwards tool calls to the correct upstream server.
 *
 * Tool naming convention:
 *   upstream.<namespace>.<sanitizedToolName>
 *
 * Sanitization: upstream tool names have dots (.) and hyphens (-) replaced with
 * underscores (_) so they round-trip cleanly through the existing dot↔hyphen
 * wire-name transformation in unifiedServer.ts.
 */

/* eslint-disable no-console */

import { MCP_UPSTREAM_TOOL_CACHE_TTL_MS } from '../config';
import {
  listUpstreams,
  getAllUpstreams,
  findUpstreamByNamespace,
  hasUpstreamToolFilters,
  isUpstreamToolAllowed,
} from './proxyRegistry';
import { normalizeMcpInputSchema } from './schemaNormalization';
import type { McpToolSpec, McpToolCallResult } from './types';
import { getErrorMessage } from '../utils/errorMessage';
import { fetchWithTimeout } from '../utils/network';

// ──── Constants ────────────────────────────────────────────────────────────────

const UPSTREAM_PREFIX = 'upstream.';
const FETCH_TIMEOUT_MS = 8_000;

// ──── Tool name helpers ────────────────────────────────────────────────────────

/**
 * Sanitize an upstream tool name for use in the internal catalog.
 * Dots and hyphens → underscores so the result is safe as an internal dot-delimited
 * segment. The original name is preserved separately in `originalUpstreamNames`.
 */
const sanitizeToolName = (rawName: string): string => rawName.replace(/[.\-]/g, '_');

/** Build the internal tool name: `upstream.<namespace>.<sanitizedName>` */
const buildInternalName = (namespace: string, rawName: string): string =>
  `${UPSTREAM_PREFIX}${namespace}.${sanitizeToolName(rawName)}`;

// ──── Original name registry ───────────────────────────────────────────────────

/**
 * Maps internal tool name → original upstream tool name.
 *
 * Sanitization is a one-way transformation: hyphens and dots both become
 * underscores, so "list-tables" and "list.tables" would both map to "list_tables".
 * Without this map, callProxiedTool would send the sanitized underscore name to
 * the upstream server, causing 404/method-not-found for any tool whose original
 * name contained a hyphen or dot.
 */
const originalUpstreamNames = new Map<string, string>();

// ──── Per-server tool cache ────────────────────────────────────────────────────

type CacheEntry = {
  tools: McpToolSpec[];
  fetchedAt: number;
  expiresAt: number;
};

type CatalogStateEntry = {
  lastFetchAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastToolCount?: number;
};

export type UpstreamDiagnosticSnapshot = {
  id: string;
  namespace: string;
  url?: string;
  protocol: 'simple' | 'streamable';
  enabled: boolean;
  label: string | null;
  description: string | null;
  plane: string | null;
  audience: string | null;
  owner: string | null;
  sourceRepo: string | null;
  filters: {
    allowlist: string[];
    denylist: string[];
    hasFilters: boolean;
  };
  catalog: {
    cacheState: 'cold' | 'warm' | 'stale';
    visibleToolCount: number;
    lastFetchAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    cacheExpiresAt: string | null;
  };
};

const toolCache = new Map<string, CacheEntry>();
const catalogState = new Map<string, CatalogStateEntry>();

const isCacheValid = (entry: CacheEntry): boolean => Date.now() < entry.expiresAt;
const toIsoTimestamp = (value: number | undefined): string | null => (typeof value === 'number' ? new Date(value).toISOString() : null);

const markCatalogSuccess = (serverId: string, toolCount: number): void => {
  const now = Date.now();
  const previous = catalogState.get(serverId);
  catalogState.set(serverId, {
    ...previous,
    lastFetchAt: now,
    lastSuccessAt: now,
    lastError: undefined,
    lastToolCount: toolCount,
  });
};

const markCatalogFailure = (serverId: string, error: string): void => {
  const now = Date.now();
  const previous = catalogState.get(serverId);
  catalogState.set(serverId, {
    ...previous,
    lastFetchAt: now,
    lastErrorAt: now,
    lastError: error,
  });
};

/** Invalidate the cached tool list for a specific server (by server id). */
export const invalidateServerCache = (serverId: string): void => {
  toolCache.delete(serverId);
};

/** Invalidate all cached tool lists (name map preserved for callProxiedTool). */
export const invalidateAllServerCaches = (): void => {
  toolCache.clear();
  catalogState.clear();
  // originalUpstreamNames is intentionally NOT cleared here — it is a stable
  // translation table that only changes when fetchServerTools re-parses the
  // upstream catalog.  Keeping it lets callProxiedTool resolve the correct
  // original name between cache invalidation and the next listProxiedTools call.
};

export const listUpstreamDiagnostics = (
  options: { includeDisabled?: boolean; includeUrl?: boolean } = {},
): UpstreamDiagnosticSnapshot[] => {
  const { includeDisabled = false, includeUrl = false } = options;
  const upstreams = includeDisabled ? getAllUpstreams() : listUpstreams();

  return upstreams.map((server) => {
    const cache = toolCache.get(server.id);
    const catalog = catalogState.get(server.id);
    const cacheState: 'cold' | 'warm' | 'stale' = !cache
      ? 'cold'
      : isCacheValid(cache)
        ? 'warm'
        : 'stale';

    return {
      id: server.id,
      namespace: server.namespace,
      ...(includeUrl ? { url: server.url } : {}),
      protocol: server.protocol ?? 'simple',
      enabled: server.enabled !== false,
      label: server.label ?? null,
      description: server.description ?? null,
      plane: server.plane ?? null,
      audience: server.audience ?? null,
      owner: server.owner ?? null,
      sourceRepo: server.sourceRepo ?? null,
      filters: {
        allowlist: [...(server.toolAllowlist ?? [])],
        denylist: [...(server.toolDenylist ?? [])],
        hasFilters: hasUpstreamToolFilters(server),
      },
      catalog: {
        cacheState,
        visibleToolCount: cache?.tools.length ?? catalog?.lastToolCount ?? 0,
        lastFetchAt: toIsoTimestamp(catalog?.lastFetchAt),
        lastSuccessAt: toIsoTimestamp(catalog?.lastSuccessAt),
        lastErrorAt: toIsoTimestamp(catalog?.lastErrorAt),
        lastError: catalog?.lastError ?? null,
        cacheExpiresAt: toIsoTimestamp(cache?.expiresAt),
      },
    };
  });
};

// ──── Upstream HTTP helpers ────────────────────────────────────────────────────

type UpstreamServerCfg = {
  id: string;
  url: string;
  namespace: string;
  token?: string;
  protocol?: 'simple' | 'streamable';
};

const makeAuthHeaders = (token?: string): Record<string, string> => {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

// ──── Streamable HTTP session management ───────────────────────────────────────

type StreamableSession = {
  sessionId: string;
  expiresAt: number;
};

/** Active Streamable HTTP sessions keyed by server id. */
const streamableSessions = new Map<string, StreamableSession>();

const STREAMABLE_SESSION_TTL_MS = 10 * 60_000; // 10 minutes

/**
 * Obtain (or reuse) a Streamable HTTP session for a server.
 * Performs the JSON-RPC `initialize` + `notifications/initialized` handshake.
 */
const getStreamableSession = async (server: UpstreamServerCfg): Promise<string | null> => {
  const cached = streamableSessions.get(server.id);
  if (cached && Date.now() < cached.expiresAt) return cached.sessionId;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
    ...makeAuthHeaders(server.token),
  };

  try {
    const initRes = await fetchWithTimeout(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'muel-bot-proxy', version: '1.0.0' },
        },
      }),
    }, FETCH_TIMEOUT_MS);

    const sessionId = initRes.headers.get('mcp-session-id');
    if (!sessionId) {
      console.error('[mcp-proxy] streamable init for %s: no session ID returned', server.id);
      return null;
    }

    // Send initialized notification (fire and forget)
    fetchWithTimeout(server.url, {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }, FETCH_TIMEOUT_MS).catch(() => { /* best-effort */ });

    streamableSessions.set(server.id, { sessionId, expiresAt: Date.now() + STREAMABLE_SESSION_TTL_MS });
    console.error('[mcp-proxy] streamable session established for %s', server.id);
    return sessionId;
  } catch (err) {
    console.error('[mcp-proxy] streamable init for %s failed: %s', server.id, getErrorMessage(err));
    return null;
  }
};

/** Invalidate a streamable session (e.g. on 400/session-expired). */
const invalidateStreamableSession = (serverId: string): void => {
  streamableSessions.delete(serverId);
};

/**
 * Send a JSON-RPC request over MCP Streamable HTTP transport.
 * Handles session lifecycle: auto-reinitializes on session expiry (one retry).
 */
const streamableJsonRpc = async (
  server: UpstreamServerCfg,
  method: string,
  params: Record<string, unknown>,
  rpcId: number = 1,
): Promise<unknown> => {
  const attempt = async (retried: boolean): Promise<unknown> => {
    const sessionId = await getStreamableSession(server);
    if (!sessionId) throw new Error('Failed to establish streamable session');

    const res = await fetchWithTimeout(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        ...makeAuthHeaders(server.token),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    }, FETCH_TIMEOUT_MS);

    if (res.status === 400 && !retried) {
      // Session likely expired — reinitialize once
      invalidateStreamableSession(server.id);
      return attempt(true);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  return attempt(false);
};

/**
 * Fetch the tool catalog from an upstream MCP server.
 * Supports both 'simple' protocol (JSON-RPC /mcp/rpc + REST /tools/list)
 * and 'streamable' protocol (MCP Streamable HTTP with session management).
 * Returns empty array on any failure (non-blocking).
 */
const fetchServerTools = async (server: UpstreamServerCfg): Promise<McpToolSpec[]> => {
  try {
    // ── Streamable HTTP protocol (e.g. Supabase MCP) ──
    if (server.protocol === 'streamable') {
      const data = await streamableJsonRpc(server, 'tools/list', {}) as {
        result?: { tools?: unknown[] };
      };
      const rawTools = data?.result?.tools ?? [];
      if (Array.isArray(rawTools)) {
        const tools = parseToolSpecs(rawTools, server);
        markCatalogSuccess(server.id, tools.length);
        return tools;
      }
      markCatalogFailure(server.id, 'invalid streamable tools/list payload');
      return [];
    }

    // ── Simple protocol: JSON-RPC /mcp/rpc then REST /tools/list ──
    // Primary: JSON-RPC tools/list over /mcp/rpc
    const rpcRes = await fetchWithTimeout(`${server.url}/mcp/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...makeAuthHeaders(server.token),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }, FETCH_TIMEOUT_MS);

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json() as { result?: { tools?: unknown[] }; tools?: unknown[] };
      const rawTools = rpcData?.result?.tools ?? (rpcData as { tools?: unknown[] })?.tools ?? [];
      if (Array.isArray(rawTools)) {
        const tools = parseToolSpecs(rawTools, server);
        markCatalogSuccess(server.id, tools.length);
        return tools;
      }
    }

    // Fallback: REST /tools/list
    const restRes = await fetchWithTimeout(`${server.url}/tools/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...makeAuthHeaders(server.token) },
      body: JSON.stringify({}),
    }, FETCH_TIMEOUT_MS);

    if (restRes.ok) {
      const restData = await restRes.json() as { tools?: unknown[] };
      const rawTools = restData?.tools ?? [];
      if (Array.isArray(rawTools)) {
        const tools = parseToolSpecs(rawTools, server);
        markCatalogSuccess(server.id, tools.length);
        return tools;
      }
    }

    console.error('[mcp-proxy] upstream %s: tools/list returned non-ok status', server.id);
    markCatalogFailure(server.id, 'tools/list returned non-ok status');
    return [];
  } catch (err) {
    const reason = getErrorMessage(err);
    console.error('[mcp-proxy] upstream %s: failed to fetch tools — %s', server.id, reason);
    markCatalogFailure(server.id, reason);
    return [];
  }
};

const parseToolSpecs = (rawTools: unknown[], server: UpstreamServerCfg): McpToolSpec[] => {
  const result: McpToolSpec[] = [];
  for (const raw of rawTools) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const t = raw as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) continue;
    if (!isUpstreamToolAllowed(server, name)) continue;
    const description = typeof t.description === 'string' ? t.description : `Upstream tool: ${name}`;
    const inputSchema = normalizeMcpInputSchema(t.inputSchema);
    const internalName = buildInternalName(server.namespace, name);
    // Preserve the original name so callProxiedTool can send the exact name the
    // upstream server registered (hyphens must not be silently converted).
    originalUpstreamNames.set(internalName, name);
    result.push({
      name: internalName,
      description,
      inputSchema,
    });
  }
  return result;
};

// ──── Public API ───────────────────────────────────────────────────────────────

/**
 * List all proxied tools from all enabled upstream servers.
 * Results are cached per server for `MCP_UPSTREAM_TOOL_CACHE_TTL_MS` ms.
 * A failed server contributes zero tools without blocking the rest.
 */
export const listProxiedTools = async (): Promise<McpToolSpec[]> => {
  const upstreams = listUpstreams();
  if (upstreams.length === 0) return [];

  const results = await Promise.allSettled(
    upstreams.map(async (server) => {
      const cached = toolCache.get(server.id);
      if (cached && isCacheValid(cached)) return cached.tools;

      const tools = await fetchServerTools(server);
      toolCache.set(server.id, {
        tools,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + MCP_UPSTREAM_TOOL_CACHE_TTL_MS,
      });
      return tools;
    }),
  );

  const allTools: McpToolSpec[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allTools.push(...r.value);
  }
  return allTools;
};

/**
 * Forward a proxied tool call to the correct upstream server.
 *
 * @param internalName - Full internal tool name: `upstream.<namespace>.<tool>`
 * @param args         - Tool arguments passed through unchanged
 */
export const callProxiedTool = async (
  internalName: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> => {
  // Parse: upstream.<namespace>.<rest>
  if (!internalName.startsWith(UPSTREAM_PREFIX)) {
    return { content: [{ type: 'text', text: `Not a proxied tool name: ${internalName}` }], isError: true };
  }

  const withoutPrefix = internalName.slice(UPSTREAM_PREFIX.length);
  const dotIdx = withoutPrefix.indexOf('.');
  if (dotIdx < 1) {
    return { content: [{ type: 'text', text: `Malformed upstream tool name: ${internalName}` }], isError: true };
  }

  const namespace = withoutPrefix.slice(0, dotIdx);

  // Restore the original upstream tool name. sanitizeToolName() replaces hyphens
  // and dots with underscores, which is irreversible in general. We must look up
  // the name that the upstream server originally advertised; otherwise tools like
  // "list-tables" would be called as "list_tables" → 404/method-not-found.
  const server = findUpstreamByNamespace(namespace);
  if (!server) {
    return {
      content: [{ type: 'text', text: `No upstream server registered for namespace "${namespace}"` }],
      isError: true,
    };
  }

  let originalName = originalUpstreamNames.get(internalName);
  if (!originalName && hasUpstreamToolFilters(server)) {
    const tools = await fetchServerTools(server);
    toolCache.set(server.id, {
      tools,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + MCP_UPSTREAM_TOOL_CACHE_TTL_MS,
    });
    originalName = originalUpstreamNames.get(internalName);
  }

  if (!originalName) {
    if (hasUpstreamToolFilters(server)) {
      return {
        content: [{ type: 'text', text: `Tool is not exposed by upstream filter: ${internalName}` }],
        isError: true,
      };
    }
    console.warn('[mcp-proxy] originalUpstreamNames miss for %s — using sanitized fallback', internalName);
    originalName = withoutPrefix.slice(dotIdx + 1);
  }

  if (!isUpstreamToolAllowed(server, originalName)) {
    return {
      content: [{ type: 'text', text: `Tool is not exposed by upstream filter: ${internalName}` }],
      isError: true,
    };
  }

  try {
    // ── Streamable HTTP protocol ──
    if (server.protocol === 'streamable') {
      const body = await streamableJsonRpc(server, 'tools/call', { name: originalName, arguments: args }) as {
        result?: { content?: unknown[]; isError?: boolean };
        error?: { message?: string };
      };

      if (body.error) {
        return {
          content: [{ type: 'text', text: `Upstream error: ${body.error.message ?? JSON.stringify(body.error)}` }],
          isError: true,
        };
      }
      const result = body.result ?? {};
      const content = Array.isArray(result.content)
        ? (result.content as Array<{ type?: string; text?: string }>).map((c) => ({
            type: 'text' as const,
            text: String(c?.text ?? JSON.stringify(c)),
          }))
        : [{ type: 'text' as const, text: JSON.stringify(result) }];
      return { content, isError: result.isError === true };
    }

    // ── Simple protocol ──
    const res = await fetchWithTimeout(`${server.url}/mcp/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...makeAuthHeaders(server.token),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: originalName, arguments: args },
      }),
    }, FETCH_TIMEOUT_MS);

    if (!res.ok) {
      return {
        content: [{ type: 'text', text: `Upstream server "${namespace}" returned HTTP ${res.status}` }],
        isError: true,
      };
    }

    const body = await res.json() as {
      result?: { content?: unknown[]; isError?: boolean };
      error?: { message?: string };
    };

    if (body.error) {
      return {
        content: [{ type: 'text', text: `Upstream error: ${body.error.message ?? JSON.stringify(body.error)}` }],
        isError: true,
      };
    }

    const result = body.result ?? {};
    const content = Array.isArray(result.content)
      ? (result.content as Array<{ type?: string; text?: string }>).map((c) => ({
          type: 'text' as const,
          text: String(c?.text ?? JSON.stringify(c)),
        }))
      : [{ type: 'text' as const, text: JSON.stringify(result) }];

    return { content, isError: result.isError === true };
  } catch (err) {
    const reason = getErrorMessage(err);
    return {
      content: [{ type: 'text', text: `Upstream call failed: ${reason}` }],
      isError: true,
    };
  }
};


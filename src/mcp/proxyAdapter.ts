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
import { listUpstreams, findUpstreamByNamespace } from './proxyRegistry';
import type { McpToolSpec, McpToolCallResult } from './types';

// ──── Constants ────────────────────────────────────────────────────────────────

const UPSTREAM_PREFIX = 'upstream.';
const FETCH_TIMEOUT_MS = 8_000;

// ──── Tool name helpers ────────────────────────────────────────────────────────

/**
 * Sanitize an upstream tool name for use in the internal catalog.
 * Dots and hyphens → underscores (reversible for purposes of routing).
 */
const sanitizeToolName = (rawName: string): string => rawName.replace(/[.\-]/g, '_');

/** Build the internal tool name: `upstream.<namespace>.<sanitizedName>` */
const buildInternalName = (namespace: string, rawName: string): string =>
  `${UPSTREAM_PREFIX}${namespace}.${sanitizeToolName(rawName)}`;

// ──── Per-server tool cache ────────────────────────────────────────────────────

type CacheEntry = {
  tools: McpToolSpec[];
  expiresAt: number;
};

const toolCache = new Map<string, CacheEntry>();

const isCacheValid = (entry: CacheEntry): boolean => Date.now() < entry.expiresAt;

/** Invalidate the cached tool list for a specific server (by server id). */
export const invalidateServerCache = (serverId: string): void => {
  toolCache.delete(serverId);
};

/** Invalidate all cached tool lists. */
export const invalidateAllServerCaches = (): void => {
  toolCache.clear();
};

// ──── Upstream HTTP helpers ────────────────────────────────────────────────────

type UpstreamServerCfg = {
  id: string;
  url: string;
  namespace: string;
  token?: string;
};

const makeAuthHeaders = (token?: string): Record<string, string> => {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
};

/**
 * Fetch the tool catalog from an upstream MCP server.
 * Tries JSON-RPC /mcp/rpc first (standard MCP); falls back to REST /tools/list.
 * Returns empty array on any failure (non-blocking).
 */
const fetchServerTools = async (server: UpstreamServerCfg): Promise<McpToolSpec[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Primary: JSON-RPC tools/list over /mcp/rpc
    const rpcRes = await fetch(`${server.url}/mcp/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...makeAuthHeaders(server.token),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: controller.signal,
    });

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json() as { result?: { tools?: unknown[] }; tools?: unknown[] };
      const rawTools = rpcData?.result?.tools ?? (rpcData as { tools?: unknown[] })?.tools ?? [];
      if (Array.isArray(rawTools)) {
        return parseToolSpecs(rawTools, server.namespace);
      }
    }

    // Fallback: REST /tools/list
    const restRes = await fetch(`${server.url}/tools/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...makeAuthHeaders(server.token) },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    if (restRes.ok) {
      const restData = await restRes.json() as { tools?: unknown[] };
      const rawTools = restData?.tools ?? [];
      if (Array.isArray(rawTools)) {
        return parseToolSpecs(rawTools, server.namespace);
      }
    }

    console.error('[mcp-proxy] upstream %s: tools/list returned non-ok status', server.id);
    return [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[mcp-proxy] upstream %s: failed to fetch tools — %s', server.id, reason);
    return [];
  } finally {
    clearTimeout(timer);
  }
};

const parseToolSpecs = (rawTools: unknown[], namespace: string): McpToolSpec[] => {
  const result: McpToolSpec[] = [];
  for (const raw of rawTools) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const t = raw as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name) continue;
    const description = typeof t.description === 'string' ? t.description : `Upstream tool: ${name}`;
    const inputSchema = (t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema))
      ? (t.inputSchema as McpToolSpec['inputSchema'])
      : { type: 'object' as const, properties: {} };
    result.push({
      name: buildInternalName(namespace, name),
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
      toolCache.set(server.id, { tools, expiresAt: Date.now() + MCP_UPSTREAM_TOOL_CACHE_TTL_MS });
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
  const sanitizedToolName = withoutPrefix.slice(dotIdx + 1);

  const server = findUpstreamByNamespace(namespace);
  if (!server) {
    return {
      content: [{ type: 'text', text: `No upstream server registered for namespace "${namespace}"` }],
      isError: true,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${server.url}/mcp/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...makeAuthHeaders(server.token),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: sanitizedToolName, arguments: args },
      }),
      signal: controller.signal,
    });

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
    const reason = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Upstream call failed: ${reason}` }],
      isError: true,
    };
  } finally {
    clearTimeout(timer);
  }
};


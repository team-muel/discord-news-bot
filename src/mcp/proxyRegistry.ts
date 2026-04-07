/**
 * MCP Proxy Registry
 *
 * Runtime registry for upstream HTTP MCP servers that the unified server
 * proxies on behalf of callers. Tools from upstream servers are exposed as
 * `upstream.<namespace>.<toolName>` in the unified tool catalog.
 *
 * Bootstrap from environment:
 *   MCP_UPSTREAM_SERVERS=[{"id":"supabase","url":"https://mcp.supabase.com/mcp","namespace":"supabase","token":"..."}]
 */

/* eslint-disable no-console */

import { MCP_UPSTREAM_SERVERS_RAW } from '../config';
import { getErrorMessage } from '../utils/errorMessage';

// ──── Types ────────────────────────────────────────────────────────────────────

export type UpstreamMcpServerConfig = {
  /** Unique identifier for the server (used as registry key). */
  id: string;
  /** Base HTTP URL of the upstream MCP server (no trailing slash). */
  url: string;
  /**
   * Short namespace prefix used in tool names: `upstream.<namespace>.<tool>`.
   * Must be lowercase alphanumeric + underscore only.
   */
  namespace: string;
  /** Optional Bearer token for authenticating to the upstream server. */
  token?: string;
  /** When false the server is ignored during tool listing and routing. Default true. */
  enabled?: boolean;
};

// ──── Internal state ───────────────────────────────────────────────────────────

const registry = new Map<string, UpstreamMcpServerConfig>();
/** namespace → server id (fast reverse lookup for routing) */
const nsIndex = new Map<string, string>();

// ──── Validation ───────────────────────────────────────────────────────────────

const NAMESPACE_RE = /^[a-z0-9_]+$/;

const assertValidConfig = (cfg: UpstreamMcpServerConfig): void => {
  if (!cfg.id || typeof cfg.id !== 'string') throw new Error('UpstreamMcpServerConfig.id is required');
  if (!cfg.url || typeof cfg.url !== 'string') throw new Error('UpstreamMcpServerConfig.url is required');
  if (!cfg.namespace || typeof cfg.namespace !== 'string') throw new Error('UpstreamMcpServerConfig.namespace is required');
  if (!NAMESPACE_RE.test(cfg.namespace)) {
    throw new Error(`UpstreamMcpServerConfig.namespace must match [a-z0-9_]: "${cfg.namespace}"`);
  }
};

// ──── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an upstream MCP server.
 * Re-registering the same id updates the config and refreshes the namespace index.
 */
export const registerUpstream = (config: UpstreamMcpServerConfig): void => {
  assertValidConfig(config);

  const normalised: UpstreamMcpServerConfig = {
    ...config,
    url: config.url.replace(/\/+$/, ''),
    enabled: config.enabled ?? true,
  };

  // Clean stale namespace entry if the server was previously registered with a different namespace
  const existing = registry.get(normalised.id);
  if (existing && existing.namespace !== normalised.namespace) {
    nsIndex.delete(existing.namespace);
  }

  // Namespace must be unique (unless it maps to the same server id)
  const existingNsOwner = nsIndex.get(normalised.namespace);
  if (existingNsOwner && existingNsOwner !== normalised.id) {
    throw new Error(
      `Namespace "${normalised.namespace}" is already used by server "${existingNsOwner}". Choose a different namespace.`,
    );
  }

  registry.set(normalised.id, normalised);
  nsIndex.set(normalised.namespace, normalised.id);

  console.error('[mcp-proxy] registered upstream id=%s ns=%s url=%s', normalised.id, normalised.namespace, normalised.url);
};

/** Remove an upstream server from the registry. */
export const unregisterUpstream = (id: string): boolean => {
  const existing = registry.get(id);
  if (!existing) return false;
  nsIndex.delete(existing.namespace);
  registry.delete(id);
  console.error('[mcp-proxy] unregistered upstream id=%s', id);
  return true;
};

/** Return all *enabled* upstream server configs. */
export const listUpstreams = (): UpstreamMcpServerConfig[] =>
  [...registry.values()].filter((s) => s.enabled !== false);

/** Look up a server config by namespace. Returns undefined if not found or disabled. */
export const findUpstreamByNamespace = (namespace: string): UpstreamMcpServerConfig | undefined => {
  const id = nsIndex.get(namespace);
  if (!id) return undefined;
  const cfg = registry.get(id);
  if (!cfg || cfg.enabled === false) return undefined;
  return cfg;
};

/** Return all registered servers (including disabled) — for diagnostics only. */
export const getAllUpstreams = (): UpstreamMcpServerConfig[] => [...registry.values()];

/** Clear all registered upstreams (useful in tests). */
export const clearUpstreams = (): void => {
  registry.clear();
  nsIndex.clear();
};

// ──── Bootstrap from env ───────────────────────────────────────────────────────

/**
 * Parse `MCP_UPSTREAM_SERVERS` (JSON array string) and register all entries.
 * Malformed entries are skipped with a console warning.
 * Safe to call multiple times — duplicate ids are updated in place.
 */
export const loadUpstreamsFromConfig = (): void => {
  const raw = MCP_UPSTREAM_SERVERS_RAW.trim();
  if (!raw || raw === '[]') return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[mcp-proxy] MCP_UPSTREAM_SERVERS is not valid JSON — skipping upstream registration');
    return;
  }

  if (!Array.isArray(parsed)) {
    console.error('[mcp-proxy] MCP_UPSTREAM_SERVERS must be a JSON array — skipping');
    return;
  }

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      console.error('[mcp-proxy] skipping invalid upstream entry (not an object):', entry);
      continue;
    }
    try {
      registerUpstream(entry as UpstreamMcpServerConfig);
    } catch (err) {
      console.error('[mcp-proxy] skipping invalid upstream entry:', getErrorMessage(err));
    }
  }
};

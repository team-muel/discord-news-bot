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

export type UpstreamPlane = 'semantic' | 'operational' | 'execution' | 'control';
export type UpstreamAudience = 'shared' | 'operator' | 'hybrid';

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
  /**
   * MCP transport protocol:
   * - 'simple'     — POST /tools/list, POST /tools/call  (default, for custom servers)
   * - 'streamable' — MCP Streamable HTTP: initialize → session → JSON-RPC
   */
  protocol?: 'simple' | 'streamable';
  /** When false the server is ignored during tool listing and routing. Default true. */
  enabled?: boolean;
  /** Optional human-readable label used in diagnostics and operator tooling. */
  label?: string;
  /** Optional short description of the lane's purpose. */
  description?: string;
  /** Optional semantic classification for federated control-plane routing. */
  plane?: UpstreamPlane;
  /** Optional visibility boundary for the lane. */
  audience?: UpstreamAudience;
  /** Optional owning team, service, or operator label. */
  owner?: string;
  /** Optional source repository or service identifier. */
  sourceRepo?: string;
  /** Optional wildcard allowlist (`*` supported) applied to original upstream tool names. */
  toolAllowlist?: string[];
  /** Optional wildcard denylist (`*` supported) applied after allowlist checks. */
  toolDenylist?: string[];
};

// ──── Internal state ───────────────────────────────────────────────────────────

const registry = new Map<string, UpstreamMcpServerConfig>();
/** namespace → server id (fast reverse lookup for routing) */
const nsIndex = new Map<string, string>();

// ──── Validation ───────────────────────────────────────────────────────────────

const NAMESPACE_RE = /^[a-z0-9_]+$/;
const PLANE_VALUES = new Set<UpstreamPlane>(['semantic', 'operational', 'execution', 'control']);
const AUDIENCE_VALUES = new Set<UpstreamAudience>(['shared', 'operator', 'hybrid']);

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeComparableUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return raw.replace(/\/+$/g, '');
  }
};

const stripTerminalSharedIngressPath = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    const nextPath = parsed.pathname.replace(/\/(mcp|obsidian)\/?$/i, '') || '/';
    parsed.pathname = nextPath;
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return value.replace(/\/(mcp|obsidian)\/?$/i, '').replace(/\/+$/g, '');
  }
};

const resolveImplicitSharedMcpToken = (url: string, explicitToken?: string): string | undefined => {
  const explicit = normalizeOptionalString(explicitToken);
  if (explicit) {
    return explicit;
  }

  const comparableTarget = normalizeComparableUrl(url);
  if (!comparableTarget) {
    return undefined;
  }

  const comparableSharedUrls = [process.env.MCP_SHARED_MCP_URL, process.env.OBSIDIAN_REMOTE_MCP_URL]
    .flatMap((candidate) => {
      const normalized = normalizeComparableUrl(candidate);
      const stripped = stripTerminalSharedIngressPath(normalized);
      return [normalized, stripped].filter((item): item is string => Boolean(item));
    });

  if (!comparableSharedUrls.includes(comparableTarget)) {
    return undefined;
  }

  return normalizeOptionalString(process.env.MCP_SHARED_MCP_TOKEN)
    ?? normalizeOptionalString(process.env.OBSIDIAN_REMOTE_MCP_TOKEN)
    ?? normalizeOptionalString(process.env.MCP_WORKER_AUTH_TOKEN);
};

const normalizeEnumValue = <T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim() as T;
  return allowed.has(normalized) ? normalized : undefined;
};

const normalizeToolPatterns = (patterns: string[] | undefined): string[] | undefined => {
  if (!patterns) return undefined;
  const normalized = patterns
    .map((pattern) => (typeof pattern === 'string' ? pattern.trim() : ''))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
};

const wildcardPatternToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
};

const matchesAnyPattern = (toolName: string, patterns: string[] | undefined): boolean => {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => wildcardPatternToRegExp(pattern).test(toolName));
};

export const hasUpstreamToolFilters = (cfg: UpstreamMcpServerConfig): boolean =>
  Boolean((cfg.toolAllowlist && cfg.toolAllowlist.length > 0) || (cfg.toolDenylist && cfg.toolDenylist.length > 0));

export const isUpstreamToolAllowed = (cfg: UpstreamMcpServerConfig, toolName: string): boolean => {
  const denied = matchesAnyPattern(toolName, cfg.toolDenylist);
  if (denied) return false;

  const allowlist = cfg.toolAllowlist;
  if (!allowlist || allowlist.length === 0) return true;
  return matchesAnyPattern(toolName, allowlist);
};

const assertValidConfig = (cfg: UpstreamMcpServerConfig): void => {
  if (!cfg.id || typeof cfg.id !== 'string') throw new Error('UpstreamMcpServerConfig.id is required');
  if (!cfg.url || typeof cfg.url !== 'string') throw new Error('UpstreamMcpServerConfig.url is required');
  if (!cfg.namespace || typeof cfg.namespace !== 'string') throw new Error('UpstreamMcpServerConfig.namespace is required');
  if (cfg.label !== undefined && typeof cfg.label !== 'string') throw new Error('UpstreamMcpServerConfig.label must be a string');
  if (cfg.description !== undefined && typeof cfg.description !== 'string') throw new Error('UpstreamMcpServerConfig.description must be a string');
  if (cfg.owner !== undefined && typeof cfg.owner !== 'string') throw new Error('UpstreamMcpServerConfig.owner must be a string');
  if (cfg.sourceRepo !== undefined && typeof cfg.sourceRepo !== 'string') throw new Error('UpstreamMcpServerConfig.sourceRepo must be a string');
  if (cfg.plane !== undefined && !PLANE_VALUES.has(cfg.plane)) {
    throw new Error(`UpstreamMcpServerConfig.plane must be one of: ${[...PLANE_VALUES].join(', ')}`);
  }
  if (cfg.audience !== undefined && !AUDIENCE_VALUES.has(cfg.audience)) {
    throw new Error(`UpstreamMcpServerConfig.audience must be one of: ${[...AUDIENCE_VALUES].join(', ')}`);
  }
  if (cfg.toolAllowlist && (!Array.isArray(cfg.toolAllowlist) || cfg.toolAllowlist.some((pattern) => typeof pattern !== 'string'))) {
    throw new Error('UpstreamMcpServerConfig.toolAllowlist must be an array of strings');
  }
  if (cfg.toolDenylist && (!Array.isArray(cfg.toolDenylist) || cfg.toolDenylist.some((pattern) => typeof pattern !== 'string'))) {
    throw new Error('UpstreamMcpServerConfig.toolDenylist must be an array of strings');
  }
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
    token: resolveImplicitSharedMcpToken(config.url, config.token),
    enabled: config.enabled ?? true,
    label: normalizeOptionalString(config.label),
    description: normalizeOptionalString(config.description),
    plane: normalizeEnumValue(config.plane, PLANE_VALUES),
    audience: normalizeEnumValue(config.audience, AUDIENCE_VALUES),
    owner: normalizeOptionalString(config.owner),
    sourceRepo: normalizeOptionalString(config.sourceRepo),
    toolAllowlist: normalizeToolPatterns(config.toolAllowlist),
    toolDenylist: normalizeToolPatterns(config.toolDenylist),
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

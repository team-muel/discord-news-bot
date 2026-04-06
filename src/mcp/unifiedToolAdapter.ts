/**
 * Unified MCP Tool Adapter
 *
 * Combines all tool catalogs (general + indexing + external adapters + upstream
 * proxied servers) into a single adapter.
 *
 * Tool namespace summary:
 *   - general tools:      stock.*, investment.*, action.*, diag.*  (via toolAdapter.ts)
 *   - muelIndexing tools:  code.index.*, security.*
 *   - obsidian tools:      obsidian.*
 *   - external adapters:   ext.<adapterId>.<capability>
 *   - upstream proxy:      upstream.<namespace>.<tool>
 */

import { listMcpTools, callMcpTool } from './toolAdapter';
import { listIndexingMcpTools, callIndexingMcpTool } from './indexingToolAdapter';
import { listObsidianMcpTools, callObsidianMcpTool, OBSIDIAN_TOOL_NAMES } from './obsidianToolAdapter';
import { listProxiedTools, callProxiedTool, invalidateAllServerCaches } from './proxyAdapter';
import { loadUpstreamsFromConfig } from './proxyRegistry';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

// Bootstrap upstream servers from environment at module init (idempotent)
loadUpstreamsFromConfig();

// Lazy-loaded — avoids importing all 7 CLI adapters at module init
let _externalRegistry: typeof import('../services/tools/externalAdapterRegistry') | null = null;
const getExternalRegistry = async () => {
  if (!_externalRegistry) {
    _externalRegistry = await import('../services/tools/externalAdapterRegistry');
  }
  return _externalRegistry;
};

// Cached at first access — avoids repeated listMcpTools() calls
let _generalToolNames: Set<string> | null = null;
const getGeneralToolNames = (): Set<string> => {
  if (!_generalToolNames) {
    _generalToolNames = new Set(listMcpTools().map((t) => t.name));
  }
  return _generalToolNames;
};

/** Prefix for external adapter tools exposed as MCP tools. */
const EXT_PREFIX = 'ext.';
/** Prefix for upstream proxied MCP server tools. */
const UPSTREAM_PREFIX = 'upstream.';

/**
 * Build MCP tool specs from registered external adapters.
 * Each adapter capability becomes `ext.<adapterId>.<capability>`.
 */
let _externalToolsCache: McpToolSpec[] | null = null;

const buildExternalMcpTools = async (): Promise<McpToolSpec[]> => {
  if (_externalToolsCache) return _externalToolsCache;
  const { listExternalAdapters } = await getExternalRegistry();
  const tools: McpToolSpec[] = [];
  for (const adapter of listExternalAdapters()) {
    const caps = adapter.liteCapabilities ?? adapter.capabilities;
    for (const cap of caps) {
      tools.push({
        name: `${EXT_PREFIX}${adapter.id}.${cap}`,
        description: `External adapter: ${adapter.id} — ${cap}`,
        inputSchema: {
          type: 'object',
          // Arguments may be passed either flat (top-level properties) or nested
          // under an "args" key. callAnyMcpTool prefers request.arguments.args
          // and falls back to request.arguments directly, so both forms work.
          properties: {
            args: { type: 'object', description: 'Action arguments (nested). Alternatively pass arguments flat at the top level.' },
          },
          additionalProperties: true,
        },
      });
    }
  }
  _externalToolsCache = tools;
  return tools;
};

let _allToolsCache: McpToolSpec[] | null = null;

/**
 * Invalidate the unified tool cache so the next call to listAllMcpTools()
 * re-fetches from all adapters including upstream servers.
 * Call this after registering or unregistering upstream servers at runtime.
 */
export const invalidateToolCache = (): void => {
  _allToolsCache = null;
  invalidateAllServerCaches();
};

export const listAllMcpTools = async (): Promise<McpToolSpec[]> => {
  if (_allToolsCache) return _allToolsCache;
  _allToolsCache = [
    ...listMcpTools(),
    ...listIndexingMcpTools(),
    ...listObsidianMcpTools(),
    ...(await buildExternalMcpTools()),
    ...(await listProxiedTools()),
  ];
  return _allToolsCache;
};

export const callAnyMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const name = String(request.name || '').trim();
  if (!name) {
    return { content: [{ type: 'text', text: 'tool name is required' }], isError: true };
  }

  // Route ext.* calls to the external adapter registry
  if (name.startsWith(EXT_PREFIX)) {
    const rest = name.slice(EXT_PREFIX.length);
    const dotIdx = rest.indexOf('.');
    if (dotIdx < 1) {
      return { content: [{ type: 'text', text: `invalid external tool name: ${name}` }], isError: true };
    }
    const adapterId = rest.slice(0, dotIdx);
    const action = rest.slice(dotIdx + 1);
    const args = (request.arguments?.args as Record<string, unknown>) ?? request.arguments ?? {};
    const { executeExternalAction } = await getExternalRegistry();
    const result = await executeExternalAction(adapterId, action, args);
    return {
      content: [{ type: 'text', text: result.ok ? result.output.join('\n') || result.summary : `ERROR: ${result.error ?? result.summary}` }],
      isError: !result.ok,
    };
  }

  // Route upstream.* calls to the proxy adapter
  if (name.startsWith(UPSTREAM_PREFIX)) {
    return callProxiedTool(name, request.arguments ?? {});
  }

  // Route to the correct adapter
  if (getGeneralToolNames().has(name)) {
    return callMcpTool(request);
  }

  // Route obsidian.* tools
  if (OBSIDIAN_TOOL_NAMES.has(name)) {
    return callObsidianMcpTool(request);
  }

  // Default to indexing adapter (covers code.index.* and security.* tools)
  return callIndexingMcpTool(request);
};

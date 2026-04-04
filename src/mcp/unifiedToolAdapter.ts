/**
 * Unified MCP Tool Adapter
 *
 * Combines all tool catalogs (general + indexing + external adapters) into a
 * single adapter.  External adapters (OpenClaw, NemoClaw, OpenJarvis, etc.)
 * are surfaced with an `ext.<adapterId>.<capability>` naming convention so
 * consumers can call them through the standard MCP interface.
 */

import { listMcpTools, callMcpTool } from './toolAdapter';
import { listIndexingMcpTools, callIndexingMcpTool } from './indexingToolAdapter';
import { listObsidianMcpTools, callObsidianMcpTool, OBSIDIAN_TOOL_NAMES } from './obsidianToolAdapter';
import { listExternalAdapters, executeExternalAction } from '../services/tools/externalAdapterRegistry';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

const GENERAL_TOOL_NAMES = new Set(listMcpTools().map((t) => t.name));

/** Prefix for external adapter tools exposed as MCP tools. */
const EXT_PREFIX = 'ext.';

/**
 * Build MCP tool specs from registered external adapters.
 * Each adapter capability becomes `ext.<adapterId>.<capability>`.
 */
const buildExternalMcpTools = (): McpToolSpec[] => {
  const tools: McpToolSpec[] = [];
  for (const adapter of listExternalAdapters()) {
    const caps = adapter.liteCapabilities ?? adapter.capabilities;
    for (const cap of caps) {
      tools.push({
        name: `${EXT_PREFIX}${adapter.id}.${cap}`,
        description: `External adapter: ${adapter.id} — ${cap}`,
        inputSchema: {
          type: 'object',
          properties: {
            args: { type: 'object', description: 'Arguments for the external adapter action' },
          },
          additionalProperties: true,
        },
      });
    }
  }
  return tools;
};

export const listAllMcpTools = (): McpToolSpec[] => {
  return [
    ...listMcpTools(),
    ...listIndexingMcpTools(),
    ...listObsidianMcpTools(),
    ...buildExternalMcpTools(),
  ];
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
    const result = await executeExternalAction(adapterId, action, args);
    return {
      content: [{ type: 'text', text: result.ok ? result.output.join('\n') || result.summary : `ERROR: ${result.error ?? result.summary}` }],
      isError: !result.ok,
    };
  }

  // Route to the correct adapter
  if (GENERAL_TOOL_NAMES.has(name)) {
    return callMcpTool(request);
  }

  // Route obsidian.* tools
  if (OBSIDIAN_TOOL_NAMES.has(name)) {
    return callObsidianMcpTool(request);
  }

  // Default to indexing adapter (covers code.index.* and security.* tools)
  return callIndexingMcpTool(request);
};

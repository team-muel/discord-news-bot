/**
 * Obsidian External Tool Adapter — exposes Obsidian vault MCP tools as an ExternalToolAdapter.
 *
 * Wraps the obsidianToolAdapter functions (search, read, write, RAG, graph,
 * sync status, cache stats, quality audit) for unified adapter discovery.
 *
 * Capabilities:
 *   - obsidian.search: graph-first keyword search
 *   - obsidian.rag: intent-based RAG query
 *   - obsidian.read: read a vault file
 *   - obsidian.graph: graph metadata (backlinks, tags)
 *   - obsidian.write: write note through sanitization gate
 *   - obsidian.sync.status: sync loop status
 *   - obsidian.cache.stats: cache statistics
 *   - obsidian.quality.audit: graph quality snapshot
 *   - obsidian.adapter.status: adapter routing status
 *
 * Environment:
 *   MCP_OBSIDIAN_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   MCP_OBSIDIAN_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv } from '../../../utils/env';
import { callObsidianMcpTool, OBSIDIAN_TOOL_NAMES } from '../../../mcp/obsidianToolAdapter';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.MCP_OBSIDIAN_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.MCP_OBSIDIAN_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const ALL_CAPABILITIES = [...OBSIDIAN_TOOL_NAMES];
const LITE_CAPABILITIES = ['obsidian.search', 'obsidian.rag', 'obsidian.sync.status', 'obsidian.adapter.status'];

const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult => ({
  ok,
  adapterId: 'obsidian' as ExternalAdapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

const callTool = async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();

  if (!OBSIDIAN_TOOL_NAMES.has(action)) {
    return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
  }

  try {
    const result = await callObsidianMcpTool({ name: action, arguments: args });
    const texts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text);
    const ok = !result.isError;
    return makeResult(ok, action, ok ? `${action} completed` : `${action} failed`, texts, Date.now() - start, ok ? undefined : texts[0]);
  } catch (err) {
    return makeResult(false, action, `${action} error`, [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

export const obsidianExternalAdapter: ExternalToolAdapter = {
  id: 'obsidian' as ExternalAdapterId,
  capabilities: ALL_CAPABILITIES,
  liteCapabilities: LITE_CAPABILITIES,

  isAvailable: async () => isNotDisabled(),

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    return callTool(action, args);
  },
};

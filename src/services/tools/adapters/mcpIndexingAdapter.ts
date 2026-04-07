/**
 * MCP Indexing Tool Adapter — exposes code index MCP tools as an ExternalToolAdapter.
 *
 * Wraps the existing indexingToolAdapter functions (symbol search, file outline,
 * scope read, context bundle, security candidates) for unified adapter discovery.
 *
 * Capabilities:
 *   - index.search: search indexed symbols
 *   - index.outline: get file outline
 *   - index.context: build context bundle for a goal
 *   - index.scope: read symbol/line scope
 *   - security.candidates: list security candidates
 *
 * Environment:
 *   MCP_INDEXING_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   MCP_INDEXING_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv } from '../../../utils/env';
import { callIndexingMcpTool } from '../../../mcp/indexingToolAdapter';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.MCP_INDEXING_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.MCP_INDEXING_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult => ({
  ok,
  adapterId: 'mcp-indexing' as ExternalAdapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

const ACTION_TO_TOOL: Record<string, string> = {
  'index.search': 'code.index.symbol_search',
  'index.define': 'code.index.symbol_define',
  'index.references': 'code.index.symbol_references',
  'index.outline': 'code.index.file_outline',
  'index.scope': 'code.index.scope_read',
  'index.context': 'code.index.context_bundle',
  'security.candidates': 'security.candidates_list',
};

const callTool = async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const toolName = ACTION_TO_TOOL[action];
  if (!toolName) {
    return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
  }

  try {
    const result = await callIndexingMcpTool({ name: toolName, arguments: args });
    const texts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text);
    const ok = !result.isError;
    return makeResult(ok, action, ok ? `${action} completed` : `${action} failed`, texts, Date.now() - start, ok ? undefined : texts[0]);
  } catch (err) {
    return makeResult(false, action, `${action} error`, [], Date.now() - start, getErrorMessage(err));
  }
};

export const mcpIndexingAdapter: ExternalToolAdapter = {
  id: 'mcp-indexing' as ExternalAdapterId,
  capabilities: Object.keys(ACTION_TO_TOOL),
  liteCapabilities: ['index.search', 'index.outline'],

  isAvailable: async () => isNotDisabled(),

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    return callTool(action, args);
  },
};

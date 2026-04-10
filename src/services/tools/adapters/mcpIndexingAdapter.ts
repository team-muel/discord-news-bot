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

import { parseBooleanEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../../utils/env';
import { callIndexingMcpTool } from '../../../mcp/indexingToolAdapter';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { makeAdapterResult, isAdapterEnabled } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';
import { fetchWithTimeout } from '../../../utils/network';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.MCP_INDEXING_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.MCP_INDEXING_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => isAdapterEnabled(EXPLICITLY_DISABLED, LEGACY_ENABLED_RAW);
const REMOTE_BASE_URL = parseUrlEnv(
  process.env.MCP_INDEXING_REMOTE_URL
    ?? process.env.MCP_SHARED_MCP_URL
    ?? process.env.OBSIDIAN_REMOTE_MCP_URL,
  '',
);
const REMOTE_AUTH_TOKEN = parseStringEnv(
  process.env.MCP_INDEXING_REMOTE_TOKEN
    ?? process.env.MCP_SHARED_MCP_TOKEN
    ?? process.env.OBSIDIAN_REMOTE_MCP_TOKEN
    ?? process.env.MCP_WORKER_AUTH_TOKEN,
  '',
);
const REMOTE_TIMEOUT_MS = parseMinIntEnv(process.env.MCP_INDEXING_REMOTE_TIMEOUT_MS, 10_000, 1_000);
const DEFAULT_REPO_ID = 'current';

const ADAPTER_ID = 'mcp-indexing' as ExternalAdapterId;
const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult =>
  makeAdapterResult(ADAPTER_ID, ok, action, summary, output, durationMs, error);

type McpToolResult = {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
};

const ACTION_TO_TOOL: Record<string, string> = {
  'index.search': 'code.index.symbol_search',
  'index.define': 'code.index.symbol_define',
  'index.references': 'code.index.symbol_references',
  'index.outline': 'code.index.file_outline',
  'index.scope': 'code.index.scope_read',
  'index.context': 'code.index.context_bundle',
  'security.candidates': 'security.candidates_list',
};

const withRepoDefaults = (args: Record<string, unknown>): Record<string, unknown> => {
  const repoId = typeof args.repoId === 'string' && args.repoId.trim()
    ? args.repoId.trim()
    : DEFAULT_REPO_ID;
  return {
    ...args,
    repoId,
  };
};

const extractTexts = (result: McpToolResult): string[] =>
  (Array.isArray(result.content) ? result.content : [])
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text);

const callRemoteTool = async (toolName: string, args: Record<string, unknown>): Promise<McpToolResult> => {
  if (!REMOTE_BASE_URL) {
    throw new Error('REMOTE_INDEXING_URL_NOT_CONFIGURED');
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (REMOTE_AUTH_TOKEN) {
    headers.authorization = `Bearer ${REMOTE_AUTH_TOKEN}`;
  }

  const response = await fetchWithTimeout(`${REMOTE_BASE_URL}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: toolName,
      arguments: args,
    }),
  }, REMOTE_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as McpToolResult;
};

const callTool = async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const toolName = ACTION_TO_TOOL[action];
  if (!toolName) {
    return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
  }

  const normalizedArgs = withRepoDefaults(args);
  let remoteError: string | undefined;

  if (REMOTE_BASE_URL) {
    try {
      const remoteResult = await callRemoteTool(toolName, normalizedArgs);
      const texts = extractTexts(remoteResult);
      if (!remoteResult.isError) {
        return makeResult(true, action, `${action} completed (shared MCP)`, texts, Date.now() - start);
      }
      remoteError = texts[0] || 'REMOTE_TOOL_ERROR';
    } catch (err) {
      remoteError = getErrorMessage(err);
    }
  }

  try {
    const result = await callIndexingMcpTool({ name: toolName, arguments: normalizedArgs });
    const texts = extractTexts(result);
    const ok = !result.isError;
    const summary = ok
      ? remoteError ? `${action} completed (local fallback)` : `${action} completed`
      : `${action} failed`;
    const error = ok
      ? undefined
      : remoteError
        ? `REMOTE: ${remoteError}; LOCAL: ${texts[0] || 'LOCAL_TOOL_ERROR'}`
        : texts[0];
    return makeResult(ok, action, summary, texts, Date.now() - start, error);
  } catch (err) {
    const localError = getErrorMessage(err);
    const combinedError = remoteError
      ? `REMOTE: ${remoteError}; LOCAL: ${localError}`
      : localError;
    return makeResult(false, action, `${action} error`, [], Date.now() - start, combinedError);
  }
};

export const mcpIndexingAdapter: ExternalToolAdapter = {
  id: 'mcp-indexing' as ExternalAdapterId,
  description: 'Code index server — shared-MCP-first symbol search, definition lookup, reference tracing, file outlines, and context bundling across registered repositories.',
  capabilities: Object.keys(ACTION_TO_TOOL),
  liteCapabilities: ['index.search', 'index.outline'],

  isAvailable: async () => isNotDisabled(),

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    return callTool(action, args);
  },
};

import { parseBooleanEnv, parseIntegerEnv } from '../../../utils/env';
import { callMcpTool, parseMcpTextBlocks as parseMcpTextBlocksShared, type McpCallPayload } from '../../mcpWorkerClient';

export type McpCallResponse = McpCallPayload;

const ACTION_MCP_DELEGATION_ENABLED = parseBooleanEnv(process.env.ACTION_MCP_DELEGATION_ENABLED, true);
const ACTION_MCP_STRICT_ROUTING = parseBooleanEnv(process.env.ACTION_MCP_STRICT_ROUTING, false);
const ACTION_MCP_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_MCP_TIMEOUT_MS, 8000));

const toBaseUrl = (raw: string | undefined): string => String(raw || '').trim().replace(/\/+$/, '');

const MCP_WORKER_ENV_BY_KIND: Record<'youtube' | 'news' | 'community' | 'web' | 'opencode', string | undefined> = {
  youtube: process.env.MCP_YOUTUBE_WORKER_URL,
  news: process.env.MCP_NEWS_WORKER_URL,
  community: process.env.MCP_COMMUNITY_WORKER_URL,
  web: process.env.MCP_WEB_WORKER_URL,
  opencode: process.env.MCP_OPENCODE_WORKER_URL,
};

export const getMcpWorkerUrl = (kind: 'youtube' | 'news' | 'community' | 'web' | 'opencode'): string => {
  return toBaseUrl(MCP_WORKER_ENV_BY_KIND[kind]);
};

export const isMcpDelegationEnabled = (): boolean => ACTION_MCP_DELEGATION_ENABLED;
export const isMcpStrictRouting = (): boolean => ACTION_MCP_STRICT_ROUTING;

export const callMcpWorkerTool = async (params: {
  workerUrl: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<McpCallResponse> => {
  const base = toBaseUrl(params.workerUrl);
  if (!ACTION_MCP_DELEGATION_ENABLED || !base) {
    throw new Error('MCP_WORKER_NOT_CONFIGURED');
  }
  return callMcpTool({
    workerUrl: base,
    toolName: params.toolName,
    args: params.args,
    timeoutMs: ACTION_MCP_TIMEOUT_MS,
  });
};

export const parseMcpTextBlocks = (payload: McpCallResponse): string[] => {
  return parseMcpTextBlocksShared(payload);
};

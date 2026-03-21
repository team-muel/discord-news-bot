import { parseBooleanEnv, parseIntegerEnv } from '../../../utils/env';
import { callMcpTool, parseMcpTextBlocks as parseMcpTextBlocksShared, type McpCallPayload } from '../../mcpWorkerClient';

export type McpCallResponse = McpCallPayload;
export type McpWorkerKind = 'youtube' | 'news' | 'community' | 'web' | 'opencode' | 'opendev' | 'nemoclaw' | 'openjarvis' | 'local-orchestrator' | 'implement' | 'architect' | 'review' | 'operate' | 'coordinate';

const ACTION_MCP_DELEGATION_ENABLED = parseBooleanEnv(process.env.ACTION_MCP_DELEGATION_ENABLED, true);
const ACTION_MCP_STRICT_ROUTING = parseBooleanEnv(process.env.ACTION_MCP_STRICT_ROUTING, false);
const ACTION_MCP_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_MCP_TIMEOUT_MS, 8000));

const toBaseUrl = (raw: string | undefined): string => String(raw || '').trim().replace(/\/+$/, '');

const MCP_WORKER_ENV_BY_KIND: Record<McpWorkerKind, string | undefined> = {
  youtube: process.env.MCP_YOUTUBE_WORKER_URL,
  news: process.env.MCP_NEWS_WORKER_URL,
  community: process.env.MCP_COMMUNITY_WORKER_URL,
  web: process.env.MCP_WEB_WORKER_URL,
  opencode: process.env.MCP_OPENCODE_WORKER_URL,
  opendev: process.env.MCP_OPENDEV_WORKER_URL || process.env.MCP_ARCHITECT_WORKER_URL,
  nemoclaw: process.env.MCP_NEMOCLAW_WORKER_URL || process.env.MCP_REVIEW_WORKER_URL,
  openjarvis: process.env.MCP_OPENJARVIS_WORKER_URL || process.env.MCP_OPERATE_WORKER_URL,
  'local-orchestrator': process.env.MCP_LOCAL_ORCHESTRATOR_WORKER_URL || process.env.MCP_COORDINATE_WORKER_URL,
  implement: process.env.MCP_IMPLEMENT_WORKER_URL || process.env.MCP_OPENCODE_WORKER_URL,
  architect: process.env.MCP_ARCHITECT_WORKER_URL || process.env.MCP_OPENDEV_WORKER_URL,
  review: process.env.MCP_REVIEW_WORKER_URL || process.env.MCP_NEMOCLAW_WORKER_URL,
  operate: process.env.MCP_OPERATE_WORKER_URL || process.env.MCP_OPENJARVIS_WORKER_URL,
  coordinate: process.env.MCP_COORDINATE_WORKER_URL || process.env.MCP_LOCAL_ORCHESTRATOR_WORKER_URL,
};

export const getMcpWorkerUrl = (kind: McpWorkerKind): string => {
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

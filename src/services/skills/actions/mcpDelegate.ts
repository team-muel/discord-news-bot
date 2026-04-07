import { parseBooleanEnv, parseMinIntEnv } from '../../../utils/env';
import { callMcpTool, parseMcpTextBlocks as parseMcpTextBlocksShared, type McpCallPayload } from '../../mcpWorkerClient';

export type McpCallResponse = McpCallPayload;

/** Canonical worker kinds. Legacy names resolve to their neutral equivalents via LEGACY_KIND_ALIAS. */
export type McpWorkerKind = 'youtube' | 'news' | 'community' | 'web' | 'opencode' | 'opendev' | 'nemoclaw' | 'openjarvis' | 'local-orchestrator' | 'implement' | 'architect' | 'review' | 'operate' | 'coordinate';

const ACTION_MCP_DELEGATION_ENABLED = parseBooleanEnv(process.env.ACTION_MCP_DELEGATION_ENABLED, true);
const ACTION_MCP_STRICT_ROUTING = parseBooleanEnv(process.env.ACTION_MCP_STRICT_ROUTING, false);
const ACTION_MCP_TIMEOUT_MS = parseMinIntEnv(process.env.ACTION_MCP_TIMEOUT_MS, 8000, 1000);

const toBaseUrl = (raw: string | undefined): string => String(raw || '').trim().replace(/\/+$/, '');

// ──── Worker URL resolution ─────────────────────────────────────────────────
// Neutral names are the source of truth. Legacy names resolve through them.
const NEUTRAL_WORKER_ENV: Record<string, string | undefined> = {
  youtube: process.env.MCP_YOUTUBE_WORKER_URL,
  news: process.env.MCP_NEWS_WORKER_URL,
  community: process.env.MCP_COMMUNITY_WORKER_URL,
  web: process.env.MCP_WEB_WORKER_URL,
  implement: process.env.MCP_IMPLEMENT_WORKER_URL,
  architect: process.env.MCP_ARCHITECT_WORKER_URL,
  review: process.env.MCP_REVIEW_WORKER_URL,
  operate: process.env.MCP_OPERATE_WORKER_URL,
  coordinate: process.env.MCP_COORDINATE_WORKER_URL,
};

/** Legacy kind → neutral kind mapping. Legacy env vars serve as fallbacks only. */
const LEGACY_KIND_ALIAS: Record<string, { neutral: string; legacyEnv: string }> = {
  opencode: { neutral: 'implement', legacyEnv: 'MCP_OPENCODE_WORKER_URL' },
  opendev: { neutral: 'architect', legacyEnv: 'MCP_OPENDEV_WORKER_URL' },
  nemoclaw: { neutral: 'review', legacyEnv: 'MCP_NEMOCLAW_WORKER_URL' },
  openjarvis: { neutral: 'operate', legacyEnv: 'MCP_OPENJARVIS_WORKER_URL' },
  'local-orchestrator': { neutral: 'coordinate', legacyEnv: 'MCP_LOCAL_ORCHESTRATOR_WORKER_URL' },
};

const resolveWorkerUrl = (kind: McpWorkerKind): string | undefined => {
  // Direct neutral match
  if (kind in NEUTRAL_WORKER_ENV) {
    return NEUTRAL_WORKER_ENV[kind];
  }
  // Legacy kind → resolve through neutral, fallback to legacy env
  const alias = LEGACY_KIND_ALIAS[kind];
  if (alias) {
    return NEUTRAL_WORKER_ENV[alias.neutral] || process.env[alias.legacyEnv];
  }
  return undefined;
};

export const getMcpWorkerUrl = (kind: McpWorkerKind): string => {
  return toBaseUrl(resolveWorkerUrl(kind));
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

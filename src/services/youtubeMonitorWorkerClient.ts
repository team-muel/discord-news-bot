import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { callMcpTool, parseMcpTextBlocks } from './mcpWorkerClient';

export type YouTubeMonitorMode = 'videos' | 'posts';

export type YouTubeMonitorEntry = {
  id: string;
  title: string;
  content?: string;
  link: string;
  published: string;
  author: string;
};

export type YouTubeMonitorLatestResult = {
  found: boolean;
  channelId: string | null;
  entry?: YouTubeMonitorEntry;
};

const WORKER_URL = String(process.env.YOUTUBE_MONITOR_MCP_WORKER_URL || process.env.MCP_YOUTUBE_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TIMEOUT_MS = Math.max(2_000, parseIntegerEnv(process.env.YOUTUBE_MONITOR_MCP_TIMEOUT_MS, 12_000));
const WORKER_STRICT = parseBooleanEnv(process.env.YOUTUBE_MONITOR_MCP_STRICT, true);

const parsePayloadText = (payload: any): string => parseMcpTextBlocks(payload)[0] || '';

export const isYouTubeMonitorWorkerStrict = (): boolean => WORKER_STRICT;

export const fetchYouTubeLatestByWorker = async (params: {
  sourceUrl: string;
  mode: YouTubeMonitorMode;
  aggressiveProbe?: boolean;
}): Promise<YouTubeMonitorLatestResult | null> => {
  if (!WORKER_URL) {
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_NOT_CONFIGURED');
    }
    return null;
  }

  const payload = await callMcpTool({
    workerUrl: WORKER_URL,
    toolName: 'youtube.monitor.latest',
    args: {
      sourceUrl: params.sourceUrl,
      mode: params.mode,
      aggressiveProbe: Boolean(params.aggressiveProbe),
    },
    timeoutMs: WORKER_TIMEOUT_MS,
  });
  if (payload?.isError) {
    const message = parsePayloadText(payload) || 'YOUTUBE_MONITOR_WORKER_ERROR';
    throw new Error(message);
  }

  const text = parsePayloadText(payload);
  if (!text) {
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_EMPTY');
    }
    return null;
  }

  try {
    const parsed = JSON.parse(text) as YouTubeMonitorLatestResult;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid payload');
    }
    return parsed;
  } catch {
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_INVALID_JSON');
    }
    return null;
  }
};

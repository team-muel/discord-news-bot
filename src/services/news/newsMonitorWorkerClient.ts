import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { callMcpTool, parseMcpTextBlocks } from '../mcpWorkerClient';

export type WorkerNewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  publisherName: string | null;
  publishedAtUnix: number | null;
  key: string;
  lexicalSignature: string;
};

const WORKER_URL = String(process.env.NEWS_MONITOR_MCP_WORKER_URL || process.env.MCP_NEWS_WORKER_URL || '').trim().replace(/\/+$/, '');
const WORKER_TIMEOUT_MS = Math.max(2_000, parseIntegerEnv(process.env.NEWS_MONITOR_MCP_TIMEOUT_MS, 12_000));
const WORKER_STRICT = parseBooleanEnv(process.env.NEWS_MONITOR_MCP_STRICT, true);

export const fetchNewsMonitorCandidatesByWorker = async (limit: number): Promise<WorkerNewsItem[] | null> => {
  if (!WORKER_URL) {
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_NOT_CONFIGURED');
    }
    return null;
  }

  const payload = await callMcpTool({
    workerUrl: WORKER_URL,
    toolName: 'news.monitor.candidates',
    args: { limit },
    timeoutMs: WORKER_TIMEOUT_MS,
  });

  if (payload?.isError) {
    const message = parseMcpTextBlocks(payload)[0] || 'NEWS_MONITOR_WORKER_ERROR';
    throw new Error(message);
  }

  const text = parseMcpTextBlocks(payload)[0] || '';
  if (!text) {
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_EMPTY');
    }
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { items?: WorkerNewsItem[] };
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid payload');
    }
    const rows = Array.isArray(parsed.items) ? parsed.items : [];
    return rows;
  } catch {
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_INVALID_JSON');
    }
    return null;
  }
};

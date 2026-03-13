import { logStructuredError } from './structuredErrorLogService';
import { toWorkerExecutionError, validateMcpCallParams, WorkerExecutionError } from './workerExecution';

export type McpTextBlock = { type?: string; text?: string };

export type McpCallPayload = {
  content?: McpTextBlock[];
  isError?: boolean;
};

const toBaseUrl = (raw: string | undefined): string => String(raw || '').trim().replace(/\/+$/, '');

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('MCP_TIMEOUT')), Math.max(1_000, timeoutMs));
    });
    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    if (error instanceof Error && error.message === 'MCP_TIMEOUT') {
      await logStructuredError({
        code: 'MCP_TIMEOUT',
        source: 'mcpWorkerClient.withTimeout',
        message: `MCP worker timeout after ${Math.max(1_000, timeoutMs)}ms`,
      }, error);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const parseMcpTextBlocks = (payload: McpCallPayload): string[] => {
  if (!payload || typeof payload !== 'object') {
    void logStructuredError({
      code: 'MCP_PARSE_ERROR',
      source: 'mcpWorkerClient.parseMcpTextBlocks',
      message: 'Invalid MCP payload type',
      meta: { payloadType: typeof payload },
      severity: 'warn',
    });
    return [];
  }

  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  if (!Array.isArray(payload?.content) && !payload?.isError) {
    void logStructuredError({
      code: 'MCP_PARSE_ERROR',
      source: 'mcpWorkerClient.parseMcpTextBlocks',
      message: 'MCP payload content is not an array',
      severity: 'warn',
    });
  }
  return blocks
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean);
};

export const callMcpTool = async (params: {
  workerUrl: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs: number;
}): Promise<McpCallPayload> => {
  validateMcpCallParams({
    workerUrl: params.workerUrl,
    toolName: params.toolName,
    args: params.args,
  });

  const base = toBaseUrl(params.workerUrl);

  const response = await withTimeout(fetch(`${base}/tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: params.toolName,
      arguments: params.args,
    }),
  }), params.timeoutMs).catch((error) => {
    throw toWorkerExecutionError(error, 'MCP_TIMEOUT');
  });

  if (!response.ok) {
    await logStructuredError({
      code: 'MCP_HTTP_ERROR',
      source: 'mcpWorkerClient.callMcpTool',
      message: `MCP worker returned HTTP ${response.status}`,
      meta: { workerUrl: base, toolName: params.toolName, status: response.status },
      severity: 'warn',
    });
    throw new WorkerExecutionError({
      code: 'MCP_HTTP_ERROR',
      message: `MCP_HTTP_${response.status}`,
      retryable: response.status >= 500,
      meta: { status: response.status },
    });
  }

  const payload = await response.json() as McpCallPayload;
  return payload;
};

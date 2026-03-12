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
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const parseMcpTextBlocks = (payload: McpCallPayload): string[] => {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
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
  const base = toBaseUrl(params.workerUrl);
  if (!base) {
    throw new Error('MCP_WORKER_NOT_CONFIGURED');
  }

  const response = await withTimeout(fetch(`${base}/tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: params.toolName,
      arguments: params.args,
    }),
  }), params.timeoutMs);

  if (!response.ok) {
    throw new Error(`MCP_HTTP_${response.status}`);
  }

  const payload = await response.json() as McpCallPayload;
  return payload;
};

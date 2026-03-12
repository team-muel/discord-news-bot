export type McpToolInputSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type McpToolSpec = {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
};

export type McpToolCallRequest = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type McpToolCallResult = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
};

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

/* eslint-disable no-console */
import readline from 'node:readline';
import { callMcpTool, listMcpTools } from './toolAdapter';
import type { JsonRpcRequest, JsonRpcResponse } from './types';

const MCP_PROTOCOL_VERSION = '2026-03-01';

const asObject = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const toResponse = (response: JsonRpcResponse) => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

const ok = (id: number | string | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

const fail = (id: number | string | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const id = request.id ?? null;

  if (request.jsonrpc !== '2.0' || !request.method) {
    return fail(id, -32600, 'invalid request');
  }

  if (request.method === 'initialize') {
    return ok(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: 'muel-mcp-server',
        version: '0.1.0',
      },
      capabilities: {
        tools: {},
      },
    });
  }

  if (request.method === 'tools/list') {
    return ok(id, {
      tools: listMcpTools(),
    });
  }

  if (request.method === 'tools/call') {
    const params = asObject(request.params);
    const name = typeof params.name === 'string' ? params.name : '';
    const args = asObject(params.arguments);

    if (!name) {
      return fail(id, -32602, 'name is required');
    }

    const result = await callMcpTool({
      name,
      arguments: args,
    });

    return ok(id, result);
  }

  return fail(id, -32601, `method not found: ${request.method}`);
};

export const startMcpStdioServer = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const raw = String(line || '').trim();
    if (!raw) {
      return;
    }

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(raw) as JsonRpcRequest;
    } catch {
      toResponse(fail(null, -32700, 'parse error'));
      return;
    }

    try {
      const response = await handleRequest(request);
      toResponse(response);
    } catch (error) {
      toResponse(fail(request.id ?? null, -32000, error instanceof Error ? error.message : String(error)));
    }
  });

  console.error('[mcp] stdio server started');
};

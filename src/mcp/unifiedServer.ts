/* eslint-disable no-console */
/**
 * Unified MCP Server
 *
 * Single server exposing all MCP tools (general + indexing) over both
 * stdio (JSON-RPC line-delimited) and HTTP transport.
 *
 * Stdio: standard JSON-RPC 2.0 over stdin/stdout
 * HTTP:  POST /mcp/tools/list, POST /mcp/tools/call, GET /mcp/health
 */

import readline from 'node:readline';
import { listAllMcpTools, callAnyMcpTool } from './unifiedToolAdapter';
import type { JsonRpcRequest, JsonRpcResponse, McpToolCallResult } from './types';

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
        name: 'muel-unified-mcp-server',
        version: '0.2.0',
      },
      capabilities: {
        tools: {},
      },
    });
  }

  if (request.method === 'tools/list') {
    return ok(id, {
      tools: listAllMcpTools(),
    });
  }

  if (request.method === 'tools/call') {
    const params = asObject(request.params);
    const name = typeof params.name === 'string' ? params.name : '';
    const args = asObject(params.arguments);

    if (!name) {
      return fail(id, -32602, 'name is required');
    }

    const result = await callAnyMcpTool({
      name,
      arguments: args,
    });

    return ok(id, result);
  }

  return fail(id, -32601, `method not found: ${request.method}`);
};

// ──── Stdio Transport ──────────────────────────────────────────────────────────

export const startUnifiedMcpStdioServer = () => {
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
      const message = error instanceof Error ? error.message : String(error);
      toResponse(fail(request.id ?? null, -32603, message));
    }
  });

  console.error('[muel-unified-mcp] stdio server ready (general + indexing tools)');
};

// ──── HTTP Transport ───────────────────────────────────────────────────────────

type HttpIncomingMessage = import('node:http').IncomingMessage;
type HttpServerResponse = import('node:http').ServerResponse;

const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

const collectHttpBody = async (req: HttpIncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buf.length;
    if (totalBytes > MAX_HTTP_BODY_BYTES) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const jsonResponse = (res: HttpServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const validateAuthToken = (req: HttpIncomingMessage, expectedToken: string): boolean => {
  if (!expectedToken) return true; // no auth configured
  const fromHeader = String(req.headers['x-opencode-worker-token'] || '').trim();
  if (fromHeader) {
    const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
    const expected = Buffer.from(expectedToken);
    const incoming = Buffer.from(fromHeader);
    if (expected.length !== incoming.length) return false;
    return timingSafeEqual(expected, incoming);
  }
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
    const expected = Buffer.from(expectedToken);
    const incoming = Buffer.from(token);
    if (expected.length !== incoming.length) return false;
    return timingSafeEqual(expected, incoming);
  }
  return false;
};

const extractGuildContext = (req: HttpIncomingMessage): { guildId?: string; requestedBy?: string } => {
  return {
    guildId: typeof req.headers['x-muel-guild-id'] === 'string' ? req.headers['x-muel-guild-id'] : undefined,
    requestedBy: typeof req.headers['x-muel-requested-by'] === 'string' ? req.headers['x-muel-requested-by'] : undefined,
  };
};

export const createMcpHttpHandler = (options?: { authToken?: string }) => {
  const authToken = String(options?.authToken || process.env.MCP_WORKER_AUTH_TOKEN || '').trim();

  return async (req: HttpIncomingMessage, res: HttpServerResponse): Promise<void> => {
    const url = req.url || '';
    const method = req.method || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, x-opencode-worker-token, x-muel-guild-id, x-muel-requested-by',
      });
      res.end();
      return;
    }

    // Health check
    if (url === '/mcp/health' || url === '/health') {
      const tools = listAllMcpTools();
      jsonResponse(res, 200, {
        status: 'ok',
        server: 'muel-unified-mcp-server',
        version: '0.2.0',
        tools: tools.length,
        toolNames: tools.map((t) => t.name),
      });
      return;
    }

    // Auth check for tool endpoints
    if (authToken && !validateAuthToken(req, authToken)) {
      jsonResponse(res, 401, { error: 'unauthorized' });
      return;
    }

    const guildContext = extractGuildContext(req);

    // Tool discovery (compatible with MCP Skill Router probing)
    if (url === '/tools/discover' || url === '/mcp/tools/discover') {
      const tools = listAllMcpTools();
      jsonResponse(res, 200, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          available: true,
        })),
        guildContext,
      });
      return;
    }

    // List tools
    if (url === '/mcp/tools/list' && method === 'POST') {
      jsonResponse(res, 200, { tools: listAllMcpTools() });
      return;
    }

    // Call tool
    if ((url === '/mcp/tools/call' || url === '/tools/call') && method === 'POST') {
      let body: string;
      try {
        body = await collectHttpBody(req);
      } catch {
        jsonResponse(res, 413, { error: 'request body too large' });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        jsonResponse(res, 400, { error: 'invalid JSON' });
        return;
      }

      const name = typeof parsed.name === 'string' ? parsed.name : '';
      const args = parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
        ? (parsed.arguments as Record<string, unknown>)
        : {};

      if (!name) {
        jsonResponse(res, 400, { content: [{ type: 'text', text: 'tool name is required' }], isError: true });
        return;
      }

      try {
        const result: McpToolCallResult = await callAnyMcpTool({ name, arguments: args });
        jsonResponse(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jsonResponse(res, 500, { content: [{ type: 'text', text: message }], isError: true });
      }
      return;
    }

    // JSON-RPC (full MCP protocol over HTTP)
    if (url === '/mcp/rpc' && method === 'POST') {
      let body: string;
      try {
        body = await collectHttpBody(req);
      } catch {
        jsonResponse(res, 413, { error: 'request body too large' });
        return;
      }

      let rpcRequest: JsonRpcRequest;
      try {
        rpcRequest = JSON.parse(body) as JsonRpcRequest;
      } catch {
        jsonResponse(res, 400, fail(null, -32700, 'parse error'));
        return;
      }

      try {
        const rpcResponse = await handleRequest(rpcRequest);
        jsonResponse(res, 200, rpcResponse);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jsonResponse(res, 500, fail(rpcRequest.id ?? null, -32603, message));
      }
      return;
    }

    // Not found
    jsonResponse(res, 404, { error: 'not found' });
  };
};

/**
 * Start a standalone HTTP MCP server.
 * Can be used alongside the main Express server or independently.
 */
export const startMcpHttpServer = (port: number, options?: { authToken?: string }): import('node:http').Server => {
  const http = require('node:http') as typeof import('node:http');
  const handler = createMcpHttpHandler(options);
  const server = http.createServer(handler);
  server.listen(port, () => {
    console.error(`[muel-unified-mcp] HTTP server ready on port ${port}`);
  });
  return server;
};

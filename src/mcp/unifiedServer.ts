/* eslint-disable no-console */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
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
import { listUpstreamDiagnostics } from './proxyAdapter';
import type { JsonRpcRequest, JsonRpcResponse, McpToolCallResult } from './types';
import { getErrorMessage } from '../utils/errorMessage';
import { parseStringEnv } from '../utils/env';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const NODE_ENV = parseStringEnv(process.env.NODE_ENV, 'development');
const MCP_WORKER_AUTH_TOKEN = parseStringEnv(process.env.MCP_WORKER_AUTH_TOKEN, '');

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

// MCP protocol requires tool names to match [a-z0-9_-] — dots not allowed.
// Internal names use dots (e.g., action.catalog, code.index.symbol_search).
// Transform: replace dots with hyphens (reversible — no internal names contain hyphens).
const toMcpName = (name: string): string => name.replace(/\./g, '-');
const toInternalName = (mcpName: string): string => mcpName.replace(/-/g, '.');

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
    const tools = await listAllMcpTools();
    return ok(id, {
      tools: tools.map((t) => ({ ...t, name: toMcpName(t.name) })),
    });
  }

  if (request.method === 'tools/call') {
    const params = asObject(request.params);
    const rawName = typeof params.name === 'string' ? params.name : '';
    const args = asObject(params.arguments);

    if (!rawName) {
      return fail(id, -32602, 'name is required');
    }

    const result = await callAnyMcpTool({
      name: toInternalName(rawName),
      arguments: args,
    });

    return ok(id, result);
  }

  // MCP notifications (no id) — acknowledge silently, no response
  if (request.method === 'notifications/initialized' || request.method === 'ping') {
    return ok(id, {});
  }

  return fail(id, -32601, `method not found: ${request.method}`);
};

// Notifications have no id — must not send a response per JSON-RPC 2.0 spec
const isNotification = (request: JsonRpcRequest): boolean =>
  request.id === undefined || request.id === null;

// Strip BOM and non-printable prefixes that encoding layers (PowerShell, SSH) may inject
const sanitizeLine = (line: string): string => {
  // eslint-disable-next-line no-control-regex
  return line.replace(/^[\uFEFF\x00-\x08\x0E-\x1F]+/, '').trim();
};

// ──── Stdio Transport ──────────────────────────────────────────────────────────

export const startUnifiedMcpStdioServer = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const raw = sanitizeLine(String(line || ''));
    if (!raw || raw[0] !== '{') {
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
      // JSON-RPC 2.0: notifications (no id) must not receive a response
      if (!isNotification(request)) {
        toResponse(response);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (!isNotification(request)) {
        toResponse(fail(request.id ?? null, -32603, message));
      }
    }
  });

  console.error('[muel-unified-mcp] stdio server ready (general + indexing tools)');
};

// ──── HTTP Transport ───────────────────────────────────────────────────────────

type HttpIncomingMessage = http.IncomingMessage;
type HttpServerResponse = http.ServerResponse;

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
  if (!expectedToken) return false; // no token configured = deny all
  const fromHeader = String(req.headers['x-opencode-worker-token'] || '').trim();
  if (fromHeader) {
    const expected = Buffer.from(expectedToken);
    const incoming = Buffer.from(fromHeader);
    if (expected.length !== incoming.length) return false;
    return timingSafeEqual(expected, incoming);
  }
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
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
  const authToken = String(options?.authToken || MCP_WORKER_AUTH_TOKEN || '').trim();

  if (!authToken && NODE_ENV === 'production') {
    console.error('[muel-unified-mcp] WARNING: MCP_WORKER_AUTH_TOKEN not set — all HTTP tool calls will be rejected');
  }

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
      const tools = await listAllMcpTools();
      jsonResponse(res, 200, {
        status: 'ok',
        server: 'muel-unified-mcp-server',
        version: '0.2.0',
        tools: tools.length,
        toolNames: tools.map((t) => t.name),
        upstreams: listUpstreamDiagnostics().map((entry) => ({
          id: entry.id,
          namespace: entry.namespace,
          protocol: entry.protocol,
          enabled: entry.enabled,
          plane: entry.plane,
          audience: entry.audience,
          visibleToolCount: entry.catalog.visibleToolCount,
          cacheState: entry.catalog.cacheState,
          hasFilters: entry.filters.hasFilters,
        })),
      });
      return;
    }

    // Auth check for all tool endpoints (health check is public)
    if (!validateAuthToken(req, authToken)) {
      jsonResponse(res, 401, { error: 'unauthorized' });
      return;
    }

    const guildContext = extractGuildContext(req);

    // Tool discovery (compatible with MCP Skill Router probing)
    if (url === '/tools/discover' || url === '/mcp/tools/discover') {
      const tools = await listAllMcpTools();
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
    if ((url === '/mcp/tools/list' || url === '/tools/list') && method === 'POST') {
      jsonResponse(res, 200, { tools: await listAllMcpTools() });
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
        const message = getErrorMessage(error);
        jsonResponse(res, 500, { content: [{ type: 'text', text: message }], isError: true });
      }
      return;
    }

    // JSON-RPC (full MCP protocol over HTTP)
    if ((url === '/mcp/rpc' || url === '/rpc') && method === 'POST') {
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
        const message = getErrorMessage(error);
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
export const startMcpHttpServer = (port: number, options?: { authToken?: string; host?: string }): http.Server => {
  const handler = createMcpHttpHandler(options);
  const server = http.createServer(handler);
  const host = options?.host || process.env.MCP_HTTP_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.error(`[muel-unified-mcp] HTTP server ready on ${host}:${port}`);
  });
  return server;
};

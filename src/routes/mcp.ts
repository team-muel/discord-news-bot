/**
 * Express MCP Route
 *
 * Exposes the unified MCP tool catalog (general + indexing + obsidian +
 * external adapters + upstream proxied servers) over HTTP within the
 * main Express app.
 *
 * Endpoints:
 *   POST /api/mcp/rpc    — JSON-RPC 2.0 (initialize, tools/list, tools/call)
 *   GET  /api/mcp/tools   — convenience: list all tools as JSON array
 *
 * Auth: Bearer token via MCP_WORKER_AUTH_TOKEN (mandatory in production).
 */

import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MCP_WORKER_AUTH_TOKEN, NODE_ENV } from '../config';
import { listAllMcpTools, callAnyMcpTool } from '../mcp/unifiedToolAdapter';
import type { McpToolCallRequest } from '../mcp/types';
import { getErrorMessage } from '../utils/errorMessage';

const MCP_PROTOCOL_VERSION = '2024-11-05';

// ──── Auth ─────────────────────────────────────────────────────────────────────

const validateBearer = (req: Request): boolean => {
  const token = MCP_WORKER_AUTH_TOKEN.trim();
  if (!token) return false;

  const authHeader = String(req.headers.authorization || '').trim();
  if (!/^Bearer\s+/i.test(authHeader)) return false;

  const incoming = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = Buffer.from(token);
  const received = Buffer.from(incoming);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
};

const requireAuth = (req: Request, res: Response): boolean => {
  if (!MCP_WORKER_AUTH_TOKEN && NODE_ENV !== 'production') return true; // dev: skip if not set
  if (validateBearer(req)) return true;
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return false;
};

// ──── JSON-RPC helpers ─────────────────────────────────────────────────────────

type JsonRpcReq = {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

const ok = (id: number | string | null, result: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  result,
});

const fail = (id: number | string | null, code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
});

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// ──── Router ───────────────────────────────────────────────────────────────────

export const createMcpRouter = (): Router => {
  const router = Router();

  /**
   * POST /api/mcp/rpc — JSON-RPC 2.0 endpoint
   *
   * Methods: initialize, tools/list, tools/call, notifications/initialized, ping
   */
  router.post('/rpc', async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;

    const body = req.body as JsonRpcReq;
    const id = body?.id ?? null;

    if (body?.jsonrpc !== '2.0' || !body?.method) {
      res.json(fail(id, -32600, 'invalid request'));
      return;
    }

    try {
      if (body.method === 'initialize') {
        res.json(
          ok(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: 'muel-express-mcp', version: '0.1.0' },
            capabilities: { tools: {} },
          }),
        );
        return;
      }

      if (body.method === 'tools/list') {
        const tools = await listAllMcpTools();
        res.json(ok(id, { tools }));
        return;
      }

      if (body.method === 'tools/call') {
        const params = asObject(body.params);
        const rawName = typeof params.name === 'string' ? params.name : '';
        const args = asObject(params.arguments);

        if (!rawName) {
          res.json(fail(id, -32602, 'name is required'));
          return;
        }

        const callReq: McpToolCallRequest = { name: rawName, arguments: args };
        const result = await callAnyMcpTool(callReq);
        res.json(ok(id, result));
        return;
      }

      if (body.method === 'notifications/initialized' || body.method === 'ping') {
        res.json(ok(id, {}));
        return;
      }

      res.json(fail(id, -32601, `method not found: ${body.method}`));
    } catch (error) {
      res.json(fail(id, -32603, getErrorMessage(error)));
    }
  });

  /**
   * GET /api/mcp/tools — convenience endpoint (list all tools as JSON array)
   */
  router.get('/tools', async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;

    try {
      const tools = await listAllMcpTools();
      res.json({ tools: tools.map((t) => ({ name: t.name, description: t.description })) });
    } catch (error) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  return router;
};

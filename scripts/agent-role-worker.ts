/* eslint-disable no-console */
import http from 'node:http';
import process from 'node:process';

const argvRole = process.argv
  .map((item) => String(item || '').trim())
  .find((item) => item.startsWith('--role='))
  ?.slice('--role='.length)
  .trim()
  .toLowerCase();

if (argvRole && !String(process.env.AGENT_ROLE_WORKER_ROLE || '').trim()) {
  process.env.AGENT_ROLE_WORKER_ROLE = argvRole;
}

const PORT = Math.max(1, Number(process.env.AGENT_ROLE_WORKER_PORT || 8790));
const HOST = String(process.env.AGENT_ROLE_WORKER_HOST || '127.0.0.1').trim() || '127.0.0.1';
const ROLE = String(process.env.AGENT_ROLE_WORKER_ROLE || '').trim().toLowerCase();
const WORKER_AUTH_TOKEN = String(
  process.env.AGENT_ROLE_WORKER_AUTH_TOKEN
  || process.env.MCP_WORKER_AUTH_TOKEN
  || '',
).trim();
const REQUIRE_AUTH = /^(1|true|yes|on)$/i.test(String(process.env.AGENT_ROLE_WORKER_REQUIRE_AUTH || '').trim())
  || WORKER_AUTH_TOKEN.length > 0;

const ROLE_TOOLS: Record<string, string[]> = {
  'local-orchestrator': ['local.orchestrator.route', 'local.orchestrator.all'],
  coordinate: ['coordinate.route', 'coordinate.all'],
  opendev: ['opendev.plan'],
  architect: ['architect.plan'],
  nemoclaw: ['nemoclaw.review'],
  review: ['review.review'],
  openjarvis: ['openjarvis.ops'],
  operate: ['operate.ops'],
  implement: ['implement.execute'],
};

const resolveAllowedTools = (): string[] => {
  const fromEnv = String(process.env.AGENT_ROLE_WORKER_TOOLS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv)];
  }
  return ROLE_TOOLS[ROLE] ? [...ROLE_TOOLS[ROLE]] : [];
};

const ALLOWED_TOOLS = resolveAllowedTools();
const { getAction, listActions } = await import('../src/services/skills/actions/registry');

const getAuthTokenFromRequest = (req: http.IncomingMessage): string => {
  const fromHeader = String(req.headers['x-opencode-worker-token'] || '').trim();
  if (fromHeader) {
    return fromHeader;
  }
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
};

const json = (res: http.ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const toErrorPayload = (message: string) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const collectBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const handleToolCall = async (payload: unknown) => {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const name = String(data.name || '').trim();
  const args = data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments)
    ? data.arguments as Record<string, unknown>
    : {};

  if (!name) {
    return toErrorPayload('tool name is required');
  }
  if (!ALLOWED_TOOLS.includes(name)) {
    return toErrorPayload(`unsupported tool: ${name}`);
  }

  const action = getAction(name);
  if (!action) {
    return toErrorPayload(`action not registered: ${name}`);
  }

  const result = await action.execute({
    goal: String(args.goal || args.query || '').trim(),
    args,
    guildId: typeof args.guildId === 'string' ? args.guildId : undefined,
    requestedBy: typeof args.requestedBy === 'string' ? args.requestedBy : undefined,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
};

if (ALLOWED_TOOLS.length === 0) {
  console.error('[agent-role-worker] no allowed tools configured. Set AGENT_ROLE_WORKER_ROLE or AGENT_ROLE_WORKER_TOOLS.');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    json(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      ok: true,
      service: 'agent-role-worker',
      role: ROLE || null,
      allowedTools: ALLOWED_TOOLS,
      requireAuth: REQUIRE_AUTH,
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/tools/discover') {
    const { getExternalAdapterStatus } = await import('../src/services/tools/externalAdapterRegistry');
    try {
      const adapters = await getExternalAdapterStatus();
      json(res, 200, {
        ok: true,
        role: ROLE || null,
        platform: process.platform,
        resourceProfile: 'micro',
        allowedTools: ALLOWED_TOOLS,
        externalAdapters: adapters,
      });
    } catch {
      json(res, 200, {
        ok: true,
        role: ROLE || null,
        platform: process.platform,
        resourceProfile: 'micro',
        allowedTools: ALLOWED_TOOLS,
        externalAdapters: [],
      });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/tools') {
    const tools = listActions().filter((action) => ALLOWED_TOOLS.includes(action.name));
    json(res, 200, {
      ok: true,
      role: ROLE || null,
      tools,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/tools/call') {
    if (REQUIRE_AUTH) {
      const incomingToken = getAuthTokenFromRequest(req);
      if (!incomingToken || incomingToken !== WORKER_AUTH_TOKEN) {
        json(res, 401, toErrorPayload('unauthorized'));
        return;
      }
    }

    try {
      const raw = await collectBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const result = await handleToolCall(payload);
      json(res, 200, result);
    } catch (error) {
      json(res, 400, toErrorPayload(error instanceof Error ? error.message : String(error)));
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  if (REQUIRE_AUTH && !WORKER_AUTH_TOKEN) {
    console.error('[agent-role-worker] auth is required but token is empty');
    process.exit(1);
  }
  console.log(`[agent-role-worker] listening on http://${HOST}:${PORT}`);
  console.log(`[agent-role-worker] role=${ROLE || 'custom'} tools=${ALLOWED_TOOLS.join(',')}`);
});
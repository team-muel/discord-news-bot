import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock config module ─────────────────────────────────────────────────────────
vi.mock('../config', () => ({
  MCP_UPSTREAM_SERVERS_RAW: '',
  MCP_UPSTREAM_TOOL_CACHE_TTL_MS: 300_000,
}));

// Import registry and adapter AFTER mocks are set up
import {
  registerUpstream,
  unregisterUpstream,
  listUpstreams,
  findUpstreamByNamespace,
  clearUpstreams,
  loadUpstreamsFromConfig,
} from './proxyRegistry';
import { listProxiedTools, callProxiedTool, invalidateAllServerCaches, listUpstreamDiagnostics } from './proxyAdapter';

// ──── Helpers ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  clearUpstreams();
  invalidateAllServerCaches();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ──── proxyRegistry tests ─────────────────────────────────────────────────────

describe('proxyRegistry', () => {
  describe('registerUpstream', () => {
    it('registers a server and returns it via listUpstreams', () => {
      registerUpstream({ id: 'test', url: 'http://test.example', namespace: 'test' });
      const upstreams = listUpstreams();
      expect(upstreams).toHaveLength(1);
      expect(upstreams[0].id).toBe('test');
      expect(upstreams[0].namespace).toBe('test');
    });

    it('strips trailing slash from url', () => {
      registerUpstream({ id: 'slash', url: 'http://test.example/', namespace: 'slash' });
      const found = findUpstreamByNamespace('slash');
      expect(found?.url).toBe('http://test.example');
    });

    it('defaults enabled to true when omitted', () => {
      registerUpstream({ id: 'en', url: 'http://en.example', namespace: 'en' });
      expect(findUpstreamByNamespace('en')?.enabled).toBe(true);
    });

    it('updates existing server on re-register', () => {
      registerUpstream({ id: 'upd', url: 'http://v1.example', namespace: 'upd' });
      registerUpstream({ id: 'upd', url: 'http://v2.example', namespace: 'upd' });
      const upstreams = listUpstreams();
      expect(upstreams).toHaveLength(1);
      expect(upstreams[0].url).toBe('http://v2.example');
    });

    it('throws when id is empty', () => {
      expect(() => registerUpstream({ id: '', url: 'http://x', namespace: 'x' }))
        .toThrowError('id is required');
    });

    it('throws when namespace contains uppercase', () => {
      expect(() => registerUpstream({ id: 'bad', url: 'http://x', namespace: 'BadNs' }))
        .toThrowError('namespace must match');
    });

    it('throws when namespace is already used by a different server', () => {
      registerUpstream({ id: 'a', url: 'http://a', namespace: 'shared' });
      expect(() => registerUpstream({ id: 'b', url: 'http://b', namespace: 'shared' }))
        .toThrowError('Namespace "shared" is already used by server "a"');
    });

    it('allows re-registering same id with same namespace', () => {
      registerUpstream({ id: 'same', url: 'http://same', namespace: 'same' });
      expect(() => registerUpstream({ id: 'same', url: 'http://same2', namespace: 'same' }))
        .not.toThrow();
    });

    it('throws when toolAllowlist is not an array of strings', () => {
      expect(() => registerUpstream({
        id: 'bad_allow',
        url: 'http://x',
        namespace: 'bad_allow',
        toolAllowlist: ['ok', 123 as unknown as string],
      })).toThrowError('toolAllowlist must be an array of strings');
    });

    it('throws when plane is not one of the allowed values', () => {
      expect(() => registerUpstream({
        id: 'bad_plane',
        url: 'http://x',
        namespace: 'bad_plane',
        plane: 'analytics' as unknown as 'operational',
      })).toThrowError('plane must be one of');
    });
  });

  describe('unregisterUpstream', () => {
    it('removes the server and its namespace', () => {
      registerUpstream({ id: 'rm', url: 'http://rm', namespace: 'rm' });
      const removed = unregisterUpstream('rm');
      expect(removed).toBe(true);
      expect(listUpstreams()).toHaveLength(0);
      expect(findUpstreamByNamespace('rm')).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      expect(unregisterUpstream('nonexistent')).toBe(false);
    });
  });

  describe('findUpstreamByNamespace', () => {
    it('returns undefined for unknown namespace', () => {
      expect(findUpstreamByNamespace('unknown')).toBeUndefined();
    });

    it('returns undefined for disabled server', () => {
      registerUpstream({ id: 'dis', url: 'http://dis', namespace: 'dis', enabled: false });
      expect(findUpstreamByNamespace('dis')).toBeUndefined();
    });

    it('returns config for enabled server', () => {
      registerUpstream({ id: 'ok', url: 'http://ok', namespace: 'ok', enabled: true });
      expect(findUpstreamByNamespace('ok')?.id).toBe('ok');
    });
  });

  describe('listUpstreams', () => {
    it('excludes disabled servers', () => {
      registerUpstream({ id: 'on', url: 'http://on', namespace: 'on', enabled: true });
      registerUpstream({ id: 'off', url: 'http://off', namespace: 'off', enabled: false });
      expect(listUpstreams()).toHaveLength(1);
      expect(listUpstreams()[0].id).toBe('on');
    });
  });

  describe('loadUpstreamsFromConfig', () => {
    it('silently does nothing when MCP_UPSTREAM_SERVERS_RAW is empty', () => {
      loadUpstreamsFromConfig();
      expect(listUpstreams()).toHaveLength(0);
    });
  });
});

// ──── proxyAdapter tests ──────────────────────────────────────────────────────

describe('proxyAdapter', () => {
  const makeRpcToolsResponse = (tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) =>
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description ?? t.name,
            inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          })),
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  describe('listProxiedTools', () => {
    it('returns empty array when no upstreams are registered', async () => {
      const tools = await listProxiedTools();
      expect(tools).toHaveLength(0);
    });

    it('returns tools from upstream with upstream.<ns>.<tool> naming', async () => {
      registerUpstream({ id: 'supa', url: 'http://supa.test', namespace: 'supabase' });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([{ name: 'query-db', description: 'Query DB' }]));

      const tools = await listProxiedTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('upstream.supabase.query_db');
      expect(tools[0].description).toBe('Query DB');
    });

    it('normalizes dots in tool name to underscores', async () => {
      registerUpstream({ id: 'dw', url: 'http://dw.test', namespace: 'deepwiki' });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([{ name: 'wiki.query' }]));

      const tools = await listProxiedTools();
      expect(tools[0].name).toBe('upstream.deepwiki.wiki_query');
    });

    it('returns cached tools on second call without re-fetching', async () => {
      registerUpstream({ id: 'cache_test', url: 'http://cache.test', namespace: 'cached' });
      mockFetch.mockResolvedValue(makeRpcToolsResponse([{ name: 'tool_a' }]));

      await listProxiedTools();
      await listProxiedTools();

      // fetch should only have been called once (for /mcp/rpc)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('excludes tools from a failed upstream, does not throw', async () => {
      registerUpstream({ id: 'good', url: 'http://good.test', namespace: 'good' });
      registerUpstream({ id: 'bad', url: 'http://bad.test', namespace: 'bad' });

      mockFetch
        .mockImplementationOnce(async (url: string) => {
          if (String(url).includes('good')) return makeRpcToolsResponse([{ name: 'ok_tool' }]);
          throw new Error('connection refused');
        })
        .mockImplementationOnce(async (url: string) => {
          if (String(url).includes('bad')) throw new Error('connection refused');
          return makeRpcToolsResponse([{ name: 'ok_tool' }]);
        });

      const tools = await listProxiedTools();
      // Only the good server's tool should appear
      const names = tools.map((t) => t.name);
      expect(names.some((n) => n.startsWith('upstream.good'))).toBe(true);
      expect(names.some((n) => n.startsWith('upstream.bad'))).toBe(false);
    });

    it('falls back to /tools/list when /mcp/rpc returns non-ok', async () => {
      registerUpstream({ id: 'fb', url: 'http://fb.test', namespace: 'fallback' });

      // /mcp/rpc returns 404
      mockFetch
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
        // /tools/list returns success
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ tools: [{ name: 'fb_tool', description: 'fallback tool' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );

      const tools = await listProxiedTools();
      expect(tools[0].name).toBe('upstream.fallback.fb_tool');
    });

    it('normalizes upstream array schemas missing items before exposing tools', async () => {
      registerUpstream({ id: 'axiom', url: 'http://axiom.test', namespace: 'axiom' });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([
        {
          name: 'axiom.compose',
          inputSchema: {
            type: 'object',
            properties: {
              selectedModels: {
                type: 'array',
              },
              targetInstrumentation: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    roles: {
                      type: 'array',
                    },
                  },
                },
              },
            },
          },
        },
      ]));

      const tools = await listProxiedTools();
      const composeTool = tools[0];
      const props = composeTool.inputSchema.properties as Record<string, any>;

      expect(props.selectedModels.items).toEqual({});
      expect(props.targetInstrumentation.items.properties.roles.items).toEqual({});
    });

    it('respects toolAllowlist patterns when listing tools', async () => {
      registerUpstream({
        id: 'filtered',
        url: 'http://filtered.test',
        namespace: 'filtered',
        toolAllowlist: ['read_*', 'list_*'],
      });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([
        { name: 'read_rows' },
        { name: 'list_tables' },
        { name: 'execute_sql' },
      ]));

      const tools = await listProxiedTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'upstream.filtered.read_rows',
        'upstream.filtered.list_tables',
      ]);
    });

    it('applies toolDenylist after allowlist when listing tools', async () => {
      registerUpstream({
        id: 'deny_filtered',
        url: 'http://deny-filtered.test',
        namespace: 'deny_filtered',
        toolAllowlist: ['*'],
        toolDenylist: ['execute_*'],
      });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([
        { name: 'list_tables' },
        { name: 'execute_sql' },
      ]));

      const tools = await listProxiedTools();
      expect(tools.map((tool) => tool.name)).toEqual(['upstream.deny_filtered.list_tables']);
    });

    it('drops sanitized-name collisions and records them in diagnostics', async () => {
      registerUpstream({ id: 'collide', url: 'http://collide.test', namespace: 'collide' });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([
        { name: 'list-tables' },
        { name: 'list.tables' },
        { name: 'read_tables' },
      ]));

      const tools = await listProxiedTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'upstream.collide.list_tables',
        'upstream.collide.read_tables',
      ]);

      const diagnostics = listUpstreamDiagnostics();
      expect(diagnostics[0].catalog.visibleToolCount).toBe(2);
      expect(diagnostics[0].catalog.rawToolCount).toBe(3);
      expect(diagnostics[0].catalog.nameCollisionCount).toBe(1);
      expect(diagnostics[0].catalog.collisionExamples).toContain('list.tables -> upstream.collide.list_tables');
    });

    it('returns upstream diagnostics with metadata and catalog state', async () => {
      registerUpstream({
        id: 'federated_runtime',
        url: 'http://runtime.test',
        namespace: 'exec_projection',
        protocol: 'streamable',
        label: 'External Projection Runtime',
        description: 'Projection and synthesis lane',
        plane: 'execution',
        audience: 'shared',
        owner: 'team-runtime',
        sourceRepo: 'team-runtime/projection-runtime',
        toolAllowlist: ['project_*'],
      });
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }),
          { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } },
        ),
      ).mockResolvedValueOnce(new Response('', { status: 202 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                tools: [{ name: 'project_refresh', description: 'refresh projection' }],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );

      await listProxiedTools();
      const diagnostics = listUpstreamDiagnostics({ includeUrl: true });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        id: 'federated_runtime',
        namespace: 'exec_projection',
        url: 'http://runtime.test',
        plane: 'execution',
        audience: 'shared',
        owner: 'team-runtime',
        sourceRepo: 'team-runtime/projection-runtime',
        filters: {
          allowlist: ['project_*'],
          denylist: [],
          hasFilters: true,
        },
      });
      expect(diagnostics[0].catalog.visibleToolCount).toBe(1);
      expect(diagnostics[0].catalog.rawToolCount).toBe(1);
      expect(diagnostics[0].catalog.filteredToolCount).toBe(0);
      expect(diagnostics[0].catalog.invalidToolCount).toBe(0);
      expect(diagnostics[0].catalog.nameCollisionCount).toBe(0);
      expect(diagnostics[0].catalog.cacheState).toBe('warm');
      expect(diagnostics[0].catalog.lastSuccessAt).toBeTruthy();
      expect(diagnostics[0].catalog.lastError).toBeNull();
    });
  });

  describe('callProxiedTool', () => {
    it('returns error for non-upstream tool name', async () => {
      const result = await callProxiedTool('action.catalog', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Not a proxied tool name');
    });

    it('returns error for malformed upstream tool name', async () => {
      const result = await callProxiedTool('upstream.onlyone', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Malformed');
    });

    it('returns error when namespace is not registered', async () => {
      const result = await callProxiedTool('upstream.unknown.some_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No upstream server registered');
    });

    it('forwards tool call to upstream and returns content', async () => {
      registerUpstream({ id: 'fwd', url: 'http://fwd.test', namespace: 'fwd' });

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: 'hello from upstream' }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await callProxiedTool('upstream.fwd.my_tool', { key: 'val' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe('hello from upstream');

      // Verify correct body was sent
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('my_tool');
      expect(body.params.arguments).toEqual({ key: 'val' });
    });

    it('returns error when upstream responds with HTTP error', async () => {
      registerUpstream({ id: 'err', url: 'http://err.test', namespace: 'err' });
      mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

      const result = await callProxiedTool('upstream.err.tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('HTTP 500');
    });

    it('returns error when upstream returns JSON-RPC error', async () => {
      registerUpstream({ id: 'rpcerr', url: 'http://rpcerr.test', namespace: 'rpcerr' });
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await callProxiedTool('upstream.rpcerr.tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('method not found');
    });

    it('returns error when upstream fetch throws (timeout)', async () => {
      registerUpstream({ id: 'timeout', url: 'http://timeout.test', namespace: 'timeout' });
      mockFetch.mockRejectedValueOnce(new Error('The operation was aborted'));

      const result = await callProxiedTool('upstream.timeout.slow_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Upstream call failed');
    });

    it('includes Authorization header when token is configured', async () => {
      registerUpstream({ id: 'auth', url: 'http://auth.test', namespace: 'auth', token: 'secret-token' });
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      await callProxiedTool('upstream.auth.tool', {});

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer secret-token');
    });

    it('reuses shared MCP auth token when the upstream matches the canonical shared ingress base', async () => {
      vi.stubEnv('MCP_SHARED_MCP_URL', 'https://shared.example.com/mcp');
      vi.stubEnv('MCP_SHARED_MCP_TOKEN', 'shared-token');
      registerUpstream({ id: 'shared', url: 'https://shared.example.com', namespace: 'gcpcompute' });
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      await callProxiedTool('upstream.gcpcompute.tool', {});

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer shared-token');
    });

    it('does not include Authorization header when no token', async () => {
      registerUpstream({ id: 'noauth', url: 'http://noauth.test', namespace: 'noauth' });
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      await callProxiedTool('upstream.noauth.tool', {});

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('rejects a tool hidden by upstream filter', async () => {
      registerUpstream({
        id: 'hidden',
        url: 'http://hidden.test',
        namespace: 'hidden',
        toolAllowlist: ['visible_tool'],
      });
      mockFetch.mockResolvedValueOnce(makeRpcToolsResponse([
        { name: 'visible_tool' },
        { name: 'hidden_tool' },
      ]));

      const result = await callProxiedTool('upstream.hidden.hidden_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not exposed by upstream filter');
    });

    it('allows a filtered tool after refreshing the upstream catalog', async () => {
      registerUpstream({
        id: 'visible',
        url: 'http://visible.test',
        namespace: 'visible',
        toolAllowlist: ['visible_tool'],
      });
      mockFetch
        .mockResolvedValueOnce(makeRpcToolsResponse([{ name: 'visible_tool' }]))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'visible-ok' }] } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );

      const result = await callProxiedTool('upstream.visible.visible_tool', { ok: true });
      expect(result.isError).not.toBe(true);
      expect(result.content[0].text).toBe('visible-ok');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

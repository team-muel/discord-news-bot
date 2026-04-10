import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Stub env before import
vi.stubEnv('OBSIDIAN_REMOTE_MCP_ENABLED', 'true');
vi.stubEnv('OBSIDIAN_REMOTE_MCP_URL', ''); // will set per test via mock server
vi.stubEnv('OBSIDIAN_REMOTE_MCP_TOKEN', 'test-token');
vi.stubEnv('OBSIDIAN_REMOTE_MCP_TIMEOUT_MS', '5000');

// We test via a real HTTP server to exercise the full fetch path.

let server: http.Server;
let baseUrl: string;
let lastRequestBody: Record<string, unknown> | null = null;
let lastRequestHeaders: http.IncomingHttpHeaders = {};
let respondWith: { status: number; body: unknown } = { status: 200, body: {} };
let responseQueue: Array<{ status: number; body: unknown }> = [];
let requestPaths: string[] = [];

const startServer = async (): Promise<void> => {
  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      requestPaths.push(req.url || '');
      lastRequestHeaders = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      try {
        lastRequestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        lastRequestBody = null;
      }
      const nextResponse = responseQueue.shift() || respondWith;
      res.writeHead(nextResponse.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nextResponse.body));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
};

const stopServer = async (): Promise<void> => {
  return new Promise((resolve) => server.close(() => resolve()));
};

describe('remoteMcpObsidianAdapter', () => {
  beforeEach(async () => {
    lastRequestBody = null;
    lastRequestHeaders = {};
    respondWith = { status: 200, body: {} };
    responseQueue = [];
    requestPaths = [];
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  const loadAdapter = async () => {
    const mod = await loadModule();
    return mod.remoteMcpObsidianAdapter;
  };

  const loadModule = async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_URL', baseUrl);
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_TOKEN', 'test-token');
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_TIMEOUT_MS', '5000');
    return import('./remoteMcpAdapter');
  };

  const loadSharedModule = async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('MCP_SHARED_MCP_URL', `${baseUrl}/mcp`);
    vi.stubEnv('MCP_SHARED_MCP_TOKEN', 'shared-token');
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_TIMEOUT_MS', '5000');
    return import('./remoteMcpAdapter');
  };

  const loadLegacyAliasModule = async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_URL', `${baseUrl}/obsidian`);
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_TOKEN', 'legacy-token');
    vi.stubEnv('OBSIDIAN_REMOTE_MCP_TIMEOUT_MS', '5000');
    return import('./remoteMcpAdapter');
  };

  describe('identity + availability', () => {
    it('id is remote-mcp', async () => {
      const adapter = await loadAdapter();
      expect(adapter.id).toBe('remote-mcp');
    });

    it('is available when enabled and URL set', async () => {
      const adapter = await loadAdapter();
      expect(adapter.isAvailable()).toBe(true);
    });

    it('supports full capability set including write_note', async () => {
      const adapter = await loadAdapter();
      expect(adapter.capabilities).toContain('write_note');
      expect(adapter.capabilities).toContain('read_lore');
      expect(adapter.capabilities).toContain('search_vault');
      expect(adapter.capabilities).toContain('read_file');
      expect(adapter.capabilities).toContain('graph_metadata');
      expect(adapter.capabilities).toContain('daily_note');
    });
  });

  describe('writeNote', () => {
    it('sends obsidian.write to remote server and returns path', async () => {
      const adapter = await loadAdapter();
      respondWith = {
        status: 200,
        body: {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, path: 'guilds/MCP/test.md' }) }],
          isError: false,
        },
      };

      const result = await adapter.writeNote!({
        fileName: 'test.md',
        content: '# Hello',
        guildId: 'MCP',
        vaultPath: '/vault',
      });

      expect(result.path).toBe('guilds/MCP/test.md');
      expect(lastRequestBody).toEqual({
        name: 'obsidian.write',
        arguments: { fileName: 'test.md', content: '# Hello', guildId: 'MCP' },
      });
    });

    it('throws when remote returns isError', async () => {
      const adapter = await loadAdapter();
      respondWith = {
        status: 200,
        body: {
          content: [{ type: 'text', text: 'sanitization blocked' }],
          isError: true,
        },
      };

      await expect(adapter.writeNote!({
        fileName: 'bad.md',
        content: 'x',
        guildId: 'MCP',
        vaultPath: '/v',
      })).rejects.toThrow('remote writeNote failed');
    });
  });

  describe('searchVault', () => {
    it('calls obsidian.search and parses results', async () => {
      const adapter = await loadAdapter();
      const searchResults = [
        { filePath: 'notes/a.md', title: 'A', score: 0.9 },
        { filePath: 'notes/b.md', title: 'B', score: 0.7 },
      ];
      respondWith = {
        status: 200,
        body: {
          content: [{ type: 'text', text: JSON.stringify(searchResults) }],
          isError: false,
        },
      };

      const results = await adapter.searchVault!({ query: 'test', vaultPath: '/v', limit: 10 });
      expect(results).toEqual(searchResults);
      expect(lastRequestBody?.name).toBe('obsidian.search');
    });

    it('returns empty array on HTTP error', async () => {
      const adapter = await loadAdapter();
      respondWith = { status: 500, body: { error: 'internal' } };
      const results = await adapter.searchVault!({ query: 'test', vaultPath: '/v', limit: 10 });
      expect(results).toEqual([]);
    });
  });

  describe('readFile', () => {
    it('calls obsidian.read and returns text', async () => {
      const adapter = await loadAdapter();
      respondWith = {
        status: 200,
        body: {
          content: [{ type: 'text', text: '# My Note\nContent here' }],
          isError: false,
        },
      };

      const content = await adapter.readFile!({ filePath: 'notes/a.md', vaultPath: '/v' });
      expect(content).toBe('# My Note\nContent here');
    });
  });

  describe('auth', () => {
    it('sends Bearer token in authorization header', async () => {
      const adapter = await loadAdapter();
      respondWith = {
        status: 200,
        body: { content: [{ type: 'text', text: '[]' }], isError: false },
      };

      await adapter.searchVault!({ query: 'x', vaultPath: '/v', limit: 5 });
      expect(lastRequestHeaders['authorization']).toBe('Bearer test-token');
    });

    it('accepts canonical shared MCP env aliases', async () => {
      const mod = await loadSharedModule();
      respondWith = {
        status: 200,
        body: { content: [{ type: 'text', text: '[]' }], isError: false },
      };

      await mod.remoteMcpObsidianAdapter.searchVault!({ query: 'shared', vaultPath: '/v', limit: 5 });
      expect(lastRequestHeaders['authorization']).toBe('Bearer shared-token');
    });

    it('reports canonical shared ingress metadata when configured via MCP_SHARED_MCP_URL', async () => {
      const mod = await loadSharedModule();

      expect(mod.getRemoteMcpAdapterDiagnostics()).toMatchObject({
        baseUrl: `${baseUrl}/mcp`,
        baseUrlSource: 'shared-mcp',
        canonicalBaseUrl: `${baseUrl}/mcp`,
        compatibilityBaseUrl: `${baseUrl}/obsidian`,
        usesCanonicalSharedIngress: true,
      });
    });

    it('derives canonical /mcp from the legacy /obsidian alias for diagnostics', async () => {
      const mod = await loadLegacyAliasModule();

      expect(mod.getRemoteMcpAdapterDiagnostics()).toMatchObject({
        baseUrl: `${baseUrl}/obsidian`,
        baseUrlSource: 'legacy-obsidian',
        canonicalBaseUrl: `${baseUrl}/mcp`,
        compatibilityBaseUrl: `${baseUrl}/obsidian`,
        usesCanonicalSharedIngress: false,
      });
    });
  });

  describe('diagnostics', () => {
    it('records the last remote error after a failed tool call', async () => {
      const mod = await loadModule();
      respondWith = { status: 500, body: { error: 'internal' } };

      const results = await mod.remoteMcpObsidianAdapter.searchVault!({ query: 'test', vaultPath: '/v', limit: 5 });
      const diagnostics = mod.getRemoteMcpAdapterDiagnostics();

      expect(results).toEqual([]);
      expect(diagnostics.lastToolName).toBe('obsidian.search');
      expect(diagnostics.lastError).toContain('HTTP 500');
      expect(diagnostics.consecutiveFailures).toBe(1);
    });

    it('probes remote health, auth, and remote obsidian status', async () => {
      const mod = await loadModule();
      responseQueue = [
        { status: 200, body: { status: 'ok' } },
        { status: 200, body: { tools: [{ name: 'obsidian.adapter.status', description: 'status', available: true }] } },
        {
          status: 200,
          body: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                selectedByCapability: { read_file: 'native-cli', write_note: 'native-cli' },
                vaultRuntime: {
                  configured: true,
                  root: '/remote-vault',
                  resolvedName: 'Obsidian Vault',
                  topLevelDirectories: ['chat', 'guilds', 'ops'],
                  looksLikeDesktopVault: true,
                },
              }),
            }],
            isError: false,
          },
        },
      ];

      const diagnostics = await mod.probeRemoteMcpAdapter();

      expect(requestPaths).toEqual(['/health', '/tools/discover', '/tools/call']);
      expect(diagnostics.lastProbe.reachable).toBe(true);
      expect(diagnostics.lastProbe.authValid).toBe(true);
      expect(diagnostics.lastProbe.toolDiscoveryOk).toBe(true);
      expect(diagnostics.lastProbe.remoteObsidianStatusOk).toBe(true);
      expect(diagnostics.remoteAdapterRuntime?.selectedByCapability).toEqual({ read_file: 'native-cli', write_note: 'native-cli' });
      expect(diagnostics.remoteAdapterRuntime?.vaultRuntime).toEqual({
        configured: true,
        root: '/remote-vault',
        resolvedName: 'Obsidian Vault',
        topLevelDirectories: ['chat', 'guilds', 'ops'],
        looksLikeDesktopVault: true,
      });
    });

    it('marks auth failure when tools discovery returns 401', async () => {
      const mod = await loadModule();
      responseQueue = [
        { status: 200, body: { status: 'ok' } },
        { status: 401, body: { error: 'unauthorized' } },
      ];

      const diagnostics = await mod.probeRemoteMcpAdapter();

      expect(diagnostics.lastProbe.reachable).toBe(true);
      expect(diagnostics.lastProbe.authValid).toBe(false);
      expect(diagnostics.lastProbe.toolDiscoveryOk).toBe(false);
      expect(diagnostics.lastProbe.error).toBe('remote_mcp_auth_failed');
    });
  });
});

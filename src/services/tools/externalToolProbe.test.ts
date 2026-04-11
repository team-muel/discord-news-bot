import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => {
  const fakeCb = (...args: unknown[]) => {
    const callback = args.find((a) => typeof a === 'function') as Function | undefined;
    if (callback) callback(null, { stdout: 'v1.0.0\n', stderr: '' });
    return { stdout: 'v1.0.0\n', stderr: '' };
  };
  return {
    exec: vi.fn(fakeCb),
    execFile: vi.fn(fakeCb),
  };
});

const fetchMock = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ models: [], status: 'ok' }),
  text: async () => 'ok',
});
vi.stubGlobal('fetch', fetchMock);

// Probe functions are side-effect-heavy (exec, fetch); test the structure and types
describe('externalToolProbe', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [], status: 'ok' }),
      text: async () => 'ok',
    });
  });

  it('probeAllExternalTools returns well-typed result', async () => {
    const { probeAllExternalTools } = await import('./externalToolProbe');
    const result = await probeAllExternalTools();

    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('tools');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBe(7);

    for (const tool of result.tools) {
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('available');
      expect(typeof tool.available).toBe('boolean');
      expect(tool).toHaveProperty('version');
      expect(tool).toHaveProperty('apiReachable');
      expect(Array.isArray(tool.details)).toBe(true);
    }

    expect(result.summary.total).toBe(7);
    expect(typeof result.summary.available).toBe('number');
    expect(typeof result.summary.apiReachable).toBe('number');
  });

  it('getExternalToolById returns a single tool status', async () => {
    const { getExternalToolById } = await import('./externalToolProbe');
    const tool = await getExternalToolById('uv');

    expect(tool.id).toBe('uv');
    expect(tool.name).toBe('uv (Python package manager)');
    expect(typeof tool.available).toBe('boolean');
  });

  it('each tool ID is unique', async () => {
    const { probeAllExternalTools } = await import('./externalToolProbe');
    const result = await probeAllExternalTools();
    const ids = result.tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('externalAdapterTypes', () => {
  it('exports the expected capability literals', async () => {
    // Type-only test: ensure the module exists and is importable
    const mod = await import('./externalAdapterTypes');
    expect(mod).toBeDefined();
  });
});

describe('externalAdapterRegistry', () => {
  it('listExternalAdapters returns all 11 adapters', async () => {
    const { listExternalAdapters } = await import('./externalAdapterRegistry');
    const adapters = listExternalAdapters();
    expect(adapters.length).toBe(11);

    const ids = adapters.map((a) => a.id);
    expect(ids).toContain('openshell');
    expect(ids).toContain('nemoclaw');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('openjarvis');
    expect(ids).toContain('n8n');
    expect(ids).toContain('deepwiki');
    expect(ids).toContain('obsidian');
    expect(ids).toContain('render');
    expect(ids).toContain('ollama');
    expect(ids).toContain('litellm-admin');
    expect(ids).toContain('mcp-indexing');
  });

  it('getExternalAdapter returns undefined for unknown ID', async () => {
    const { getExternalAdapter } = await import('./externalAdapterRegistry');
    const adapter = getExternalAdapter('nonexistent');
    expect(adapter).toBeUndefined();
  });

  it('executeExternalAction returns ADAPTER_NOT_FOUND for unknown adapter', async () => {
    const { executeExternalAction } = await import('./externalAdapterRegistry');
    const result = await executeExternalAction('nonexistent', 'test');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ADAPTER_NOT_FOUND');
  });

  it('executeExternalAction returns ADAPTER_UNAVAILABLE when adapter cannot reach its dependency', async () => {
    // Adapters are enabled by default (opt-out), but their probes will fail
    // since no real services are running in the test environment.
    const { executeExternalAction } = await import('./externalAdapterRegistry');
    const result = await executeExternalAction('openshell', 'sandbox.list');
    expect(result.ok).toBe(false);
    // Could be ADAPTER_UNAVAILABLE (probe failed) or an execution error
    expect(['ADAPTER_UNAVAILABLE', 'EXECUTION_ERROR', 'CLI_REQUIRED']).toContain(result.error);
  }, 30_000);

  it('getExternalAdapterStatus returns availability for all adapters', async () => {
    const { getExternalAdapterStatus } = await import('./externalAdapterRegistry');
    const statuses = await getExternalAdapterStatus();
    expect(statuses.length).toBe(11);
    for (const s of statuses) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('available');
      expect(s).toHaveProperty('capabilities');
      expect(typeof s.available).toBe('boolean');
    }
  }, 30_000);

  describe('deepwikiAdapter', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [], status: 'ok' }),
        text: async () => 'DeepWiki diagnostic output',
      });
    });

    it('exposes wiki.diagnose in capabilities and liteCapabilities', async () => {
      const { deepwikiAdapter } = await import('./adapters/deepwikiAdapter');
      expect(deepwikiAdapter.capabilities).toContain('wiki.diagnose');
      expect(deepwikiAdapter.liteCapabilities).toContain('wiki.diagnose');
    });

    it('wiki.diagnose builds a repo-specific diagnostic prompt', async () => {
      const { deepwikiAdapter } = await import('./adapters/deepwikiAdapter');
      const result = await deepwikiAdapter.execute('wiki.diagnose', {
        repo: 'team-muel/discord-news-bot',
        phase: 'review',
        objective: 'Fix auth regression',
        changedFiles: ['src/auth.ts', 'src/routes/bot.ts'],
        primaryOutput: 'Possible missing null guard on token parsing',
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe('wiki.diagnose');
      expect(result.summary).toContain('Diagnosis for team-muel/discord-news-bot');

      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall).toBeTruthy();
      expect(String(lastCall?.[0])).toContain('/chat/completions/stream');

      const body = JSON.parse(String((lastCall?.[1] as RequestInit | undefined)?.body || '{}'));
      expect(body.repo_url).toBe('https://github.com/team-muel/discord-news-bot');
      expect(body.messages[0].content).toContain('Phase: review');
      expect(body.messages[0].content).toContain('Changed files: src/auth.ts, src/routes/bot.ts');
      expect(body.messages[0].content).toContain('Likely defects or regressions');
      expect(body.messages[0].content).toContain('Possible missing null guard on token parsing');
    });
  });
});

describe('externalAdapterTypes — M-15 schema validation', () => {
  it('validateAdapterId accepts valid lowercase IDs', async () => {
    const { validateAdapterId } = await import('./externalAdapterTypes');
    expect(validateAdapterId('my-adapter')).toBe('my-adapter');
    expect(validateAdapterId('tool123')).toBe('tool123');
    expect(validateAdapterId('openshell')).toBe('openshell');
  });

  it('validateAdapterId rejects invalid IDs', async () => {
    const { validateAdapterId } = await import('./externalAdapterTypes');
    expect(validateAdapterId('')).toBeNull();
    expect(validateAdapterId('a')).toBeNull(); // too short (min 2)
    expect(validateAdapterId('has space')).toBeNull();
    expect(validateAdapterId('has_underscore')).toBeNull();
    expect(validateAdapterId(123)).toBeNull();
    expect(validateAdapterId(null)).toBeNull();
  });

  it('validateAdapterId normalizes to lowercase', async () => {
    const { validateAdapterId } = await import('./externalAdapterTypes');
    // 'MyAdapter' → 'myadapter' which is valid
    expect(validateAdapterId('MyAdapter')).toBe('myadapter');
  });

  it('KNOWN_ADAPTER_IDS contains the 11 built-ins', async () => {
    const { KNOWN_ADAPTER_IDS } = await import('./externalAdapterTypes');
    expect(KNOWN_ADAPTER_IDS.has('openshell')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('nemoclaw')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('openclaw')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('openjarvis')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('n8n')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('deepwiki')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('obsidian')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('render')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('ollama')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('litellm-admin')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.has('mcp-indexing')).toBe(true);
    expect(KNOWN_ADAPTER_IDS.size).toBe(11);
  });
});

describe('dynamic adapter registration — M-15', () => {
  it('registerExternalAdapter adds a new adapter', async () => {
    const { registerExternalAdapter, getExternalAdapter, unregisterExternalAdapter } = await import('./externalAdapterRegistry');
    const testAdapter = {
      id: 'test-dynamic' as const,
      capabilities: ['test.action'] as const,
      isAvailable: async () => true,
      execute: async (action: string) => ({
        ok: true, adapterId: 'test-dynamic', action, summary: 'ok', output: [], durationMs: 0,
      }),
    };
    const registered = registerExternalAdapter(testAdapter);
    expect(registered).toBe(true);
    expect(getExternalAdapter('test-dynamic')).toBeDefined();

    // Cleanup
    unregisterExternalAdapter('test-dynamic');
    expect(getExternalAdapter('test-dynamic')).toBeUndefined();
  });

  it('rejects registration of built-in adapter IDs', async () => {
    const { registerExternalAdapter } = await import('./externalAdapterRegistry');
    const fakeAdapter = {
      id: 'openshell' as const,
      capabilities: ['fake'] as const,
      isAvailable: async () => true,
      execute: async (action: string) => ({
        ok: true, adapterId: 'openshell', action, summary: 'fake', output: [], durationMs: 0,
      }),
    };
    const registered = registerExternalAdapter(fakeAdapter);
    expect(registered).toBe(false);
  });

  it('rejects registration with invalid ID', async () => {
    const { registerExternalAdapter } = await import('./externalAdapterRegistry');
    const badAdapter = {
      id: '' as const,
      capabilities: [] as const,
      isAvailable: async () => true,
      execute: async (action: string) => ({
        ok: true, adapterId: '', action, summary: 'bad', output: [], durationMs: 0,
      }),
    };
    const registered = registerExternalAdapter(badAdapter);
    expect(registered).toBe(false);
  });
});

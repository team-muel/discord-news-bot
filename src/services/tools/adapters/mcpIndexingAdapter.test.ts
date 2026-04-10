import { beforeEach, describe, expect, it, vi } from 'vitest';

const localCallMock = vi.hoisted(() => vi.fn());

vi.mock('../../../mcp/indexingToolAdapter', () => ({
  callIndexingMcpTool: localCallMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const loadModule = async () => {
  vi.resetModules();
  return import('./mcpIndexingAdapter');
};

describe('mcpIndexingAdapter', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    fetchMock.mockReset();
    localCallMock.mockReset();
  });

  it('routes indexing actions to the shared MCP first and defaults repoId to current', async () => {
    vi.stubEnv('MCP_SHARED_MCP_URL', 'https://shared.example/mcp');
    vi.stubEnv('MCP_SHARED_MCP_TOKEN', 'shared-token');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"mode":"shared"}' }],
        isError: false,
      }),
    });

    const { mcpIndexingAdapter } = await loadModule();
    const result = await mcpIndexingAdapter.execute('index.context', { goal: 'shared context' });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('shared MCP');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://shared.example/mcp/tools/call');
    expect(init.headers).toMatchObject({ authorization: 'Bearer shared-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'code.index.context_bundle',
      arguments: {
        repoId: 'current',
        goal: 'shared context',
      },
    });
    expect(localCallMock).not.toHaveBeenCalled();
  });

  it('falls back to local indexing when the shared MCP call fails', async () => {
    vi.stubEnv('MCP_INDEXING_REMOTE_URL', 'https://shared.example/mcp');
    fetchMock.mockRejectedValue(new Error('shared unavailable'));
    localCallMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"mode":"local"}' }],
      isError: false,
    });

    const { mcpIndexingAdapter } = await loadModule();
    const result = await mcpIndexingAdapter.execute('index.search', { query: 'ExampleService' });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('local fallback');
    expect(localCallMock).toHaveBeenCalledWith({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'current',
        query: 'ExampleService',
      },
    });
  });
});
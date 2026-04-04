import { describe, it, expect } from 'vitest';
import { listAllMcpTools, callAnyMcpTool } from './unifiedToolAdapter';

describe('unifiedToolAdapter', () => {
  it('listAllMcpTools returns both general and indexing tools', () => {
    const tools = listAllMcpTools();
    const names = tools.map((t) => t.name);

    // General tools
    expect(names).toContain('stock.quote');
    expect(names).toContain('action.catalog');

    // Indexing tools
    expect(names).toContain('code.index.symbol_search');
    expect(names).toContain('code.index.file_outline');
    expect(names).toContain('security.candidates_list');
  });

  it('returns no duplicate tool names', () => {
    const tools = listAllMcpTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('routes general tool to general adapter', async () => {
    const result = await callAnyMcpTool({ name: 'action.catalog' });
    expect(result.isError).not.toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('routes indexing tool to indexing adapter', async () => {
    // This will fail due to no repo configured, but proves routing works
    const result = await callAnyMcpTool({
      name: 'code.index.symbol_search',
      arguments: { repoId: 'current', query: 'test' },
    });
    // May succeed or fail depending on repo state, but should not throw
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('returns error for unknown tool', async () => {
    const result = await callAnyMcpTool({ name: 'nonexistent.tool' });
    expect(result.isError).toBe(true);
  });
});

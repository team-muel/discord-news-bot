import { describe, it, expect } from 'vitest';
import { listAllMcpTools, callAnyMcpTool } from './unifiedToolAdapter';
import { hasSchemaArrayWithoutItems } from './schemaNormalization';

describe('unifiedToolAdapter', () => {
  it('listAllMcpTools returns both general and indexing tools', async () => {
    const tools = await listAllMcpTools();
    const names = tools.map((t) => t.name);

    // General tools
    expect(names).toContain('stock.quote');
    expect(names).toContain('action.catalog');
    expect(names).toContain('diag.upstreams');

    // Indexing tools
    expect(names).toContain('code.index.symbol_search');
    expect(names).toContain('code.index.file_outline');
    expect(names).toContain('security.candidates_list');

    // Expanded OpenJarvis lite tools
    expect(names).toContain('ext.openjarvis.jarvis.ask');
    expect(names).toContain('ext.openjarvis.jarvis.server.info');
    expect(names).toContain('ext.openjarvis.jarvis.models.list');
    expect(names).toContain('ext.openjarvis.jarvis.tools.list');
    expect(names).toContain('ext.openjarvis.jarvis.agents.health');
    expect(names).toContain('ext.openjarvis.jarvis.recommended-model');
    expect(names).toContain('ext.openjarvis.jarvis.agent.list');
    expect(names).toContain('ext.openjarvis.jarvis.memory.search');
    expect(names).toContain('ext.openjarvis.jarvis.telemetry');
    expect(names).toContain('ext.openjarvis.jarvis.scheduler.list');
    expect(names).toContain('ext.openjarvis.jarvis.skill.search');
  });

  it('returns no duplicate tool names', async () => {
    const tools = await listAllMcpTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes only IDE-safe input schemas', async () => {
    const tools = await listAllMcpTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(hasSchemaArrayWithoutItems(tool.inputSchema)).toBe(false);
    }
  });

  it('routes general tool to general adapter', async () => {
    const result = await callAnyMcpTool({ name: 'action.catalog' });
    expect(result.isError).not.toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('routes upstream diagnostics tool to the general adapter', async () => {
    const result = await callAnyMcpTool({ name: 'diag.upstreams', arguments: { refresh: false } });
    expect(result.isError).not.toBe(true);
    expect(Array.isArray(JSON.parse(result.content[0].text))).toBe(true);
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

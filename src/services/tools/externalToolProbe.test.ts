import { describe, it, expect, vi, beforeEach } from 'vitest';

// Probe functions are side-effect-heavy (exec, fetch); test the structure and types
describe('externalToolProbe', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
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
  }, 20_000);

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
  it('listExternalAdapters returns all 4 adapters', async () => {
    const { listExternalAdapters } = await import('./externalAdapterRegistry');
    const adapters = listExternalAdapters();
    expect(adapters.length).toBe(4);

    const ids = adapters.map((a) => a.id);
    expect(ids).toContain('openshell');
    expect(ids).toContain('nemoclaw');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('openjarvis');
  });

  it('getExternalAdapter returns undefined for unknown ID', async () => {
    const { getExternalAdapter } = await import('./externalAdapterRegistry');
    // @ts-expect-error testing with invalid id
    const adapter = getExternalAdapter('nonexistent');
    expect(adapter).toBeUndefined();
  });

  it('executeExternalAction returns ADAPTER_NOT_FOUND for unknown adapter', async () => {
    const { executeExternalAction } = await import('./externalAdapterRegistry');
    // @ts-expect-error testing with invalid id
    const result = await executeExternalAction('nonexistent', 'test');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ADAPTER_NOT_FOUND');
  });

  it('executeExternalAction returns ADAPTER_UNAVAILABLE when disabled', async () => {
    // All adapters are disabled by default (ENABLED=false)
    const { executeExternalAction } = await import('./externalAdapterRegistry');
    const result = await executeExternalAction('openshell', 'sandbox.list');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ADAPTER_UNAVAILABLE');
  });

  it('getExternalAdapterStatus returns availability for all adapters', async () => {
    const { getExternalAdapterStatus } = await import('./externalAdapterRegistry');
    const statuses = await getExternalAdapterStatus();
    expect(statuses.length).toBe(4);
    for (const s of statuses) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('available');
      expect(s).toHaveProperty('capabilities');
      expect(typeof s.available).toBe('boolean');
    }
  });
});

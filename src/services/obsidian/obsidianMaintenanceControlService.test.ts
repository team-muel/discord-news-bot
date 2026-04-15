import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunObsidianLoreSyncOnce,
  mockRunObsidianGraphAuditOnce,
  mockGetLatestObsidianGraphAuditSnapshot,
  mockCallMcpWorkerTool,
  mockGetMcpWorkerUrl,
  mockIsMcpStrictRouting,
  mockParseMcpTextBlocks,
} = vi.hoisted(() => ({
  mockRunObsidianLoreSyncOnce: vi.fn(),
  mockRunObsidianGraphAuditOnce: vi.fn(),
  mockGetLatestObsidianGraphAuditSnapshot: vi.fn(),
  mockCallMcpWorkerTool: vi.fn(),
  mockGetMcpWorkerUrl: vi.fn(() => ''),
  mockIsMcpStrictRouting: vi.fn(() => false),
  mockParseMcpTextBlocks: vi.fn((payload: { content?: Array<{ text?: string }> }) =>
    Array.isArray(payload.content) ? payload.content.map((entry) => String(entry?.text || '').trim()).filter(Boolean) : []),
}));

vi.mock('./obsidianLoreSyncService', () => ({
  runObsidianLoreSyncOnce: mockRunObsidianLoreSyncOnce,
}));

vi.mock('./obsidianQualityService', () => ({
  runObsidianGraphAuditOnce: mockRunObsidianGraphAuditOnce,
  getLatestObsidianGraphAuditSnapshot: mockGetLatestObsidianGraphAuditSnapshot,
}));

vi.mock('../skills/actions/mcpDelegate', () => ({
  callMcpWorkerTool: mockCallMcpWorkerTool,
  getMcpWorkerUrl: mockGetMcpWorkerUrl,
  isMcpStrictRouting: mockIsMcpStrictRouting,
  parseMcpTextBlocks: mockParseMcpTextBlocks,
}));

describe('obsidianMaintenanceControlService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR;
    delete process.env.OBSIDIAN_MAINTENANCE_STRICT_DELEGATION;
    mockRunObsidianLoreSyncOnce.mockResolvedValue({ lastStatus: 'success', lastSummary: 'sync ok' });
    mockRunObsidianGraphAuditOnce.mockResolvedValue({ lastStatus: 'success', lastSummary: 'audit ok' });
    mockGetLatestObsidianGraphAuditSnapshot.mockResolvedValue({ pass: true, totals: { files: 12 } });
  });

  it('exposes the canonical repo-runtime maintenance surface', async () => {
    const { getObsidianMaintenanceControlSurface } = await import('./obsidianMaintenanceControlService');

    expect(getObsidianMaintenanceControlSurface()).toEqual({
      executor: 'repo-runtime',
      tasks: ['lore-sync', 'graph-audit'],
      delegation: {
        preferredExecutor: 'repo-runtime',
        fallbackExecutor: 'repo-runtime',
        workerKind: 'operate',
        workerConfigured: false,
        strict: false,
      },
    });
  });

  it('runs lore sync through the canonical maintenance facade', async () => {
    const { executeObsidianLoreSync } = await import('./obsidianMaintenanceControlService');

    await expect(executeObsidianLoreSync()).resolves.toMatchObject({ lastStatus: 'success' });
    expect(mockRunObsidianLoreSyncOnce).toHaveBeenCalledTimes(1);
  });

  it('delegates lore sync to the operate worker when configured', async () => {
    process.env.OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR = 'operate-worker';
    mockGetMcpWorkerUrl.mockReturnValue('https://worker.example');
    mockCallMcpWorkerTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ lastStatus: 'success', lastSummary: 'delegated sync ok' }) }],
      isError: false,
    });

    const { executeObsidianLoreSync } = await import('./obsidianMaintenanceControlService');

    await expect(executeObsidianLoreSync()).resolves.toMatchObject({
      lastStatus: 'success',
      lastSummary: 'delegated sync ok',
    });
    expect(mockCallMcpWorkerTool).toHaveBeenCalledWith({
      workerUrl: 'https://worker.example',
      toolName: 'obsidian.sync.run',
      args: {},
    });
    expect(mockRunObsidianLoreSyncOnce).not.toHaveBeenCalled();
  });

  it('falls back to repo runtime when the operate worker is unavailable and delegation is not strict', async () => {
    process.env.OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR = 'operate-worker';
    mockGetMcpWorkerUrl.mockReturnValue('');

    const { executeObsidianLoreSync } = await import('./obsidianMaintenanceControlService');

    await expect(executeObsidianLoreSync()).resolves.toMatchObject({ lastStatus: 'success' });
    expect(mockRunObsidianLoreSyncOnce).toHaveBeenCalledTimes(1);
  });

  it('runs graph audit and returns the refreshed snapshot through the canonical maintenance facade', async () => {
    const { executeObsidianGraphAudit } = await import('./obsidianMaintenanceControlService');

    await expect(executeObsidianGraphAudit()).resolves.toMatchObject({
      result: { lastStatus: 'success' },
      snapshot: { pass: true, totals: { files: 12 } },
    });
    expect(mockRunObsidianGraphAuditOnce).toHaveBeenCalledTimes(1);
    expect(mockGetLatestObsidianGraphAuditSnapshot).toHaveBeenCalledTimes(1);
  });

  it('forces local execution when requested so MCP run tools do not recurse back into worker delegation', async () => {
    process.env.OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR = 'operate-worker';
    mockGetMcpWorkerUrl.mockReturnValue('https://worker.example');

    const { executeObsidianGraphAudit } = await import('./obsidianMaintenanceControlService');

    await expect(executeObsidianGraphAudit({ forceLocal: true })).resolves.toMatchObject({
      result: { lastStatus: 'success' },
    });
    expect(mockCallMcpWorkerTool).not.toHaveBeenCalled();
    expect(mockRunObsidianGraphAuditOnce).toHaveBeenCalledTimes(1);
  });
});
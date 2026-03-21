import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeToolByNameMock, getToolRuntimeStatusMock } = vi.hoisted(() => ({
  executeToolByNameMock: vi.fn(),
  getToolRuntimeStatusMock: vi.fn(),
}));

vi.mock('../../tools/toolRouter', () => ({
  executeToolByName: executeToolByNameMock,
  getToolRuntimeStatus: getToolRuntimeStatusMock,
}));

import { toolsRunCliAction } from './tools';

describe('toolsRunCliAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToolRuntimeStatusMock.mockReturnValue({
      enabled: true,
      configured: true,
      tools: [{
        name: 'local.cli',
        description: 'Configured local CLI tool',
        adapterId: 'script-cli',
        commandConfigured: true,
        available: true,
        argsTemplate: ['{goal}'],
        timeoutMs: 15000,
        maxOutputChars: 2000,
      }],
      issues: [],
    });
  });

  it('returns delegated CLI execution result with openjarvis routing', async () => {
    executeToolByNameMock.mockResolvedValue({
      ok: true,
      toolName: 'local.cli',
      summary: 'CLI tool local.cli executed successfully',
      artifacts: ['[stdout] ok'],
      verification: ['adapter:script-cli'],
      durationMs: 12,
      adapterId: 'script-cli',
      exitCode: 0,
    });

    const result = await toolsRunCliAction.execute({
      goal: 'run a safe task',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      args: { toolName: 'local.cli', mode: 'summary' },
    });

    expect(executeToolByNameMock).toHaveBeenCalledWith({
      toolName: 'local.cli',
      goal: 'run a safe task',
      args: { toolName: 'local.cli', mode: 'summary' },
      guildId: 'guild-1',
      requestedBy: 'user-1',
    });
    expect(result.ok).toBe(true);
    expect(result.agentRole).toBe('openjarvis');
    expect(result.artifacts[0]).toBe('tool:local.cli');
    expect(result.verification).toContain('registry_configured:true');
  });

  it('rejects empty goal before execution', async () => {
    const result = await toolsRunCliAction.execute({
      goal: '   ',
    });

    expect(executeToolByNameMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('TOOLS_RUN_CLI_GOAL_EMPTY');
  });

  it('propagates CLI execution failure', async () => {
    executeToolByNameMock.mockResolvedValue({
      ok: false,
      toolName: 'local.cli',
      summary: 'No configured CLI tool is available.',
      artifacts: ['LOCAL_CLI_TOOL_ENABLED=false'],
      verification: ['registry lookup failed'],
      error: 'LOCAL_CLI_TOOL_NOT_CONFIGURED',
      durationMs: 0,
      adapterId: 'script-cli',
      exitCode: null,
    });

    const result = await toolsRunCliAction.execute({
      goal: 'run unavailable tool',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('LOCAL_CLI_TOOL_NOT_CONFIGURED');
    expect(result.artifacts).toContain('LOCAL_CLI_TOOL_ENABLED=false');
  });
});
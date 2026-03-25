import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runDelegatedActionMock, executeExternalActionMock } = vi.hoisted(() => ({
  runDelegatedActionMock: vi.fn(),
  executeExternalActionMock: vi.fn(),
}));

vi.mock('./mcpDelegatedAction', () => ({
  runDelegatedAction: runDelegatedActionMock,
}));

vi.mock('../../tools/externalAdapterRegistry', () => ({
  executeExternalAction: executeExternalActionMock,
}));

import { opencodeExecuteAction } from './opencode';

describe('opencodeExecuteAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runDelegatedActionMock.mockResolvedValue(null);
    executeExternalActionMock.mockResolvedValue({ ok: false, output: [] });
  });

  it('rejects long non-sprint tasks with the default limit', async () => {
    const result = await opencodeExecuteAction.execute({
      goal: 'x'.repeat(2401),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('OPENCODE_TASK_TOO_LONG');
    expect(result.summary).toContain('max=2400');
  });

  it('accepts longer sprint tasks before delegation guardrails apply', async () => {
    const result = await opencodeExecuteAction.execute({
      goal: `[SPRINT]\n${'x'.repeat(3000)}`,
    });

    expect(result.error).not.toBe('OPENCODE_TASK_TOO_LONG');
  });

  it('still rejects sprint tasks above the sprint-specific limit', async () => {
    const result = await opencodeExecuteAction.execute({
      goal: `[SPRINT]\n${'x'.repeat(12001)}`,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('OPENCODE_TASK_TOO_LONG');
    expect(result.summary).toContain('max=12000');
  });

  it('does not trip the dangerous-command guard on sprint metadata outside the objective', async () => {
    const result = await opencodeExecuteAction.execute({
      goal: '[SPRINT] demo\n[OBJECTIVE] Update docs wording only.\n[PHASE_INSTRUCTIONS]\nDo not run git reset --hard or rm -rf.',
    });

    expect(result.error).not.toBe('OPENCODE_DANGEROUS_COMMAND_BLOCKED');
  });
});

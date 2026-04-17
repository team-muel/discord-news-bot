import { describe, expect, it, vi } from 'vitest';

import { evaluateActionGovernanceGate } from './actionRunnerGovernance';

describe('evaluateActionGovernanceGate', () => {
  it('passes through fast-path actions without loading governance policy', async () => {
    const getGuildActionPolicy = vi.fn();

    const result = await evaluateActionGovernanceGate({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'lookup docs',
      actionName: 'web.search',
      actionArgs: { q: 'docs' },
      fastPath: true,
    }, { getGuildActionPolicy });

    expect(result).toEqual({ proceed: true });
    expect(getGuildActionPolicy).not.toHaveBeenCalled();
  });

  it('returns unavailable block when governance lookup throws', async () => {
    const result = await evaluateActionGovernanceGate({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'run risky action',
      actionName: 'implement.execute',
      actionArgs: {},
      fastPath: false,
    }, {
      getGuildActionPolicy: vi.fn().mockRejectedValue(new Error('db offline')),
    });

    expect(result).toMatchObject({
      proceed: false,
      handledAny: false,
      error: 'ACTION_POLICY_UNAVAILABLE',
      lineStatus: '상태: 실패 (ACTION_POLICY_UNAVAILABLE)',
    });
  });

  it('returns disabled block when the guild policy disables the action', async () => {
    const result = await evaluateActionGovernanceGate({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'run risky action',
      actionName: 'implement.execute',
      actionArgs: {},
      fastPath: false,
    }, {
      getGuildActionPolicy: vi.fn().mockResolvedValue({ enabled: false, runMode: 'disabled' } as never),
    });

    expect(result).toMatchObject({
      proceed: false,
      handledAny: false,
      error: 'ACTION_DISABLED_BY_POLICY',
      lineStatus: '상태: 실패 (ACTION_DISABLED_BY_POLICY)',
    });
  });

  it('creates approval requests for high-risk auto actions', async () => {
    const createActionApprovalRequest = vi.fn().mockResolvedValue({ id: 'approval-1' });

    const result = await evaluateActionGovernanceGate({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'delete guild data',
      actionName: 'implement.execute',
      actionArgs: { dangerous: true },
      fastPath: false,
    }, {
      getGuildActionPolicy: vi.fn().mockResolvedValue({ enabled: true, runMode: 'auto' } as never),
      createActionApprovalRequest,
    });

    expect(createActionApprovalRequest).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      proceed: false,
      handledAny: true,
      error: 'ACTION_APPROVAL_REQUIRED',
      lineStatus: '상태: 승인 대기 (requestId=approval-1)',
      artifacts: ['approval-1'],
    });
  });
});
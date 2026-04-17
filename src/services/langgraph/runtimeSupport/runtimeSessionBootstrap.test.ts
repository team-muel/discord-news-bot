import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkflowStepTemplates: vi.fn(),
  primeWorkflowProfileCache: vi.fn(),
}));

vi.mock('../../agent/agentWorkflowService', () => ({
  getWorkflowStepTemplates: mocks.getWorkflowStepTemplates,
  primeWorkflowProfileCache: mocks.primeWorkflowProfileCache,
}));

describe('runtimeSessionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizeAgentPriority는 한국어/영문 priority를 표준화한다', async () => {
    const { normalizeAgentPriority } = await import('./runtimeSessionBootstrap');

    expect(normalizeAgentPriority('빠름')).toBe('fast');
    expect(normalizeAgentPriority('precise')).toBe('precise');
    expect(normalizeAgentPriority('unknown')).toBe('balanced');
  });

  it('buildInitialSessionSteps는 workflow template을 취소 규칙과 함께 step으로 바꾼다', async () => {
    const randomUuid = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-1111-1111-111111111111')
      .mockReturnValueOnce('22222222-2222-2222-2222-222222222222')
      .mockReturnValueOnce('33333333-3333-3333-3333-333333333333');
    mocks.getWorkflowStepTemplates.mockReturnValue([
      { role: 'planner', title: 'plan', skipWhenRequestedSkill: true },
      { role: 'researcher', title: 'research', skipWhenFast: true },
      { role: 'critic', title: 'critique' },
    ]);

    const { buildInitialSessionSteps } = await import('./runtimeSessionBootstrap');
    const steps = buildInitialSessionSteps({
      guildId: 'guild-1',
      requestedSkillId: 'qa',
      priority: 'fast',
      timestamp: '2026-04-16T00:00:00.000Z',
    });

    expect(mocks.primeWorkflowProfileCache).toHaveBeenCalledTimes(1);
    expect(mocks.getWorkflowStepTemplates).toHaveBeenCalledWith({
      guildId: 'guild-1',
      priority: 'fast',
      hasRequestedSkill: true,
    });
    expect(steps).toMatchObject([
      {
        id: '11111111-1111-1111-1111-111111111111',
        role: 'planner',
        title: '스킬 실행: qa',
        status: 'cancelled',
        endedAt: '2026-04-16T00:00:00.000Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        role: 'researcher',
        title: 'research',
        status: 'cancelled',
        endedAt: '2026-04-16T00:00:00.000Z',
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        role: 'critic',
        title: 'critique',
        status: 'pending',
        endedAt: null,
      },
    ]);
    randomUuid.mockRestore();
  });

  it('createQueuedSession는 queued session 기본 골격을 만든다', async () => {
    const randomUuid = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      .mockReturnValueOnce('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    mocks.getWorkflowStepTemplates.mockReturnValue([
      { role: 'planner', title: 'plan' },
    ]);

    const { createQueuedSession } = await import('./runtimeSessionBootstrap');
    const session = createQueuedSession({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: '  refine the answer  ',
      requestedSkillId: null,
      priority: 'balanced',
      timestamp: '2026-04-16T00:01:00.000Z',
      deliberationMode: 'guarded',
    });

    expect(session).toMatchObject({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'refine the answer',
      priority: 'balanced',
      status: 'queued',
      deliberationMode: 'guarded',
      riskScore: 55,
      policyGate: {
        decision: 'review',
        reasons: ['privacy_guarded_default'],
      },
      trafficRoute: 'main',
      executionEngine: 'main',
      hitlState: null,
    });
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    randomUuid.mockRestore();
  });
});
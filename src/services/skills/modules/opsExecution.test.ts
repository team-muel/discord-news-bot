import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunGoalPipeline, mockRunSkillText } = vi.hoisted(() => ({
  mockRunGoalPipeline: vi.fn(),
  mockRunSkillText: vi.fn(),
}));

vi.mock('../actionRunner', () => ({
  runGoalPipeline: mockRunGoalPipeline,
}));

vi.mock('./common', () => ({
  runSkillText: mockRunSkillText,
}));

import { executeOpsExecutionSkill } from './opsExecution';
import { buildActionReflectionArtifact } from '../actions/types';

const emptyDiagnostics = {
  totalFailures: 0,
  missingAction: 0,
  policyBlocked: 0,
  governanceUnavailable: 0,
  finopsBlocked: 0,
  externalFailures: 0,
  unknownFailures: 0,
};

describe('executeOpsExecutionSkill', () => {
  beforeEach(() => {
    mockRunGoalPipeline.mockReset();
    mockRunSkillText.mockReset();
  });

  it('action runner reflection outcome를 skill outcome으로 승격한다', async () => {
    const reflection = buildActionReflectionArtifact({
      plane: 'record',
      concern: 'guild-memory',
      nextPath: 'guilds/123/Guild_Lore.md',
      customerImpact: false,
    });
    mockRunGoalPipeline.mockResolvedValue({
      handled: true,
      output: '요청 결과',
      hasSuccess: true,
      externalUnavailable: false,
      diagnostics: emptyDiagnostics,
      actionResults: [{
        ok: true,
        name: 'obsidian.guild_doc.upsert',
        summary: '저장 완료',
        artifacts: [reflection],
        verification: [],
      }],
    });

    const result = await executeOpsExecutionSkill({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: '길드 문서를 저장해줘',
    });

    expect(result.output).toBe('요청 결과');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        state: 'success',
        code: 'OK',
        reflection: expect.objectContaining({
          concern: 'guild-memory',
          nextPath: 'guilds/123/Guild_Lore.md',
        }),
      }),
    ]);
    expect(mockRunGoalPipeline).toHaveBeenCalledWith(expect.objectContaining({
      runtimeLane: 'public-guild',
    }));
  });

  it('반성 fallback 경로에서도 action outcome을 유지한다', async () => {
    mockRunGoalPipeline.mockResolvedValue({
      handled: true,
      output: '실패 로그',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics: {
        ...emptyDiagnostics,
        totalFailures: 1,
        policyBlocked: 1,
      },
      actionResults: [{
        ok: false,
        name: 'db.supabase.read',
        summary: '권한 없음',
        artifacts: [],
        verification: ['action allowlist policy block'],
        error: 'ACTION_NOT_ALLOWED',
      }],
    });
    mockRunSkillText.mockResolvedValue('반성 응답');

    const result = await executeOpsExecutionSkill({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: '권한 상태를 확인해줘',
    });

    expect(result.output).toBe('반성 응답');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        state: 'failure',
        code: 'ACTION_NOT_ALLOWED',
      }),
    ]);
    expect(mockRunGoalPipeline).toHaveBeenCalledWith(expect.objectContaining({
      runtimeLane: 'public-guild',
    }));
  });
});
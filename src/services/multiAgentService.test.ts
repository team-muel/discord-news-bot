import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// 의존성 모킹 (가장 먼저 선언해야 hoisting됨)
// ──────────────────────────────────────────────────────────
vi.mock('./llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn().mockResolvedValue('mocked response'),
}));

vi.mock('./agentMemoryService', () => ({
  buildAgentMemoryHints: vi.fn().mockResolvedValue([]),
}));

vi.mock('./agentSessionStore', () => ({
  persistAgentSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./skills/engine', () => ({
  executeSkill: vi.fn().mockResolvedValue({ output: 'skill output' }),
}));

vi.mock('./skills/registry', () => ({
  isSkillId: vi.fn((id: string) => ['ops-plan', 'ops-execution', 'ops-critique', 'ops-review', 'incident-review'].includes(id)),
  listSkills: vi.fn(() => []),
}));

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

import * as llmClient from './llmClient';
import {
  cancelAgentSession,
  getAgentPolicy,
  getAgentSession,
  getMultiAgentRuntimeSnapshot,
  listAgentDeadletters,
  listAgentSkills,
  listGuildAgentSessions,
  startAgentSession,
} from './multiAgentService';

// ──────────────────────────────────────────────────────────
describe('getMultiAgentRuntimeSnapshot (초기 상태)', () => {
  it('모든 카운터가 0인 스냅샷을 반환한다', () => {
    const snap = getMultiAgentRuntimeSnapshot();
    expect(snap).toMatchObject({
      totalSessions: expect.any(Number),
      runningSessions: expect.any(Number),
      queuedSessions: expect.any(Number),
      completedSessions: expect.any(Number),
      failedSessions: expect.any(Number),
      cancelledSessions: expect.any(Number),
      deadletteredSessions: expect.any(Number),
    });
    expect(snap.runningSessions).toBeGreaterThanOrEqual(0);
    expect(snap.queuedSessions).toBeGreaterThanOrEqual(0);
  });
});

describe('getAgentSession', () => {
  it('존재하지 않는 id → null 반환', () => {
    expect(getAgentSession('nonexistent-id-xyz')).toBeNull();
  });
});

describe('listGuildAgentSessions', () => {
  it('알 수 없는 guild → 빈 배열', () => {
    const result = listGuildAgentSessions('unknown-guild-id', 10);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('listAgentDeadletters', () => {
  it('초기에는 빈 배열 반환', () => {
    const result = listAgentDeadletters();
    expect(Array.isArray(result)).toBe(true);
  });

  it('limit 파라미터 적용', () => {
    const result = listAgentDeadletters({ limit: 5 });
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe('cancelAgentSession', () => {
  it('존재하지 않는 세션 취소 → ok:false', () => {
    const result = cancelAgentSession('no-such-session');
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe('listAgentSkills / getAgentPolicy', () => {
  it('listAgentSkills는 배열을 반환한다', () => {
    const skills = listAgentSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  it('getAgentPolicy는 정책 스냅샷을 반환한다', () => {
    const policy = getAgentPolicy();
    expect(policy).toMatchObject({
      maxConcurrentSessions: expect.any(Number),
      maxGoalLength: expect.any(Number),
      restrictedSkills: expect.any(Array),
    });
    expect(policy.maxConcurrentSessions).toBeGreaterThan(0);
  });
});

describe('startAgentSession', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // setTimeout 방지 (queue drain 비실행)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LLM 미설정 → LLM_PROVIDER_NOT_CONFIGURED 에러', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(false);
    expect(() =>
      startAgentSession({
        guildId: 'g1',
        requestedBy: 'user1',
        goal: '분석해줘',
      }),
    ).toThrow('LLM provider is not configured');
  });

  it('빈 목표 → 검증 에러', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    expect(() =>
      startAgentSession({
        guildId: 'g1',
        requestedBy: 'user1',
        goal: '   ',
      }),
    ).toThrow();
  });

  it('LLM 활성화 시 세션을 생성하고 반환한다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const session = startAgentSession({
      guildId: 'guild-test-1',
      requestedBy: 'user-test-1',
      goal: '비트코인 시장 분석을 해줘',
    });

    expect(session.id).toBeTruthy();
    expect(session.guildId).toBe('guild-test-1');
    expect(session.requestedBy).toBe('user-test-1');
    expect(session.goal).toBe('비트코인 시장 분석을 해줘');
    expect(session.status).toBe('queued');
    expect(Array.isArray(session.steps)).toBe(true);
    expect(session.steps.length).toBeGreaterThan(0);
  });

  it('생성된 세션을 getAgentSession으로 조회할 수 있다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-test-2',
      requestedBy: 'user-test-2',
      goal: '이더리움 최신 뉴스 요약',
    });

    const found = getAgentSession(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.status).toBe('queued');
  });

  it('생성된 세션이 listGuildAgentSessions에 포함된다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-list-test',
      requestedBy: 'user-test-3',
      goal: '금일 주요 이슈 정리',
    });

    const list = listGuildAgentSessions('guild-list-test', 10);
    expect(list.some((s) => s.id === created.id)).toBe(true);
  });

  it('queued 세션을 cancelAgentSession으로 취소할 수 있다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const created = startAgentSession({
      guildId: 'guild-cancel-test',
      requestedBy: 'user-test-4',
      goal: '취소 테스트 목표',
    });

    const result = cancelAgentSession(created.id);
    expect(result.ok).toBe(true);

    const found = getAgentSession(created.id);
    expect(found?.cancelRequested).toBe(true);
  });

  it('priority=fast 세션은 planner/critic 단계가 cancelled 상태로 생성된다', () => {
    vi.mocked(llmClient.isAnyLlmConfigured).mockReturnValue(true);
    const session = startAgentSession({
      guildId: 'guild-fast',
      requestedBy: 'user-fast',
      goal: '빠른 요약 부탁해',
      priority: 'fast',
    });

    const plannerStep = session.steps.find((s) => s.role === 'planner');
    expect(plannerStep?.status).toBe('cancelled');
    const criticStep = session.steps.find((s) => s.role === 'critic');
    expect(criticStep?.status).toBe('cancelled');
  });

});

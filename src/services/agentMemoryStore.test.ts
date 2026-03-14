import { beforeEach, describe, expect, it, vi } from 'vitest';

// ──────────────────────────────────────────────────────────
// Supabase 체인 목(mock) 팩토리
// 모든 메서드는 self를 반환하고, self 자체가 PromiseLike → await 가능
// ──────────────────────────────────────────────────────────
const makeChain = (resolveValue: { data?: unknown; error?: unknown }) => {
  const self: any = {
    // PromiseLike: await chain 또는 await chain.method(...) 모두 resolveValue로 해석
    then: (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(resolveValue).catch(reject),
    finally: (cb: any) => Promise.resolve(resolveValue).finally(cb),
  };
  const methods = [
    'select', 'eq', 'neq', 'in', 'or', 'order', 'limit',
    'single', 'not', 'gte', 'lte', 'insert', 'upsert',
    'update', 'delete', 'filter', 'is', 'ilike', 'like',
  ];
  for (const m of methods) {
    self[m] = vi.fn().mockReturnValue(self);
  }
  return self;
};

const makeMockClient = (chainResult: { data?: unknown; error?: unknown }) => ({
  from: vi.fn(() => makeChain(chainResult)),
});

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

import * as supabaseClient from './supabaseClient';
import {
  isMemoryType,
  isFeedbackAction,
  isConflictStatus,
  isMemoryJobType,
  searchGuildMemory,
  createMemoryItem,
} from './agentMemoryStore';

// ──────────────────────────────────────────────────────────
describe('타입 가드 (순수 함수)', () => {
  describe('isMemoryType', () => {
    it('유효한 타입 → true', () => {
      expect(isMemoryType('episode')).toBe(true);
      expect(isMemoryType('semantic')).toBe(true);
      expect(isMemoryType('policy')).toBe(true);
      expect(isMemoryType('preference')).toBe(true);
    });
    it('무효한 값 → false', () => {
      expect(isMemoryType('invalid')).toBe(false);
      expect(isMemoryType('')).toBe(false);
      expect(isMemoryType('EPISODE')).toBe(false);
    });
  });

  describe('isFeedbackAction', () => {
    it('유효한 액션 → true', () => {
      expect(isFeedbackAction('pin')).toBe(true);
      expect(isFeedbackAction('unpin')).toBe(true);
      expect(isFeedbackAction('edit')).toBe(true);
      expect(isFeedbackAction('deprecate')).toBe(true);
      expect(isFeedbackAction('approve')).toBe(true);
      expect(isFeedbackAction('reject')).toBe(true);
    });
    it('무효한 값 → false', () => {
      expect(isFeedbackAction('delete')).toBe(false);
      expect(isFeedbackAction('')).toBe(false);
    });
  });

  describe('isConflictStatus', () => {
    it('유효한 상태 → true', () => {
      expect(isConflictStatus('open')).toBe(true);
      expect(isConflictStatus('resolved')).toBe(true);
      expect(isConflictStatus('ignored')).toBe(true);
    });
    it('무효한 값 → false', () => {
      expect(isConflictStatus('closed')).toBe(false);
      expect(isConflictStatus('')).toBe(false);
    });
  });

  describe('isMemoryJobType', () => {
    it('유효한 jobType → true', () => {
      expect(isMemoryJobType('short_summary')).toBe(true);
      expect(isMemoryJobType('topic_synthesis')).toBe(true);
      expect(isMemoryJobType('durable_extraction')).toBe(true);
      expect(isMemoryJobType('reindex')).toBe(true);
      expect(isMemoryJobType('conflict_scan')).toBe(true);
      expect(isMemoryJobType('onboarding_snapshot')).toBe(true);
    });
    it('무효한 값 → false', () => {
      expect(isMemoryJobType('unknown_job')).toBe(false);
      expect(isMemoryJobType('')).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────
describe('searchGuildMemory', () => {
  beforeEach(() => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(supabaseClient.getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    });
  });

  it('Supabase 미설정 → SUPABASE_NOT_CONFIGURED 에러', async () => {
    await expect(
      searchGuildMemory({ guildId: 'g1', query: 'test', limit: 5 }),
    ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });

  it('쿼리 에러 → MEMORY_SEARCH_FAILED', async () => {
    const chain = makeChain({ data: null, error: { message: 'db error' } });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    await expect(
      searchGuildMemory({ guildId: 'g1', query: 'test', limit: 5 }),
    ).rejects.toThrow('db error');
  });

  it('결과 없음 → 빈 items 반환', async () => {
    const chain = makeChain({ data: [], error: null });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    // 쿼리 없이 호출해야 or() 분기를 타지 않음
    const result = await searchGuildMemory({ guildId: 'g1', query: '', limit: 5 });
    expect(result.items).toHaveLength(0);
    expect(result.meta.requestedTopK).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────
describe('createMemoryItem', () => {
  it('Supabase 미설정 → SUPABASE_NOT_CONFIGURED 에러', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(supabaseClient.getSupabaseClient).mockImplementation(() => {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    });

    await expect(
      createMemoryItem({
        guildId: 'g1',
        type: 'semantic',
        content: '테스트 내용',
        actorId: 'user-123',
      }),
    ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });

  it('insert 성공 → data 반환', async () => {
    const fakeRow = { id: 'mem_abc', guild_id: 'g1', type: 'semantic', content: '이것은 최소 20자를 넘는 정상적인 내용입니다.' };
    const chain = makeChain({ data: fakeRow, error: null });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    const result = await createMemoryItem({
      guildId: 'g1',
      type: 'semantic',
      content: '이것은 최소 20자를 넘는 정상적인 내용입니다.',
      actorId: 'user-123',
    });
    expect(result).toEqual(fakeRow);
  });

  it('insert 에러 → 에러 메시지 throw', async () => {
    const chain = makeChain({ data: null, error: { message: 'insert failed' } });
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue(
      { from: vi.fn(() => chain) } as any,
    );

    await expect(
      createMemoryItem({
        guildId: 'g1',
        type: 'semantic',
        content: '이것은 최소 20자를 넘는 에러 케이스 내용입니다.',
        actorId: 'user-123',
      }),
    ).rejects.toThrow('insert failed');
  });
});

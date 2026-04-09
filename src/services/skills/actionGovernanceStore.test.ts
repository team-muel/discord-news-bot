import { describe, it, expect, vi, beforeEach } from 'vitest';

// Supabase 미설정 환경(인메모리 폴백) 기준으로 테스트
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('supabase not configured'); },
}));

import {
  isActionRunMode,
  getGuildActionPolicy,
  upsertGuildActionPolicy,
  listGuildActionPolicies,
} from './actionGovernanceStore';

describe('isActionRunMode', () => {
  it.each(['auto', 'approval_required', 'disabled'])('%s 는 유효한 run_mode 이다', (mode) => {
    expect(isActionRunMode(mode)).toBe(true);
  });

  it.each(['enabled', 'OPEN', '', 'random'])('%s 는 유효하지 않다', (mode) => {
    expect(isActionRunMode(mode)).toBe(false);
  });
});

describe('getGuildActionPolicy (in-memory fallback, no Supabase)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('등록되지 않은 정책은 기본값을 반환한다', async () => {
    const policy = await getGuildActionPolicy('guild-x', 'nonexistent.action');
    expect(policy.guildId).toBe('guild-x');
    expect(policy.actionName).toBe('nonexistent.action');
    // ACTION_POLICY_DEFAULT_ENABLED 기본값: true
    expect(typeof policy.enabled).toBe('boolean');
    expect(['auto', 'approval_required', 'disabled']).toContain(policy.runMode);
  });

  it('빈 guildId/actionName은 기본 정책을 반환한다', async () => {
    const p1 = await getGuildActionPolicy('', 'action.foo');
    const p2 = await getGuildActionPolicy('guild-1', '');
    expect(p1.guildId).toBe('');
    expect(p2.actionName).toBe('');
  });
});

describe('upsertGuildActionPolicy + getGuildActionPolicy (in-memory)', () => {
  it('upsert 후 getGuildActionPolicy로 조회가 가능하다', async () => {
    await upsertGuildActionPolicy({
      guildId: 'guild-policy-1',
      actionName: 'web.search',
      enabled: false,
      runMode: 'disabled',
      actorId: 'admin-1',
    });

    const result = await getGuildActionPolicy('guild-policy-1', 'web.search');
    expect(result.enabled).toBe(false);
    expect(result.runMode).toBe('disabled');
    expect(result.updatedBy).toBe('admin-1');
  });

  it('정책을 업데이트하면 최신 값이 반영된다', async () => {
    await upsertGuildActionPolicy({
      guildId: 'guild-policy-2',
      actionName: 'news.search',
      enabled: false,
      runMode: 'disabled',
      actorId: 'admin-1',
    });

    await upsertGuildActionPolicy({
      guildId: 'guild-policy-2',
      actionName: 'news.search',
      enabled: true,
      runMode: 'auto',
      actorId: 'admin-2',
    });

    const result = await getGuildActionPolicy('guild-policy-2', 'news.search');
    expect(result.enabled).toBe(true);
    expect(result.runMode).toBe('auto');
    expect(result.updatedBy).toBe('admin-2');
  });

  it('legacy executor key를 저장해도 canonical action name으로 조회된다', async () => {
    await upsertGuildActionPolicy({
      guildId: 'guild-policy-3',
      actionName: 'opencode.execute',
      enabled: false,
      runMode: 'disabled',
      actorId: 'admin-3',
    });

    const result = await getGuildActionPolicy('guild-policy-3', 'implement.execute');
    expect(result.actionName).toBe('implement.execute');
    expect(result.enabled).toBe(false);
    expect(result.runMode).toBe('disabled');
  });
});

describe('listGuildActionPolicies (in-memory)', () => {
  it('등록된 정책만 해당 guild에서 조회된다', async () => {
    await upsertGuildActionPolicy({
      guildId: 'guild-list-1',
      actionName: 'action.A',
      enabled: true,
      runMode: 'auto',
      actorId: 'actor',
    });
    await upsertGuildActionPolicy({
      guildId: 'guild-list-1',
      actionName: 'action.B',
      enabled: false,
      runMode: 'disabled',
      actorId: 'actor',
    });

    const all = await listGuildActionPolicies('guild-list-1');
    const names = all.map((p) => p.actionName);
    expect(names).toContain('action.A');
    expect(names).toContain('action.B');
  });

  it('다른 guild의 정책이 포함되지 않는다', async () => {
    await upsertGuildActionPolicy({
      guildId: 'guild-list-X',
      actionName: 'action.X',
      enabled: true,
      runMode: 'auto',
      actorId: 'actor',
    });

    const list = await listGuildActionPolicies('guild-list-OTHER');
    const names = list.map((p) => p.actionName);
    expect(names).not.toContain('action.X');
  });

  it('빈 guildId는 빈 배열을 반환한다', async () => {
    const result = await listGuildActionPolicies('');
    expect(result).toEqual([]);
  });
});

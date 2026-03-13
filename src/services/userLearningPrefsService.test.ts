import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Supabase와 network는 모두 모킹 처리
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('supabase not configured'); },
}));

import { isUserLearningEnabled, setUserLearningEnabled } from './userLearningPrefsService';

describe('userLearningPrefsService (in-memory fallback)', () => {
  const userId = 'user-001';
  const guildId = 'guild-001';

  beforeEach(() => {
    // 각 테스트 전에 모듈 캐시 초기화
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('기본값은 true이다', async () => {
    const enabled = await isUserLearningEnabled('new-user', 'new-guild');
    expect(enabled).toBe(true);
  });

  it('비활성화 후 false를 반환한다', async () => {
    await setUserLearningEnabled(userId, guildId, false, 'actor');
    const enabled = await isUserLearningEnabled(userId, guildId);
    expect(enabled).toBe(false);
  });

  it('다시 활성화하면 true를 반환한다', async () => {
    await setUserLearningEnabled(userId, guildId, false, 'actor');
    await setUserLearningEnabled(userId, guildId, true, 'actor');
    const enabled = await isUserLearningEnabled(userId, guildId);
    expect(enabled).toBe(true);
  });

  it('다른 guild의 설정은 독립적이다', async () => {
    await setUserLearningEnabled(userId, 'guild-A', false, 'actor');
    const resultA = await isUserLearningEnabled(userId, 'guild-A');
    const resultB = await isUserLearningEnabled(userId, 'guild-B');
    expect(resultA).toBe(false);
    expect(resultB).toBe(true);
  });
});

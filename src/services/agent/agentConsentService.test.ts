import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

import * as supabaseClient from '../supabaseClient';
import { __resetConsentMemoryForTests, getUserConsentSnapshot, upsertUserConsentSnapshot } from './agentConsentService';

describe('agentConsentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConsentMemoryForTests();
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
  });

  it('기본 consent snapshot을 반환한다', async () => {
    const snapshot = await getUserConsentSnapshot({ guildId: 'guild-1', userId: 'user-1' });
    expect(snapshot.guildId).toBe('guild-1');
    expect(snapshot.userId).toBe('user-1');
    expect(snapshot.source).toBe('default');
  });

  it('in-memory upsert 후 같은 snapshot을 읽을 수 있다', async () => {
    await upsertUserConsentSnapshot({
      guildId: 'guild-1',
      userId: 'user-1',
      memoryEnabled: false,
      socialGraphEnabled: false,
      profilingEnabled: false,
      updatedBy: 'admin-1',
    });

    const snapshot = await getUserConsentSnapshot({ guildId: 'guild-1', userId: 'user-1' });
    expect(snapshot).toMatchObject({
      guildId: 'guild-1',
      userId: 'user-1',
      memoryEnabled: false,
      socialGraphEnabled: false,
      profilingEnabled: false,
      updatedBy: 'admin-1',
      source: 'stored',
    });
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import {
  upsertDiscordLoginSession,
  purgeExpiredDiscordLoginSessions,
  getDiscordLoginSessionExpiryMs,
} from './discordLoginSessionStore';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockDeleteChain = {
  lt: vi.fn().mockReturnThis(),
  select: vi.fn().mockResolvedValue({ data: [], error: null }),
};
const mockSelectChain = {
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
};
const mockFrom = vi.fn((table: string) => {
  if (table === 'discord_login_sessions') {
    return {
      upsert: mockUpsert,
      delete: vi.fn(() => mockDeleteChain),
      select: vi.fn(() => mockSelectChain),
    };
  }
  return {};
});
const mockClient = { from: mockFrom };

beforeEach(() => {
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getSupabaseClient).mockReturnValue(mockClient as any);
  mockUpsert.mockClear().mockResolvedValue({ error: null });
  mockDeleteChain.lt.mockClear().mockReturnThis();
  mockDeleteChain.select.mockClear().mockResolvedValue({ data: [], error: null });
  mockSelectChain.eq.mockClear().mockReturnThis();
  mockSelectChain.limit.mockClear().mockResolvedValue({ data: [], error: null });
  mockFrom.mockClear();
});

describe('upsertDiscordLoginSession', () => {
  it('inserts a session and returns true', async () => {
    const result = await upsertDiscordLoginSession({
      guildId: 'g1', userId: 'u1', expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(result).toBe(true);
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('returns false when supabase not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const result = await upsertDiscordLoginSession({
      guildId: 'g1', userId: 'u1', expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(result).toBe(false);
  });

  it('throws when upsert returns error', async () => {
    mockUpsert.mockResolvedValue({ error: new Error('db_error') });
    await expect(
      upsertDiscordLoginSession({ guildId: 'g1', userId: 'u1', expiresAt: '2099-01-01T00:00:00Z' }),
    ).rejects.toThrow('db_error');
  });
});

describe('purgeExpiredDiscordLoginSessions', () => {
  it('returns 0 when no expired sessions', async () => {
    const count = await purgeExpiredDiscordLoginSessions();
    expect(count).toBe(0);
  });

  it('returns 0 when supabase not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const count = await purgeExpiredDiscordLoginSessions();
    expect(count).toBe(0);
  });
});

describe('getDiscordLoginSessionExpiryMs', () => {
  it('returns null when no session found', async () => {
    const result = await getDiscordLoginSessionExpiryMs({ guildId: 'g1', userId: 'u1' });
    expect(result).toBeNull();
  });

  it('returns null when supabase not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const result = await getDiscordLoginSessionExpiryMs({ guildId: 'g1', userId: 'u1' });
    expect(result).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import {
  trackUserActivity,
  getUserProfile,
  getGuildMembership,
  getUserCrmSnapshot,
  getGuildLeaderboard,
  updateUserProfileMeta,
  __test,
} from './userCrmService';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.fn();
const mockClient = { rpc: mockRpc, from: mockFrom };

beforeEach(() => {
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getSupabaseClient).mockReturnValue(mockClient as any);
  __test.resetFlushTimer();
  mockRpc.mockClear();
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockFrom.mockReset();
});

afterEach(() => {
  __test.resetFlushTimer();
});

describe('trackUserActivity', () => {
  it('buffers activity and flushes via RPC', async () => {
    trackUserActivity({
      userId: '123456789012345678',
      guildId: '987654321012345678',
      counter: 'message_count',
    });

    expect(__test.pendingBuffer.size).toBe(1);

    await __test.flushActivityBuffer();

    expect(mockRpc).toHaveBeenCalledWith('track_user_activity', {
      p_user_id: '123456789012345678',
      p_guild_id: '987654321012345678',
      p_counter: 'message_count',
      p_delta: 1,
    });
    expect(__test.pendingBuffer.size).toBe(0);
  });

  it('merges duplicate buffer entries by incrementing delta', () => {
    trackUserActivity({
      userId: '123456789012345678',
      guildId: '987654321012345678',
      counter: 'message_count',
    });
    trackUserActivity({
      userId: '123456789012345678',
      guildId: '987654321012345678',
      counter: 'message_count',
    });

    expect(__test.pendingBuffer.size).toBe(1);
    const entry = [...__test.pendingBuffer.values()][0];
    expect(entry.delta).toBe(2);
  });

  it('ignores invalid Discord IDs', () => {
    trackUserActivity({
      userId: 'invalid',
      guildId: '987654321012345678',
      counter: 'message_count',
    });

    expect(__test.pendingBuffer.size).toBe(0);
  });

  it('clears buffer when Supabase is not configured', async () => {
    __test.resetFlushTimer();
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);

    trackUserActivity({
      userId: '123456789012345678',
      guildId: '987654321012345678',
      counter: 'command_count',
    });

    expect(__test.pendingBuffer.size).toBe(1);
    await __test.flushActivityBuffer();
    expect(__test.pendingBuffer.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('getUserProfile', () => {
  it('returns mapped profile from Supabase', async () => {
    const mockRow = {
      user_id: '123456789012345678',
      badges: ['early_adopter'],
      tags: ['vip'],
      metadata: { note: 'test' },
      first_seen_at: '2026-01-01T00:00:00Z',
      last_active_at: '2026-04-04T00:00:00Z',
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });

    const profile = await getUserProfile('123456789012345678');
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe('123456789012345678');
    expect(profile!.badges).toEqual(['early_adopter']);
    expect(profile!.tags).toEqual(['vip']);
  });

  it('returns null for missing user', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const profile = await getUserProfile('999999999999999999');
    expect(profile).toBeNull();
  });

  it('returns null when Supabase is not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const profile = await getUserProfile('123456789012345678');
    expect(profile).toBeNull();
  });
});

describe('getGuildMembership', () => {
  it('returns mapped membership from Supabase', async () => {
    const mockRow = {
      guild_id: '987654321012345678',
      user_id: '123456789012345678',
      message_count: 42,
      command_count: 5,
      reaction_given_count: 10,
      reaction_received_count: 8,
      session_count: 3,
      first_seen_at: '2026-02-01T00:00:00Z',
      last_active_at: '2026-04-04T00:00:00Z',
    };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
          }),
        }),
      }),
    });

    const membership = await getGuildMembership('987654321012345678', '123456789012345678');
    expect(membership).not.toBeNull();
    expect(membership!.messageCount).toBe(42);
    expect(membership!.commandCount).toBe(5);
  });
});

describe('getUserCrmSnapshot', () => {
  it('returns null when profile does not exist', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const snapshot = await getUserCrmSnapshot('999999999999999999', '987654321012345678');
    expect(snapshot).toBeNull();
  });
});

describe('getGuildLeaderboard', () => {
  it('returns empty array when Supabase is not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const board = await getGuildLeaderboard('987654321012345678');
    expect(board).toEqual([]);
  });
});

describe('updateUserProfileMeta', () => {
  it('returns false when Supabase is not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    const ok = await updateUserProfileMeta('123456789012345678', { badges: ['test'] });
    expect(ok).toBe(false);
  });

  it('calls update with correct payload', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: updateMock });

    const ok = await updateUserProfileMeta('123456789012345678', {
      badges: ['early'],
      tags: ['vip'],
    });
    expect(ok).toBe(true);
    expect(updateMock).toHaveBeenCalled();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.badges).toEqual(['early']);
    expect(payload.tags).toEqual(['vip']);
  });
});

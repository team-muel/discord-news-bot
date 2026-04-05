import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

vi.mock('../../logger', () => ({
  default: { warn: vi.fn(), error: vi.fn() },
}));

import { acquireDistributedLease, releaseDistributedLease } from './distributedLockService';
import { isSupabaseConfigured } from '../supabaseClient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('acquireDistributedLease', () => {
  it('returns SUPABASE_NOT_CONFIGURED when Supabase is off', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    const result = await acquireDistributedLease({ name: 'test', owner: 'a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: false, reason: 'SUPABASE_NOT_CONFIGURED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('acquires lock when RPC returns true', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const result = await acquireDistributedLease({ name: 'lock-1', owner: 'owner-a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('acquire_distributed_lease', {
      p_name: 'lock-1',
      p_owner: 'owner-a',
      p_lease_ms: 10_000,
    });
  });

  it('returns LOCK_HELD when RPC returns false', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    const result = await acquireDistributedLease({ name: 'lock-1', owner: 'owner-a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: false, reason: 'LOCK_HELD' });
  });

  it('enforces minimum 5s lease', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await acquireDistributedLease({ name: 'lock-1', owner: 'a', leaseMs: 100 });
    expect(mockRpc).toHaveBeenCalledWith('acquire_distributed_lease', expect.objectContaining({
      p_lease_ms: 5_000,
    }));
  });

  it('falls back to legacy when RPC function is missing', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function acquire_distributed_lease does not exist' },
    });

    // Legacy path: UPDATE succeeds (returns data)
    const selectMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [{ name: 'lock-1' }], error: null }) });
    const orMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqMock = vi.fn().mockReturnValue({ or: orMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    mockFrom.mockReturnValue({ update: updateMock });

    const result = await acquireDistributedLease({ name: 'lock-1', owner: 'owner-a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('distributed_locks');
  });

  it('falls back to legacy INSERT when UPDATE returns 0 rows', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });

    // Legacy path: UPDATE returns empty, INSERT succeeds
    const selectMock = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const orMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqMock = vi.fn().mockReturnValue({ or: orMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation(() => ({
      update: updateMock,
      insert: insertMock,
    }));

    const result = await acquireDistributedLease({ name: 'lock-2', owner: 'owner-b', leaseMs: 10_000 });
    expect(result).toEqual({ ok: true });
  });

  it('returns LOCK_TABLE_UNAVAILABLE on missing table error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42P01', message: 'relation distributed_locks does not exist' },
    });

    const result = await acquireDistributedLease({ name: 'lock-1', owner: 'a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: false, reason: 'LOCK_TABLE_UNAVAILABLE' });
  });

  it('returns LOCK_ERROR on unexpected errors', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'SOME', message: 'unexpected error' },
    });

    const result = await acquireDistributedLease({ name: 'lock-1', owner: 'a', leaseMs: 10_000 });
    expect(result).toEqual({ ok: false, reason: 'LOCK_ERROR' });
  });
});

describe('releaseDistributedLease', () => {
  it('skips when Supabase is not configured', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);
    await releaseDistributedLease({ name: 'lock-1', owner: 'a' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('releases lock by clearing owner_token and expires_at', async () => {
    const eqOwnerMock = vi.fn().mockResolvedValue({ error: null });
    const eqNameMock = vi.fn().mockReturnValue({ eq: eqOwnerMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqNameMock });
    mockFrom.mockReturnValue({ update: updateMock });

    await releaseDistributedLease({ name: 'lock-1', owner: 'owner-a' });
    expect(mockFrom).toHaveBeenCalledWith('distributed_locks');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      owner_token: null,
      expires_at: null,
    }));
  });
});

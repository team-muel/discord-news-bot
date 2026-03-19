import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import * as supabaseClient from './supabaseClient';
import {
  getMemoryJobQueueStats,
  getMemoryJobRunnerStats,
  listMemoryJobDeadletters,
  requeueDeadletterJob,
  startMemoryJobRunner,
  stopMemoryJobRunner,
} from './memoryJobRunner';

// ──────────────────────────────────────────────────────────
describe('getMemoryJobRunnerStats (초기 상태)', () => {
  it('필수 필드를 포함한 객체를 반환한다', () => {
    const stats = getMemoryJobRunnerStats();
    expect(stats).toMatchObject({
      enabled: expect.any(Boolean),
      inFlight: expect.any(Boolean),
      recoveryInFlight: expect.any(Boolean),
      pollIntervalMs: expect.any(Number),
      maxRetries: expect.any(Number),
      backoffBaseMs: expect.any(Number),
      backoffMaxMs: expect.any(Number),
      deadletterAutoRecoveryEnabled: expect.any(Boolean),
      deadletterRecoveryIntervalMs: expect.any(Number),
      deadletterRecoveryBatchSize: expect.any(Number),
      deadletterMaxRecoveryAttempts: expect.any(Number),
      processed: expect.any(Number),
      succeeded: expect.any(Number),
      failed: expect.any(Number),
    });
  });

  it('pollIntervalMs는 최소 5000ms 이상이다', () => {
    const stats = getMemoryJobRunnerStats();
    expect(stats.pollIntervalMs).toBeGreaterThanOrEqual(5000);
  });

  it('maxRetries는 최소 1 이상이다', () => {
    const stats = getMemoryJobRunnerStats();
    expect(stats.maxRetries).toBeGreaterThanOrEqual(1);
  });
});

// ──────────────────────────────────────────────────────────
describe('startMemoryJobRunner / stopMemoryJobRunner', () => {
  beforeEach(() => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
  });
  afterEach(() => {
    stopMemoryJobRunner();
  });

  it('Supabase 미설정 시 startMemoryJobRunner는 에러 없이 조기 반환한다', () => {
    expect(() => startMemoryJobRunner()).not.toThrow();
  });

  it('stopMemoryJobRunner는 타이머가 없어도 에러 없이 실행된다', () => {
    expect(() => stopMemoryJobRunner()).not.toThrow();
  });

  it('중복 start 호출 시에도 에러가 발생하지 않는다', () => {
    expect(() => {
      startMemoryJobRunner();
      startMemoryJobRunner();
    }).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────
describe('getMemoryJobQueueStats', () => {
  it('Supabase 미설정 → 모든 카운터 0인 객체 반환 (에러 없음)', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    const stats = await getMemoryJobQueueStats();
    expect(stats).toMatchObject({
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
      retryScheduled: 0,
      deadlettered: 0,
      queueLagP50Sec: 0,
      queueLagP95Sec: 0,
      oldestQueuedSec: 0,
      total: 0,
    });
  });

  it('guildId 파라미터 있어도 Supabase 미설정이면 zeros 반환', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    const stats = await getMemoryJobQueueStats('guild-123');
    expect(stats.total).toBe(0);
  });

  it('Supabase 설정 시 status/lag/deadletter 집계를 계산한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const rows = [
      {
        status: 'queued',
        created_at: '2026-03-19T23:59:30.000Z',
        next_attempt_at: '2026-03-20T00:00:30.000Z',
        deadlettered_at: null,
      },
      {
        status: 'queued',
        created_at: '2026-03-19T23:58:00.000Z',
        next_attempt_at: '2026-03-19T23:58:30.000Z',
        deadlettered_at: null,
      },
      {
        status: 'running',
        created_at: '2026-03-19T23:57:00.000Z',
        next_attempt_at: null,
        deadlettered_at: null,
      },
      {
        status: 'failed',
        created_at: '2026-03-19T23:56:00.000Z',
        next_attempt_at: null,
        deadlettered_at: '2026-03-19T23:56:30.000Z',
      },
      {
        status: 'completed',
        created_at: '2026-03-19T23:55:00.000Z',
        next_attempt_at: null,
        deadlettered_at: null,
      },
      {
        status: 'canceled',
        created_at: '2026-03-19T23:54:00.000Z',
        next_attempt_at: null,
        deadlettered_at: null,
      },
    ];

    const query = {
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      data: rows,
      error: null,
    } as any;
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    const stats = await getMemoryJobQueueStats('guild-a');

    expect(stats).toMatchObject({
      queued: 2,
      running: 1,
      completed: 1,
      failed: 1,
      canceled: 1,
      retryScheduled: 1,
      deadlettered: 1,
      total: 6,
      queueLagP50Sec: 30,
      queueLagP95Sec: 120,
      oldestQueuedSec: 120,
    });
    expect(query.eq).toHaveBeenCalledWith('guild_id', 'guild-a');
  });
});

// ──────────────────────────────────────────────────────────
describe('listMemoryJobDeadletters', () => {
  it('Supabase 미설정 → SUPABASE_NOT_CONFIGURED 에러', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    await expect(listMemoryJobDeadletters({ limit: 10 })).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });

  it('deadletter error 문자열을 errorCode로 정규화한다', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const rows = [
      {
        id: 1,
        job_id: 'j-1',
        guild_id: 'g-1',
        job_type: 'durable_extraction',
        attempts: 3,
        error: 'QUERY_FAILED: timeout',
        failed_at: '2026-03-20T00:00:00.000Z',
        created_at: '2026-03-20T00:00:00.000Z',
      },
      {
        id: 2,
        job_id: 'j-2',
        guild_id: 'g-1',
        job_type: 'durable_extraction',
        attempts: 1,
        error: 'unknown runtime crash',
        failed_at: '2026-03-20T00:00:01.000Z',
        created_at: '2026-03-20T00:00:01.000Z',
      },
    ];

    const query = {
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    } as any;
    const select = vi.fn().mockReturnValue(query);
    const from = vi.fn().mockReturnValue({ select });

    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    const result = await listMemoryJobDeadletters({ guildId: 'g-1', limit: 10 });
    expect(result[0].errorCode).toBe('QUERY_FAILED');
    expect(result[1].errorCode).toBe('RUNTIME_ERROR');
  });
});

// ──────────────────────────────────────────────────────────
describe('requeueDeadletterJob', () => {
  it('deadletter가 없으면 DEADLETTER_NOT_FOUND를 반환한다', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const deadletterQuery = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any;
    const from = vi.fn((table: string) => {
      if (table === 'memory_job_deadletters') {
        return { select: vi.fn(() => deadletterQuery) };
      }
      return {};
    });
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    await expect(requeueDeadletterJob({ deadletterId: 999, actorId: 'admin-1' })).rejects.toThrow('DEADLETTER_NOT_FOUND');
  });

  it('이미 requeued 상태면 DEADLETTER_ALREADY_REQUEUED를 반환한다', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const deadletterRows = [{
      id: 10,
      job_id: 'mjob_10',
      guild_id: 'g-1',
      job_type: 'short_summary',
      input: {},
      recovery_status: 'requeued',
      recovery_attempts: 1,
    }];

    const deadletterQuery = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: deadletterRows, error: null }),
    } as any;
    const from = vi.fn((table: string) => {
      if (table === 'memory_job_deadletters') {
        return { select: vi.fn(() => deadletterQuery) };
      }
      return {};
    });
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    await expect(requeueDeadletterJob({ deadletterId: 10, actorId: 'admin-1' })).rejects.toThrow('DEADLETTER_ALREADY_REQUEUED');
  });

  it('기존 job update 실패 시 deadletter recovery_status를 갱신하고 에러를 던진다', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const deadletterRows = [{
      id: 20,
      job_id: 'mjob_20',
      guild_id: 'g-1',
      job_type: 'short_summary',
      input: {},
      recovery_status: 'pending',
      recovery_attempts: 2,
    }];

    const deadletterSelectQuery = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: deadletterRows, error: null }),
    } as any;

    const deadletterUpdate = vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    }));

    const memoryJobsUpdateQuery = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: { message: 'UPDATE_FAIL' } }),
    } as any;

    const from = vi.fn((table: string) => {
      if (table === 'memory_job_deadletters') {
        return {
          select: vi.fn(() => deadletterSelectQuery),
          update: deadletterUpdate,
        };
      }

      if (table === 'memory_jobs') {
        return {
          update: vi.fn(() => memoryJobsUpdateQuery),
        };
      }

      return {};
    });

    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    await expect(requeueDeadletterJob({ deadletterId: 20, actorId: 'admin-1' })).rejects.toThrow('UPDATE_FAIL');
    expect(deadletterUpdate).toHaveBeenCalledWith(expect.objectContaining({
      recovery_attempts: 3,
      recovery_status: 'ignored',
      last_recovery_error: 'UPDATE_FAIL',
    }));
  });

  it('new job insert 실패 시 deadletter recovery_status를 pending으로 갱신한다', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(true);

    const deadletterRows = [{
      id: 30,
      job_id: '',
      guild_id: 'g-1',
      job_type: 'short_summary',
      input: {},
      recovery_status: 'pending',
      recovery_attempts: 0,
    }];

    const deadletterSelectQuery = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: deadletterRows, error: null }),
    } as any;

    const deadletterUpdate = vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    }));

    const memoryJobsInsert = vi.fn(async () => ({ error: { message: 'INSERT_FAIL' } }));

    const from = vi.fn((table: string) => {
      if (table === 'memory_job_deadletters') {
        return {
          select: vi.fn(() => deadletterSelectQuery),
          update: deadletterUpdate,
        };
      }

      if (table === 'memory_jobs') {
        return {
          insert: memoryJobsInsert,
        };
      }

      return {};
    });

    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({ from } as any);

    await expect(requeueDeadletterJob({ deadletterId: 30, actorId: 'admin-1' })).rejects.toThrow('INSERT_FAIL');
    expect(deadletterUpdate).toHaveBeenCalledWith(expect.objectContaining({
      recovery_attempts: 1,
      recovery_status: 'pending',
      last_recovery_error: 'INSERT_FAIL',
    }));
  });
});

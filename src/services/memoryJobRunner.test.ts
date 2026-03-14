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
      total: 0,
    });
  });

  it('guildId 파라미터 있어도 Supabase 미설정이면 zeros 반환', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    const stats = await getMemoryJobQueueStats('guild-123');
    expect(stats.total).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────
describe('listMemoryJobDeadletters', () => {
  it('Supabase 미설정 → SUPABASE_NOT_CONFIGURED 에러', async () => {
    vi.mocked(supabaseClient.isSupabaseConfigured).mockReturnValue(false);
    await expect(listMemoryJobDeadletters({ limit: 10 })).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
  });
});

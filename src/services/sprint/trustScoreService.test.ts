import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub config before import
vi.mock('../../config', () => ({
  TRUST_ENGINE_ENABLED: true,
  TRUST_MAX_AUTONOMY_LEVEL: 'approve-ship',
  TRUST_BUGFIX_THRESHOLD: 0.7,
  TRUST_FEATURE_THRESHOLD: 0.85,
  TRUST_DEFAULT_SCORE: 0.35,
  TRUST_CACHE_TTL_MS: 60_000,
  TRUST_DECAY_DAILY_RATE: 0.01,
  TRUST_DECAY_INACTIVE_DAYS: 7,
  TRUST_LOOP_BREAKER_ENABLED: true,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
}));

vi.mock('../infra/baseRepository', () => ({
  getClient: () => null,
  fromTable: () => null,
}));

import {
  evaluateLoopBreaker,
  isLoopBreakerEnabled,
  runTrustDecayCycle,
  startTrustDecayTimer,
  stopTrustDecayTimer,
  __resetTrustCacheForTests,
} from './trustScoreService';

describe('trustScoreService — Phase H', () => {
  beforeEach(() => {
    __resetTrustCacheForTests();
  });

  afterEach(() => {
    stopTrustDecayTimer();
  });

  describe('loopBreaker', () => {
    it('isLoopBreakerEnabled returns true when config is set', () => {
      expect(isLoopBreakerEnabled()).toBe(true);
    });

    it('stage 1: bump temperature for loopCount < 5', () => {
      const action = evaluateLoopBreaker('sprint-1', 3);
      expect(action.stage).toBe(1);
      expect(action.action).toBe('bump-temperature');
      expect(action.temperatureDelta).toBe(0.2);
      expect(action.shouldBlock).toBe(false);
    });

    it('stage 2: switch strategy for loopCount 5-6', () => {
      const action = evaluateLoopBreaker('sprint-2', 5);
      expect(action.stage).toBe(2);
      expect(action.action).toBe('switch-strategy');
      expect(action.newStrategy).toBe('least-to-most');
      expect(action.shouldBlock).toBe(false);
    });

    it('stage 3: block sprint for loopCount >= 7', () => {
      const action = evaluateLoopBreaker('sprint-3', 7);
      expect(action.stage).toBe(3);
      expect(action.action).toBe('block-sprint');
      expect(action.shouldBlock).toBe(true);
    });

    it('increments loop counter automatically when loopCount not provided', () => {
      evaluateLoopBreaker('sprint-inc');      // 1
      evaluateLoopBreaker('sprint-inc');      // 2
      const a3 = evaluateLoopBreaker('sprint-inc'); // 3
      expect(a3.stage).toBe(1);
      expect(a3.action).toBe('bump-temperature');
    });
  });

  describe('trustDecay', () => {
    it('returns zero counts when Supabase is not configured', async () => {
      const result = await runTrustDecayCycle();
      expect(result).toEqual({ decayed: 0, skipped: 0 });
    });

    it('startTrustDecayTimer does not throw', () => {
      expect(() => startTrustDecayTimer()).not.toThrow();
      stopTrustDecayTimer();
    });

    it('stopTrustDecayTimer is idempotent', () => {
      stopTrustDecayTimer();
      stopTrustDecayTimer();
    });
  });
});

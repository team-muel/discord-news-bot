import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config BEFORE importing modules
vi.mock('../../config', () => ({
  OBSERVER_ENABLED: true,
  OBSERVER_SCAN_INTERVAL_MS: 60_000,
  OBSERVER_ERROR_PATTERN_ENABLED: true,
  OBSERVER_ERROR_PATTERN_MIN_FREQUENCY: 2,
  OBSERVER_MEMORY_GAP_ENABLED: false,
  OBSERVER_MEMORY_GAP_STALE_HOURS: 48,
  OBSERVER_PERF_DRIFT_ENABLED: false,
  OBSERVER_PERF_DRIFT_THRESHOLD_PCT: 20,
  OBSERVER_CODE_HEALTH_ENABLED: false,
  OBSERVER_CONVERGENCE_DIGEST_ENABLED: false,
  OBSERVER_DISCORD_PULSE_ENABLED: false,
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: vi.fn(),
}));

vi.mock('../runtime/signalBus', () => ({
  emitSignal: vi.fn(() => true),
}));

vi.mock('../sprint/sprintTriggers', () => ({
  getRecentErrors: vi.fn(() => [
    { message: 'Connection timeout', at: new Date().toISOString(), code: 'CONN_TIMEOUT' },
    { message: 'Connection timeout again', at: new Date().toISOString(), code: 'CONN_TIMEOUT' },
    { message: 'Auth failed', at: new Date().toISOString(), code: 'AUTH_FAIL' },
  ]),
}));

import {
  runObserverScan,
  registerChannel,
  getObserverStats,
  __resetObserverForTests,
} from './observerOrchestrator';
import { __resetObservationStoreForTests, getFallbackBufferSnapshot } from './observationStore';
import { emitSignal } from '../runtime/signalBus';
import errorPatternChannel from './errorPatternChannel';

describe('Observer Layer', () => {
  beforeEach(() => {
    __resetObserverForTests();
    __resetObservationStoreForTests();
    vi.clearAllMocks();
  });

  describe('observerOrchestrator', () => {
    it('should run scan with registered channels and produce observations', async () => {
      registerChannel(errorPatternChannel);

      const result = await runObserverScan('test-guild');

      expect(result.guildId).toBe('test-guild');
      expect(result.totalObservations).toBeGreaterThan(0);
      expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.byChannel['error-pattern']).toBeGreaterThan(0);
    });

    it('should emit signals for observations', async () => {
      registerChannel(errorPatternChannel);

      await runObserverScan('test-guild');

      expect(emitSignal).toHaveBeenCalledWith(
        'observation.new',
        'observer',
        'test-guild',
        expect.objectContaining({ count: expect.any(Number) }),
      );
    });

    it('should dedup identical observations within 10 minutes', async () => {
      registerChannel(errorPatternChannel);

      const result1 = await runObserverScan('test-guild');
      const result2 = await runObserverScan('test-guild');

      // Second scan should be deduped
      expect(result2.totalObservations).toBe(0);
      expect(result1.totalObservations).toBeGreaterThan(0);
    });

    it('should track stats correctly', async () => {
      registerChannel(errorPatternChannel);

      const statsBefore = getObserverStats();
      expect(statsBefore.totalScans).toBe(0);

      await runObserverScan('test-guild');

      const statsAfter = getObserverStats();
      expect(statsAfter.totalScans).toBe(1);
      expect(statsAfter.lastScanAt).not.toBeNull();
    });

    it('should skip disabled channels', async () => {
      registerChannel({ kind: 'memory-gap', enabled: false, scan: vi.fn() });

      const result = await runObserverScan('test-guild');

      expect(result.totalObservations).toBe(0);
    });
  });

  describe('errorPatternChannel', () => {
    it('should cluster errors by code and detect patterns', async () => {
      const result = await errorPatternChannel.scan('test-guild');

      expect(result.channelKind).toBe('error-pattern');
      expect(result.observations.length).toBeGreaterThan(0);

      const connTimeout = result.observations.find((o) => o.title.includes('CONN_TIMEOUT'));
      expect(connTimeout).toBeDefined();
      expect(connTimeout!.severity).toBe('warning');
    });

    it('should not emit observations below frequency threshold', async () => {
      const { getRecentErrors } = await import('../sprint/sprintTriggers');
      vi.mocked(getRecentErrors).mockReturnValueOnce([
        { message: 'One-off error', at: new Date().toISOString(), code: 'SINGLE' },
      ]);

      const result = await errorPatternChannel.scan('test-guild');

      // Frequency 1 < threshold 2 — no observation
      expect(result.observations.length).toBe(0);
    });
  });

  describe('observationStore', () => {
    it('should buffer observations in memory when Supabase is unavailable', async () => {
      const { persistObservations } = await import('./observationStore');

      const count = await persistObservations([{
        guildId: 'test',
        channel: 'error-pattern',
        severity: 'warning',
        title: 'Test observation',
        payload: { test: true },
        detectedAt: new Date().toISOString(),
      }]);

      expect(count).toBe(1);
      expect(getFallbackBufferSnapshot()).toHaveLength(1);
    });

    it('should query from fallback buffer', async () => {
      const { persistObservations, getRecentObservations } = await import('./observationStore');

      await persistObservations([
        { guildId: 'g1', channel: 'error-pattern', severity: 'warning', title: 'A', payload: {}, detectedAt: new Date().toISOString() },
        { guildId: 'g1', channel: 'memory-gap', severity: 'info', title: 'B', payload: {}, detectedAt: new Date().toISOString() },
        { guildId: 'g2', channel: 'error-pattern', severity: 'critical', title: 'C', payload: {}, detectedAt: new Date().toISOString() },
      ]);

      const g1Only = await getRecentObservations({ guildId: 'g1' });
      expect(g1Only).toHaveLength(2);

      const warningsOnly = await getRecentObservations({ severity: 'warning' });
      expect(warningsOnly).toHaveLength(1);
    });
  });
});

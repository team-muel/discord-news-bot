/**
 * Observer Orchestrator — periodically scans all observation channels,
 * persists findings, and emits signals for critical observations.
 *
 * This is the central coordinator that:
 * 1. Runs registered channels at configurable intervals
 * 2. Deduplicates observations (same channel+title within cooldown)
 * 3. Persists to Supabase via observationStore
 * 4. Emits 'observation.new' and 'observation.critical' signals
 * 5. Exposes stats for health monitoring
 */

import logger from '../../logger';
import { OBSERVER_ENABLED, OBSERVER_SCAN_INTERVAL_MS } from '../../config';
import { emitSignal } from '../runtime/signalBus';
import { persistObservations } from './observationStore';
import type {
  Observation,
  ObservationChannel,
  ObservationChannelKind,
  ObserverScanResult,
  ObserverStats,
} from './observerTypes';

// ──── Channel Registry ────────────────────────────────────────────────────────

const channels: ObservationChannel[] = [];

export const registerChannel = (channel: ObservationChannel): void => {
  if (channels.some((c) => c.kind === channel.kind)) return;
  channels.push(channel);
};

// ──── Deduplication ───────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 10 * 60_000; // 10 minutes
const recentTitles = new Map<string, number>();

const isDuplicate = (obs: Observation): boolean => {
  const key = `${obs.guildId}:${obs.channel}:${obs.title}`;
  const lastSeen = recentTitles.get(key);
  if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) return true;
  recentTitles.set(key, Date.now());
  // Prune old entries
  if (recentTitles.size > 1000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, ts] of recentTitles) {
      if (ts < cutoff) recentTitles.delete(k);
    }
  }
  return false;
};

// ──── Stats ───────────────────────────────────────────────────────────────────

const stats: ObserverStats = {
  enabled: OBSERVER_ENABLED,
  lastScanAt: null,
  totalScans: 0,
  totalObservations: 0,
  channelStatus: {} as ObserverStats['channelStatus'],
};

export const getObserverStats = (): ObserverStats => ({ ...stats });

// ──── Scan Execution ──────────────────────────────────────────────────────────

export const runObserverScan = async (guildId: string): Promise<ObserverScanResult> => {
  const start = Date.now();
  const result: ObserverScanResult = {
    guildId,
    totalObservations: 0,
    byChannel: {} as Record<ObservationChannelKind, number>,
    bySeverity: { info: 0, warning: 0, critical: 0 },
    scanDurationMs: 0,
    errors: [],
  };

  const allObservations: Observation[] = [];

  for (const channel of channels) {
    if (!channel.enabled) continue;

    try {
      const channelResult = await channel.scan(guildId);

      // Initialize channel status tracking
      if (!stats.channelStatus[channel.kind]) {
        stats.channelStatus[channel.kind] = { enabled: channel.enabled, lastScanAt: null, errorCount: 0 };
      }
      stats.channelStatus[channel.kind].lastScanAt = new Date().toISOString();

      if (channelResult.error) {
        stats.channelStatus[channel.kind].errorCount++;
        result.errors.push(`${channel.kind}: ${channelResult.error}`);
      }

      // Dedup and collect
      for (const obs of channelResult.observations) {
        if (!isDuplicate(obs)) {
          allObservations.push(obs);
          result.bySeverity[obs.severity] = (result.bySeverity[obs.severity] || 0) + 1;
        }
      }

      result.byChannel[channel.kind] = channelResult.observations.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${channel.kind}: ${msg}`);
      logger.debug('[OBSERVER] channel %s scan failed: %s', channel.kind, msg);
    }
  }

  // Persist all observations
  if (allObservations.length > 0) {
    await persistObservations(allObservations);
    result.totalObservations = allObservations.length;

    // Emit signals for new observations
    emitSignal('observation.new', 'observer', guildId, {
      count: allObservations.length,
      channels: [...new Set(allObservations.map((o) => o.channel))],
    });

    // Emit critical signal for urgent observations
    const criticals = allObservations.filter((o) => o.severity === 'critical');
    if (criticals.length > 0) {
      emitSignal('observation.critical', 'observer', guildId, {
        count: criticals.length,
        titles: criticals.map((o) => o.title).slice(0, 5),
      });
    }
  }

  result.scanDurationMs = Date.now() - start;
  stats.lastScanAt = new Date().toISOString();
  stats.totalScans++;
  stats.totalObservations += result.totalObservations;

  if (result.totalObservations > 0) {
    logger.info(
      '[OBSERVER] scan complete: %d observations (%d critical, %d warning) in %dms',
      result.totalObservations,
      result.bySeverity.critical,
      result.bySeverity.warning,
      result.scanDurationMs,
    );
  }

  return result;
};

// ──── Scan Loop ───────────────────────────────────────────────────────────────

let scanInterval: ReturnType<typeof setInterval> | null = null;

export const startObserverLoop = (guildId = 'system'): void => {
  if (!OBSERVER_ENABLED || scanInterval) return;

  // Register all channels
  void loadAndRegisterChannels();

  scanInterval = setInterval(() => {
    void runObserverScan(guildId).catch((err) => {
      logger.debug('[OBSERVER] scan error: %s', err instanceof Error ? err.message : String(err));
    });
  }, OBSERVER_SCAN_INTERVAL_MS);

  // Run first scan after a short delay (let startup finish)
  setTimeout(() => {
    void runObserverScan(guildId).catch((err) => {
      logger.debug('[OBSERVER] initial scan error: %s', err instanceof Error ? err.message : String(err));
    });
  }, 30_000);

  logger.info('[OBSERVER] loop started (interval=%dms)', OBSERVER_SCAN_INTERVAL_MS);
};

export const stopObserverLoop = (): void => {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
};

// ──── Channel Auto-Loading ────────────────────────────────────────────────────

const loadAndRegisterChannels = async (): Promise<void> => {
  try {
    const { default: errorPattern } = await import('./errorPatternChannel');
    registerChannel(errorPattern);
  } catch (err) {
    logger.debug('[OBSERVER] errorPatternChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }

  try {
    const { default: memoryGap } = await import('./memoryGapChannel');
    registerChannel(memoryGap);
  } catch (err) {
    logger.debug('[OBSERVER] memoryGapChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }

  try {
    const { default: perfDrift } = await import('./perfDriftChannel');
    registerChannel(perfDrift);
  } catch (err) {
    logger.debug('[OBSERVER] perfDriftChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }

  try {
    const { default: codeHealth } = await import('./codeHealthChannel');
    registerChannel(codeHealth);
  } catch (err) {
    logger.debug('[OBSERVER] codeHealthChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }

  try {
    const { default: convergenceDigest } = await import('./convergenceDigestChannel');
    registerChannel(convergenceDigest);
  } catch (err) {
    logger.debug('[OBSERVER] convergenceDigestChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }

  try {
    const { default: discordPulse } = await import('./discordPulseChannel');
    registerChannel(discordPulse);
  } catch (err) {
    logger.debug('[OBSERVER] discordPulseChannel unavailable: %s', err instanceof Error ? err.message : String(err));
  }
};

/** Test-only reset */
export const __resetObserverForTests = (): void => {
  stopObserverLoop();
  channels.length = 0;
  recentTitles.clear();
  stats.lastScanAt = null;
  stats.totalScans = 0;
  stats.totalObservations = 0;
  stats.channelStatus = {} as ObserverStats['channelStatus'];
};

/**
 * State Snapshot Emitter — writes `.state/system-snapshot.json` periodically.
 *
 * Materializes live system state (observations, intents, worker health)
 * into a workspace file that IDE agents (Copilot, Cline) can read
 * before making implementation decisions.
 *
 * Called after each observer scan cycle. File is git-ignored.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

const STATE_DIR = path.resolve('.state');
const SNAPSHOT_PATH = path.join(STATE_DIR, 'system-snapshot.json');

export interface SystemSnapshot {
  generatedAt: string;
  recentObservations: Array<{
    channel: string;
    severity: string;
    title: string;
    detectedAt: string;
  }>;
  recentIntents: Array<{
    ruleId: string;
    objective: string;
    status: string;
    priorityScore: number;
  }>;
  observerStats: {
    totalScans: number;
    totalObservations: number;
    lastScanAt: string | null;
  };
}

/**
 * Emit a system state snapshot to `.state/system-snapshot.json`.
 * Best-effort — never throws.
 */
export async function emitStateSnapshot(guildId: string): Promise<void> {
  try {
    const { getRecentObservations } = await import('./observationStore');
    const { getIntents } = await import('../intent/intentStore');
    const { getObserverStats } = await import('./observerOrchestrator');

    const [observations, intents] = await Promise.all([
      getRecentObservations({ guildId, limit: 20 }),
      getIntents({ guildId, limit: 15 }),
    ]);

    const stats = getObserverStats();

    const snapshot: SystemSnapshot = {
      generatedAt: new Date().toISOString(),
      recentObservations: observations.map((o) => ({
        channel: o.channel,
        severity: o.severity,
        title: o.title,
        detectedAt: o.detectedAt,
      })),
      recentIntents: intents.map((i) => ({
        ruleId: i.ruleId,
        objective: i.objective,
        status: i.status,
        priorityScore: i.priorityScore,
      })),
      observerStats: {
        totalScans: stats.totalScans,
        totalObservations: stats.totalObservations,
        lastScanAt: stats.lastScanAt,
      },
    };

    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

    logger.debug(
      '[STATE-SNAPSHOT] emitted: %d observations, %d intents',
      snapshot.recentObservations.length,
      snapshot.recentIntents.length,
    );
  } catch (err) {
    logger.debug('[STATE-SNAPSHOT] emit failed: %s', getErrorMessage(err));
  }
}

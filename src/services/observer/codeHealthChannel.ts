/**
 * Code Health Channel — detects type-check errors and test failures
 * by running lightweight checks. Uses the same tooling as the
 * fast-path executors (tsc --noEmit, vitest) but only reads results,
 * never modifies code.
 *
 * Note: This channel is heavier than others because it spawns subprocesses.
 * Recommended scan interval: ≥30 minutes.
 */

import { execFile } from 'node:child_process';
import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  CodeHealthPayload,
} from './observerTypes';
import { OBSERVER_CODE_HEALTH_ENABLED } from '../../config';

const TSC_TIMEOUT_MS = 60_000;

const runTsc = (): Promise<{ errorCount: number; errors: string[] }> =>
  new Promise((resolve) => {
    execFile('npx', ['tsc', '--noEmit'], { timeout: TSC_TIMEOUT_MS, shell: true }, (err, _stdout, stderr) => {
      if (!err) {
        resolve({ errorCount: 0, errors: [] });
        return;
      }
      const output = stderr || _stdout || '';
      const errorLines = output.split('\n').filter((l) => l.includes('error TS'));
      resolve({ errorCount: errorLines.length, errors: errorLines.slice(0, 5) });
    });
  });

// Cache the last result to compute deltas
let lastTypeErrorCount: number | null = null;

const channel: ObservationChannel = {
  kind: 'code-health',
  enabled: OBSERVER_CODE_HEALTH_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    try {
      const tscResult = await runTsc();

      const previous = lastTypeErrorCount ?? tscResult.errorCount;
      const delta = tscResult.errorCount - previous;
      lastTypeErrorCount = tscResult.errorCount;

      if (tscResult.errorCount > 0) {
        const payload: CodeHealthPayload = {
          metric: 'type-errors',
          current: tscResult.errorCount,
          previous,
          delta,
          details: tscResult.errors,
        };
        observations.push({
          guildId,
          channel: 'code-health',
          severity: tscResult.errorCount > 10 ? 'critical' : delta > 0 ? 'warning' : 'info',
          title: `${tscResult.errorCount} TypeScript errors${delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta} since last scan)` : ''}`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      return { observations, channelKind: 'code-health', scanDurationMs: Date.now() - start, error: 'tsc scan failed' };
    }

    return { observations, channelKind: 'code-health', scanDurationMs: Date.now() - start };
  },
};

export default channel;

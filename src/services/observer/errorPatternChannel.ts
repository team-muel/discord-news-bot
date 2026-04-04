/**
 * Error Pattern Channel — clusters recent runtime errors and detects
 * repeated/escalating patterns. Reuses the existing error accumulator
 * from sprintTriggers rather than re-implementing collection.
 *
 * Reads from sprintTriggers' recent error window and groups by error code,
 * then emits observations for patterns that cross frequency thresholds.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  ErrorPatternPayload,
} from './observerTypes';
import { OBSERVER_ERROR_PATTERN_ENABLED, OBSERVER_ERROR_PATTERN_MIN_FREQUENCY } from '../../config';
import { getRecentErrors } from '../sprint/sprintTriggers';

const channel: ObservationChannel = {
  kind: 'error-pattern',
  enabled: OBSERVER_ERROR_PATTERN_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    try {
      const errors = getRecentErrors();
      if (errors.length === 0) {
        return { observations, channelKind: 'error-pattern', scanDurationMs: Date.now() - start };
      }

      // Group by error code
      const clusters = new Map<string, { messages: string[]; count: number; first: string; last: string }>();
      for (const err of errors) {
        const code = err.code || 'UNKNOWN';
        const existing = clusters.get(code);
        if (existing) {
          existing.count++;
          existing.messages.push(err.message);
          if (err.at > existing.last) existing.last = err.at;
        } else {
          clusters.set(code, { messages: [err.message], count: 1, first: err.at, last: err.at });
        }
      }

      for (const [code, cluster] of clusters) {
        if (cluster.count < OBSERVER_ERROR_PATTERN_MIN_FREQUENCY) continue;

        const payload: ErrorPatternPayload = {
          cluster: code,
          errorCodes: [code],
          frequency: cluster.count,
          windowMinutes: 10,
          trend: cluster.count >= OBSERVER_ERROR_PATTERN_MIN_FREQUENCY * 2 ? 'increasing' : 'stable',
          sampleMessages: cluster.messages.slice(0, 3).map((m) => m.slice(0, 200)),
        };

        observations.push({
          guildId,
          channel: 'error-pattern',
          severity: cluster.count >= OBSERVER_ERROR_PATTERN_MIN_FREQUENCY * 3 ? 'critical' : 'warning',
          title: `Error pattern: ${code} (${cluster.count}x in 10min)`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      return { observations, channelKind: 'error-pattern', scanDurationMs: Date.now() - start, error: 'scan failed' };
    }

    return { observations, channelKind: 'error-pattern', scanDurationMs: Date.now() - start };
  },
};

export default channel;

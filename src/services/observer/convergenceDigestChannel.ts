/**
 * Convergence Digest Channel — wraps the existing convergenceReport from
 * selfImprovementLoop into an Observation. Does NOT re-compute convergence;
 * instead reads the latest persisted report from agent_weekly_reports.
 *
 * This bridges existing infrastructure into the unified observer layer.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  ConvergenceDigestPayload,
} from './observerTypes';
import { OBSERVER_CONVERGENCE_DIGEST_ENABLED } from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import { fromTable } from '../infra/baseRepository';
import { T_AGENT_WEEKLY_REPORTS } from '../infra/tableRegistry';

const channel: ObservationChannel = {
  kind: 'convergence-digest',
  enabled: OBSERVER_CONVERGENCE_DIGEST_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    const qb = fromTable(T_AGENT_WEEKLY_REPORTS);
    if (!qb) {
      return { observations, channelKind: 'convergence-digest', scanDurationMs: Date.now() - start };
    }

    try {

      // Read latest convergence report (already computed by selfImprovementLoop)
      const { data } = await qb
        .select('payload, created_at')
        .eq('report_kind', 'convergence_report')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) {
        return { observations, channelKind: 'convergence-digest', scanDurationMs: Date.now() - start };
      }

      const report = data.payload as Record<string, unknown>;
      const verdict = (report.overallVerdict as string) || 'insufficient-data';

      if (verdict === 'degrading' || verdict === 'insufficient-data') {
        const payload: ConvergenceDigestPayload = {
          overallVerdict: verdict as ConvergenceDigestPayload['overallVerdict'],
          benchScoreTrend: (report.benchScoreTrend as string) || 'unknown',
          qualityScoreTrend: (report.qualityScoreTrend as string) || 'unknown',
          crossLoopSuccessRate: (report.crossLoopSuccessRate as number) ?? null,
          dataPoints: (report.dataPoints as number) ?? 0,
        };

        observations.push({
          guildId,
          channel: 'convergence-digest',
          severity: verdict === 'degrading' ? 'warning' : 'info',
          title: `System convergence: ${verdict}`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      return { observations, channelKind: 'convergence-digest', scanDurationMs: Date.now() - start, error: 'scan failed' };
    }

    return { observations, channelKind: 'convergence-digest', scanDurationMs: Date.now() - start };
  },
};

export default channel;

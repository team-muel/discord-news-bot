/**
 * Performance Drift Channel — detects LLM latency/cost/quality regressions
 * by reading existing weekly report data from agent_weekly_reports.
 *
 * Reuses data already produced by:
 *   - generate-llm-latency-weekly-report.mjs (report_kind: 'llm_latency_weekly')
 *   - summarize-go-no-go-runs.mjs (report_kind: 'go_no_go_weekly')
 *
 * No new data collection — pure observation of existing metrics.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  PerfDriftPayload,
} from './observerTypes';
import { OBSERVER_PERF_DRIFT_ENABLED, OBSERVER_PERF_DRIFT_THRESHOLD_PCT } from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

const channel: ObservationChannel = {
  kind: 'perf-drift',
  enabled: OBSERVER_PERF_DRIFT_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    if (!isSupabaseConfigured()) {
      return { observations, channelKind: 'perf-drift', scanDurationMs: Date.now() - start };
    }

    try {
      const sb = getSupabaseClient();

      // Fetch last 2 weekly LLM latency reports to compare
      const { data: reports } = await sb
        .from('agent_weekly_reports')
        .select('payload, created_at')
        .eq('report_kind', 'llm_latency_weekly')
        .order('created_at', { ascending: false })
        .limit(2);

      if (reports && reports.length >= 2) {
        const current = reports[0].payload as Record<string, unknown>;
        const previous = reports[1].payload as Record<string, unknown>;

        const currentSummary = current.candidate_summary as Record<string, number> | undefined;
        const previousSummary = previous.candidate_summary as Record<string, number> | undefined;

        if (currentSummary && previousSummary) {
          // P95 latency drift
          const curP95 = currentSummary.p95LatencyMs ?? 0;
          const prevP95 = previousSummary.p95LatencyMs ?? 0;
          if (prevP95 > 0) {
            const deltaPercent = ((curP95 - prevP95) / prevP95) * 100;
            if (Math.abs(deltaPercent) > OBSERVER_PERF_DRIFT_THRESHOLD_PCT) {
              const payload: PerfDriftPayload = {
                metric: 'p95_latency_ms',
                current: curP95,
                baseline: prevP95,
                deltaPercent,
                windowHours: 168,
              };
              observations.push({
                guildId,
                channel: 'perf-drift',
                severity: deltaPercent > OBSERVER_PERF_DRIFT_THRESHOLD_PCT * 2 ? 'critical' : 'warning',
                title: `LLM P95 latency ${deltaPercent > 0 ? 'increased' : 'decreased'} by ${Math.abs(deltaPercent).toFixed(1)}%`,
                payload,
                detectedAt: new Date().toISOString(),
              });
            }
          }

          // Success rate drift
          const curSuccess = currentSummary.successRatePct ?? 100;
          const prevSuccess = previousSummary.successRatePct ?? 100;
          if (prevSuccess > 0) {
            const deltaPercent = ((curSuccess - prevSuccess) / prevSuccess) * 100;
            if (curSuccess < 95 || deltaPercent < -OBSERVER_PERF_DRIFT_THRESHOLD_PCT) {
              const payload: PerfDriftPayload = {
                metric: 'success_rate',
                current: curSuccess,
                baseline: prevSuccess,
                deltaPercent,
                windowHours: 168,
              };
              observations.push({
                guildId,
                channel: 'perf-drift',
                severity: curSuccess < 90 ? 'critical' : 'warning',
                title: `LLM success rate dropped to ${curSuccess.toFixed(1)}% (was ${prevSuccess.toFixed(1)}%)`,
                payload,
                detectedAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch {
      return { observations, channelKind: 'perf-drift', scanDurationMs: Date.now() - start, error: 'scan failed' };
    }

    return { observations, channelKind: 'perf-drift', scanDurationMs: Date.now() - start };
  },
};

export default channel;

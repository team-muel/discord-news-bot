import { describe, it, expect } from 'vitest';
import { formatMetricReviewForDiscord, type MetricReviewSnapshot } from './metricReviewFormatter';

const SNAPSHOT: MetricReviewSnapshot = {
  krs: {
    'agent-quality': { label: 'KR1: 에이전트 응답 품질', health: 'on-track', signals: 2, topIssue: null },
    'system-reliability': { label: 'KR2: 시스템 안정성', health: 'at-risk', signals: 1, topIssue: 'SLO warn' },
    'operational-efficiency': { label: 'KR3: 운영 효율', health: 'no-data', signals: 0, topIssue: null },
  },
  convergence: { verdict: 'improving', benchTrend: 'improving', qualityTrend: 'stable', dataPoints: 12 },
  slo: { decision: 'warn', pass: 3, warn: 1, fail: 0 },
  sprint: { successRate: 85, scaffoldingRatio: 0.6, totalPipelines: 20 },
  gradient: { totalScore: 7.5, topPriority: 'Bench score regression', signalCount: 3 },
  generatedAt: '2026-04-04T12:00:00.000Z',
};

describe('metricReviewFormatter', () => {
  it('formats snapshot for Discord with KR lines and metrics', () => {
    const text = formatMetricReviewForDiscord(SNAPSHOT);
    expect(text).toContain('Metric Review');
    expect(text).toContain('KR1');
    expect(text).toContain('KR2');
    expect(text).toContain('on-track');
    expect(text).toContain('at-risk');
    expect(text).toContain('SLO');
    expect(text).toContain('스프린트');
    expect(text).toContain('85');
    expect(text).toContain('Bench score regression');
  });

  it('handles empty/null data gracefully', () => {
    const empty: MetricReviewSnapshot = {
      krs: {
        'agent-quality': { label: 'KR1', health: 'no-data', signals: 0, topIssue: null },
        'system-reliability': { label: 'KR2', health: 'no-data', signals: 0, topIssue: null },
        'operational-efficiency': { label: 'KR3', health: 'no-data', signals: 0, topIssue: null },
      },
      convergence: null,
      slo: null,
      sprint: null,
      gradient: null,
      generatedAt: '2026-04-04T12:00:00.000Z',
    };
    const text = formatMetricReviewForDiscord(empty);
    expect(text).toContain('Metric Review');
    expect(text).not.toContain('SLO');
    expect(text).not.toContain('스프린트');
  });
});

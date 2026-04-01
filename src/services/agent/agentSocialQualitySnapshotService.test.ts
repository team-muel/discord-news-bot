import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCommunityGraphOperationalSummary: vi.fn(),
  getAgentAnswerQualityReviewSummary: vi.fn(),
  buildGoNoGoReport: vi.fn(),
  buildAgentRuntimeReadinessReport: vi.fn(),
}));

vi.mock('../communityGraphService', () => ({
  getCommunityGraphOperationalSummary: mocks.getCommunityGraphOperationalSummary,
}));

vi.mock('./agentQualityReviewService', () => ({
  getAgentAnswerQualityReviewSummary: mocks.getAgentAnswerQualityReviewSummary,
}));

vi.mock('../goNoGoService', () => ({
  buildGoNoGoReport: mocks.buildGoNoGoReport,
}));

vi.mock('./agentRuntimeReadinessService', () => ({
  buildAgentRuntimeReadinessReport: mocks.buildAgentRuntimeReadinessReport,
}));

import { buildSocialQualityOperationalSnapshot } from './agentSocialQualitySnapshotService';

describe('agentSocialQualitySnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getCommunityGraphOperationalSummary.mockResolvedValue({
      guildId: 'g-1',
      days: 14,
      since: '2026-03-01T00:00:00.000Z',
      socialEventsIngested: 42,
      activeEdges: 8,
      activeActors: 12,
      latestEventAt: '2026-03-14T00:00:00.000Z',
      eventTypeCounts: { reply: 10, mention: 12, reaction: 15, co_presence: 5 },
      topEdges: [],
      generatedAt: '2026-03-14T00:00:00.000Z',
    });

    mocks.getAgentAnswerQualityReviewSummary.mockResolvedValue({
      guildId: 'g-1',
      days: 14,
      sampleCount: 20,
      byStrategy: {
        baseline: { total: 10, hallucinations: 0, ratePct: 0 },
        tot: { total: 5, hallucinations: 0, ratePct: 0 },
        got: { total: 5, hallucinations: 0, ratePct: 0 },
      },
      deltaGotVsBaselinePct: 0,
      generatedAt: '2026-03-14T00:00:00.000Z',
    });

    mocks.buildGoNoGoReport.mockResolvedValue({
      decision: 'go',
      failedChecks: [],
      metrics: {
        memory: { citationRate: 0.98 },
        retrieval: { recallAt5: 0.8, totalQueries: 25 },
      },
    });

    mocks.buildAgentRuntimeReadinessReport.mockResolvedValue({
      decision: 'pass',
      failedCheckIds: [],
      metrics: {
        actionDiagnostics: {
          totalRuns: 20,
          successRuns: 18,
        },
      },
    });
  });

  it('모든 핵심 입력이 있으면 healthy 스냅샷을 반환한다', async () => {
    const snapshot = await buildSocialQualityOperationalSnapshot({ guildId: 'g-1', days: 14 });

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.quality.citationRate).toBe(0.98);
    expect(snapshot.quality.retrievalHitAt5).toBe(0.8);
    expect(snapshot.quality.hallucinationReviewFailRate).toBe(0);
    expect(snapshot.quality.taskSuccessRate).toBe(0.9);
    expect(snapshot.interpretation.missingSources).toEqual([]);
    expect(snapshot.interpretation.breachedThresholds).toEqual([]);
  });

  it('결측 source가 있으면 degraded로 해석한다', async () => {
    mocks.getCommunityGraphOperationalSummary.mockResolvedValueOnce({
      guildId: 'g-1',
      days: 14,
      since: '2026-03-01T00:00:00.000Z',
      socialEventsIngested: 0,
      activeEdges: 0,
      activeActors: 0,
      latestEventAt: null,
      eventTypeCounts: { reply: 0, mention: 0, reaction: 0, co_presence: 0 },
      topEdges: [],
      generatedAt: '2026-03-14T00:00:00.000Z',
    });

    const snapshot = await buildSocialQualityOperationalSnapshot({ guildId: 'g-1', days: 14 });

    expect(snapshot.status).toBe('degraded');
    expect(snapshot.interpretation.missingSources).toContain('social_events');
    expect(snapshot.interpretation.missingSources).toContain('social_edges');
  });

  it('임계치 위반이 있으면 blocked로 해석한다', async () => {
    mocks.buildGoNoGoReport.mockResolvedValueOnce({
      decision: 'no-go',
      failedChecks: ['citation-rate'],
      metrics: {
        memory: { citationRate: 0.4 },
        retrieval: { recallAt5: 0.2, totalQueries: 10 },
      },
    });

    const snapshot = await buildSocialQualityOperationalSnapshot({ guildId: 'g-1', days: 14 });

    expect(snapshot.status).toBe('blocked');
    expect(snapshot.interpretation.breachedThresholds).toContain('citation_rate');
    expect(snapshot.interpretation.breachedThresholds).toContain('retrieval_hit_at_5');
  });
});
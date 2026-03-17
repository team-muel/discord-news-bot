import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import {
  createOpencodeChangeRequest,
  summarizeOpencodeQueueReadiness,
} from './opencodeGitHubQueueService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type QueryResult = { data: any; error: any };

type AwaitableBuilder = {
  eq: (key: string, value: unknown) => AwaitableBuilder;
  order: (key: string, opts: Record<string, unknown>) => AwaitableBuilder;
  limit: (value: number) => AwaitableBuilder;
  then: (onFulfilled: (value: QueryResult) => unknown) => unknown;
};

const makeAwaitableBuilder = (result: QueryResult): AwaitableBuilder => {
  const builder: AwaitableBuilder = {
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (onFulfilled) => Promise.resolve(onFulfilled(result)),
  };
  return builder;
};

describe('opencodeGitHubQueueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  });

  it('createOpencodeChangeRequest가 거버넌스 필드를 저장한다', async () => {
    let insertedPayload: Record<string, unknown> | null = null;

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => {
        if (table !== 'agent_opencode_change_requests') {
          throw new Error(`unexpected table: ${table}`);
        }

        return {
          insert: (payload: Record<string, unknown>) => {
            insertedPayload = payload;
            return {
              select: () => ({
                single: async () => ({ data: { id: 101, ...payload }, error: null }),
              }),
            };
          },
        };
      },
    } as any);

    await createOpencodeChangeRequest({
      guildId: '1234567890',
      requestedBy: 'u-1',
      title: 'Improve publish guardrails',
      riskTier: 'critical',
      scoreCard: {
        total: 82.123456,
        policy: true,
        comment: '  looks good  ',
        nested: { ignored: true },
      },
      evidenceBundleId: 'ev-001',
      files: ['a.ts'],
      diffPatch: 'diff --git a/a.ts b/a.ts',
    });

    expect(insertedPayload).toBeTruthy();
    expect((insertedPayload as Record<string, unknown> | null)?.['risk_tier']).toBe('critical');
    expect((insertedPayload as Record<string, unknown> | null)?.['evidence_bundle_id']).toBe('ev-001');
    expect((insertedPayload as Record<string, unknown> | null)?.['score_card']).toEqual({
      total: 82.1235,
      policy: true,
      comment: 'looks good',
    });
  });

  it('summarizeOpencodeQueueReadiness가 risk/evidence 집계를 반환한다', async () => {
    const changeRequests = [
      {
        id: 1,
        status: 'review_pending',
        risk_tier: 'high',
        evidence_bundle_id: null,
        files: ['a.ts', 'b.ts'],
      },
      {
        id: 2,
        status: 'approved',
        risk_tier: 'critical',
        evidence_bundle_id: 'ev-2',
        files: ['c.ts'],
      },
      {
        id: 3,
        status: 'approved',
        risk_tier: 'low',
        evidence_bundle_id: 'ev-3',
        files: [],
      },
    ];

    const publishJobs = [
      { id: 10, status: 'queued' },
      { id: 11, status: 'running' },
      { id: 12, status: 'failed' },
    ];

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_opencode_change_requests') {
          return {
            select: () => makeAwaitableBuilder({ data: changeRequests, error: null }),
          };
        }

        if (table === 'agent_opencode_publish_queue') {
          return {
            select: () => makeAwaitableBuilder({ data: publishJobs, error: null }),
          };
        }

        throw new Error(`unexpected table: ${table}`);
      },
    } as any);

    const summary = await summarizeOpencodeQueueReadiness({ guildId: '1234567890' });

    expect(summary.changeRequests.byRiskTier).toMatchObject({
      high: 1,
      critical: 1,
      low: 1,
    });
    expect(summary.changeRequests.evidenceCoverage).toEqual({
      attached: 2,
      missing: 1,
      highRiskMissing: 1,
    });
    expect(summary.publishJobs.byStatus).toMatchObject({
      queued: 1,
      running: 1,
      failed: 1,
    });
    expect(summary.changeRequests.recentFiles).toEqual(['a.ts', 'b.ts']);
  });
});

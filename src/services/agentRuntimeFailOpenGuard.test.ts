import { describe, expect, it, vi } from 'vitest';

describe('runtime fail-open guards', () => {
  it('production에서 ACTION_POLICY_FAIL_OPEN_ON_ERROR=true면 module import 시 차단된다', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'test-secret-not-default');
    vi.stubEnv('ACTION_POLICY_FAIL_OPEN_ON_ERROR', 'true');

    await expect(import('./skills/actionGovernanceStore')).rejects.toThrow(
      'ACTION_POLICY_FAIL_OPEN_ON_ERROR must be false in production',
    );

    vi.unstubAllEnvs();
  });

  it('production에서 AGENT_READINESS_FAIL_OPEN=true면 module import 시 차단된다', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'test-secret-not-default');
    vi.stubEnv('AGENT_READINESS_FAIL_OPEN', 'true');

    vi.doMock('./skills/actionRunner', () => ({
      getActionRunnerDiagnosticsSnapshot: () => ({
        totalRuns: 0,
        failedRuns: 0,
        failureTotals: { missingAction: 0, totalFailures: 0, policyBlocked: 0 },
      }),
    }));
    vi.doMock('./workerGeneration/workerProposalMetrics', () => ({
      getWorkerProposalMetricsSnapshot: () => ({
        generationRequested: 0,
        generationSuccessRate: 0,
        approvalPassRate: 0,
        approvalsApproved: 0,
        approvalsRejected: 0,
      }),
    }));
    vi.doMock('./goNoGoService', () => ({
      buildGoNoGoReport: async () => ({ decision: 'go' }),
    }));
    vi.doMock('./supabaseClient', () => ({
      isSupabaseConfigured: () => false,
      getSupabaseClient: () => {
        throw new Error('not configured');
      },
    }));

    await expect(import('./agentRuntimeReadinessService')).rejects.toThrow(
      'AGENT_READINESS_FAIL_OPEN must be false in production',
    );

    vi.unstubAllEnvs();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockReadFile,
  mockReaddir,
  mockGetWorkerApprovalStoreSnapshot,
  mockListApprovals,
  mockGetGuildActionPolicy,
  mockListGuildActionPolicies,
  mockListActionApprovalRequests,
  mockGetOpencodeExecutionSummary,
  mockIsSupabaseConfigured,
  mockGetSupabaseClient,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockGetWorkerApprovalStoreSnapshot: vi.fn(),
  mockListApprovals: vi.fn(),
  mockGetGuildActionPolicy: vi.fn(),
  mockListGuildActionPolicies: vi.fn(),
  mockListActionApprovalRequests: vi.fn(),
  mockGetOpencodeExecutionSummary: vi.fn(),
  mockIsSupabaseConfigured: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: mockReadFile,
    readdir: mockReaddir,
  },
}));

vi.mock('../workerGeneration/workerApprovalStore', () => ({
  getWorkerApprovalStoreSnapshot: mockGetWorkerApprovalStoreSnapshot,
  listApprovals: mockListApprovals,
}));

vi.mock('../skills/actionGovernanceStore', () => ({
  getGuildActionPolicy: mockGetGuildActionPolicy,
  listGuildActionPolicies: mockListGuildActionPolicies,
  listActionApprovalRequests: mockListActionApprovalRequests,
}));

vi.mock('../opencodeOpsService', () => ({
  getOpencodeExecutionSummary: mockGetOpencodeExecutionSummary,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: mockIsSupabaseConfigured,
  getSupabaseClient: mockGetSupabaseClient,
}));

describe('buildWorkerApprovalGateSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('aggregates worker approvals, policy bindings, model fallback, and latest gate decision', async () => {
    vi.stubEnv('ACTION_POLICY_DEFAULT_ENABLED', 'true');
    vi.stubEnv('ACTION_POLICY_DEFAULT_RUN_MODE', 'approval_required');
    vi.stubEnv('ACTION_POLICY_FAIL_OPEN_ON_ERROR', 'false');
    vi.stubEnv('ACTION_ALLOWED_ACTIONS', 'opencode.execute,rag.retrieve');
    vi.stubEnv('LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED', 'true');
    vi.stubEnv('LLM_PROVIDER_FALLBACK_CHAIN', 'openclaw,openai');
    vi.stubEnv('LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER', 'openai,anthropic');
    vi.stubEnv('LLM_PROVIDER_POLICY_ACTIONS', 'opencode.*=openclaw,openai;rag.retrieve=ollama');

    mockGetWorkerApprovalStoreSnapshot.mockResolvedValue({
      configuredMode: 'supabase',
      activeBackend: 'supabase',
      supabaseConfigured: true,
      supabaseDisabled: false,
      dbTable: 'worker_approvals',
      filePath: '.runtime/worker-approvals.json',
      loaded: true,
      totalApprovals: 4,
      pendingApprovals: 1,
      approvedApprovals: 2,
      rejectedApprovals: 1,
      lastError: null,
    });
    mockListApprovals.mockResolvedValue([
      {
        id: 'wa-approved',
        guildId: 'guild-1',
        requestedBy: 'user-1',
        goal: 'ship fix',
        actionName: 'opencode.execute',
        generatedCode: '',
        sandboxDir: '',
        sandboxFilePath: '',
        validationPassed: true,
        validationErrors: [],
        validationWarnings: [],
        status: 'approved',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T11:00:00.000Z',
      },
      {
        id: 'wa-refactor',
        guildId: 'guild-1',
        requestedBy: 'user-2',
        goal: 'retry worker',
        actionName: 'opencode.execute',
        generatedCode: '',
        sandboxDir: '',
        sandboxFilePath: '',
        validationPassed: false,
        validationErrors: ['lint'],
        validationWarnings: [],
        status: 'refactor_requested',
        createdAt: '2026-03-20T12:00:00.000Z',
        updatedAt: '2026-03-20T13:00:00.000Z',
      },
      {
        id: 'wa-pending',
        guildId: 'guild-1',
        requestedBy: 'user-3',
        goal: 'new worker',
        actionName: 'opencode.execute',
        generatedCode: '',
        sandboxDir: '',
        sandboxFilePath: '',
        validationPassed: true,
        validationErrors: [],
        validationWarnings: [],
        status: 'pending',
        createdAt: '2026-03-20T14:00:00.000Z',
        updatedAt: '2026-03-20T14:00:00.000Z',
      },
      {
        id: 'wa-other-guild',
        guildId: 'guild-2',
        requestedBy: 'user-4',
        goal: 'ignore me',
        actionName: 'opencode.execute',
        generatedCode: '',
        sandboxDir: '',
        sandboxFilePath: '',
        validationPassed: true,
        validationErrors: [],
        validationWarnings: [],
        status: 'approved',
        createdAt: '2026-03-20T15:00:00.000Z',
        updatedAt: '2026-03-20T15:00:00.000Z',
      },
    ]);
    mockGetGuildActionPolicy.mockResolvedValue({
      guildId: 'guild-1',
      actionName: 'opencode.execute',
      enabled: true,
      runMode: 'approval_required',
      updatedAt: '2026-03-20T12:00:00.000Z',
      updatedBy: 'admin-1',
    });
    mockListGuildActionPolicies.mockResolvedValue([
      {
        guildId: 'guild-1',
        actionName: 'opencode.execute',
        enabled: true,
        runMode: 'approval_required',
        updatedAt: '2026-03-20T12:00:00.000Z',
        updatedBy: 'admin-1',
      },
    ]);
    mockListActionApprovalRequests.mockResolvedValue([
      {
        id: 'req-1',
        guildId: 'guild-1',
        requestedBy: 'user-1',
        goal: 'approve opencode',
        actionName: 'opencode.execute',
        actionArgs: {},
        status: 'approved',
        reason: null,
        approvedBy: 'admin-1',
        approvedAt: '2026-03-20T11:30:00.000Z',
        createdAt: '2026-03-20T11:00:00.000Z',
        expiresAt: '2026-03-20T12:00:00.000Z',
      },
    ]);
    mockGetOpencodeExecutionSummary.mockResolvedValue({
      guildId: 'guild-1',
      windowDays: 14,
      since: '2026-03-06T00:00:00.000Z',
      executions: {
        total: 3,
        success: 2,
        failed: 1,
        approvalRequired: 1,
        avgDurationMs: 120,
        topErrors: [
          { code: 'PRIVACY_PREFLIGHT_BLOCKED', count: 1 },
        ],
      },
      approvals: {
        pending: 1,
        approved: 1,
        rejected: 0,
        expired: 0,
      },
      generatedAt: '2026-03-20T12:30:00.000Z',
    });
    const mockLogsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          {
            action_name: 'opencode.execute',
            status: 'success',
            created_at: '2026-03-20T12:15:00.000Z',
            verification: [
              'agent_role=opencode',
              'handoff=opendev->nemoclaw',
              'handoff_evidence=opendev:opencode.execute',
              'handoff_evidence=nemoclaw:opencode.execute',
              'handoff_evidence=opendev-release:approval-1',
            ],
          },
        ],
        error: null,
      }),
    };
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue(mockLogsChain),
    });
    mockReaddir.mockResolvedValue([
      { isFile: () => true, name: '2026-03-19_gate-20260319-135437.json' },
      { isFile: () => false, name: 'archive' },
    ]);
    mockReadFile.mockImplementation(async (target: string) => {
      if (target.endsWith('2026-03-19_gate-20260319-135437.json')) {
        return JSON.stringify({
          run_id: 'gate-20260319-135437',
          stage: 'A',
          target_scope: 'weekly:auto:post-fallback',
          started_at: '2026-03-19T13:54:37.202Z',
          ended_at: '2026-03-19T13:54:37.202Z',
          final_decision: {
            overall: 'no-go',
            provider_profile_fallback_required: true,
            provider_profile_target: 'quality-optimized',
            provider_profile_trigger: 'quality_gate_fail',
          },
          gates: {
            safety: {
              verdict: 'pass',
              metrics: {
                approval_required_compliance_pct: 100,
                unapproved_autodeploy_count: 0,
                policy_violation_count: 0,
                privacy_block_count: 0,
              },
            },
          },
        });
      }

      if (target.endsWith('WEEKLY_SUMMARY.md')) {
        return [
          '# Go/No-Go Weekly Summary',
          '- runs_with_evidence: 0',
          '- complete_runs: 0',
          '- incomplete_runs: 0',
          '- missing_runs: 29',
          '- completion_rate: n/a',
        ].join('\n');
      }

      throw new Error(`unexpected readFile: ${target}`);
    });

    const { buildWorkerApprovalGateSnapshot } = await import('./agentWorkerApprovalGateSnapshotService');
    const snapshot = await buildWorkerApprovalGateSnapshot({ guildId: 'guild-1', recentLimit: 2 });

    expect(snapshot.guildId).toBe('guild-1');
    expect(snapshot.workerApprovals.totalApprovals).toBe(3);
    expect(snapshot.workerApprovals.pendingApprovals).toBe(1);
    expect(snapshot.workerApprovals.refactorRequestedApprovals).toBe(1);
    expect(snapshot.workerApprovals.filePath).toBeNull();
    expect(snapshot.workerApprovals.recentDecisions).toHaveLength(2);
    expect(snapshot.policyBindings.opencodeExecutePolicy.runMode).toBe('approval_required');
    expect(snapshot.policyBindings.actionAllowedActions).toEqual(['opencode.execute', 'rag.retrieve']);
    expect(snapshot.modelFallback.defaultProviderFallbackChain).toEqual(['openclaw', 'openai']);
    expect(snapshot.modelFallback.providerPolicyBindings).toEqual([
      { pattern: 'opencode.*', providers: ['openclaw', 'openai'] },
      { pattern: 'rag.retrieve', providers: ['ollama'] },
    ]);
    expect(snapshot.safetySignals).toEqual({
      approvalRequiredCompliancePct: 100,
      unapprovedAutodeployCount: 0,
      policyViolationCount: 0,
      privacyBlockCount: 1,
      source: {
        approvalRequiredCompliancePct: 'live_policy_mode',
        unapprovedAutodeployCount: 'live_opencode_execution_summary',
        policyViolationCount: 'live_opencode_error_codes+policy_mode',
        privacyBlockCount: 'live_opencode_error_codes',
      },
    });
    expect(snapshot.delegationEvidence.complete).toBe(true);
    expect(snapshot.delegationEvidence.opendevToNemoclawHandoffCount).toBe(1);
    expect(snapshot.delegationEvidence.recentDelegations).toHaveLength(1);
    expect(snapshot.globalArtifacts.recommendedProfileFromLatestGate).toBe('quality-optimized');
    expect(snapshot.globalArtifacts.latestGateDecision?.safety.approvalRequiredCompliancePct).toBe(100);
    expect(snapshot.globalArtifacts.runtimeLoopEvidence).toEqual({
      runsWithEvidence: 0,
      completeRuns: 0,
      incompleteRuns: 0,
      missingRuns: 29,
      completionRate: null,
      source: 'docs/planning/gate-runs/WEEKLY_SUMMARY.md',
    });
  });

  it('handles missing global artifacts without failing guild-scoped approval data', async () => {
    mockGetWorkerApprovalStoreSnapshot.mockResolvedValue({
      configuredMode: 'file',
      activeBackend: 'file',
      supabaseConfigured: false,
      supabaseDisabled: false,
      dbTable: 'worker_approvals',
      filePath: 'C:/repo/.runtime/worker-approvals.json',
      loaded: true,
      totalApprovals: 1,
      pendingApprovals: 1,
      approvedApprovals: 0,
      rejectedApprovals: 0,
      lastError: null,
    });
    mockListApprovals.mockResolvedValue([
      {
        id: 'wa-pending',
        guildId: 'guild-1',
        requestedBy: 'user-3',
        goal: 'new worker',
        actionName: 'opencode.execute',
        generatedCode: '',
        sandboxDir: '',
        sandboxFilePath: '',
        validationPassed: true,
        validationErrors: [],
        validationWarnings: [],
        status: 'pending',
        createdAt: '2026-03-20T14:00:00.000Z',
        updatedAt: '2026-03-20T14:00:00.000Z',
      },
    ]);
    mockGetGuildActionPolicy.mockResolvedValue({
      guildId: 'guild-1',
      actionName: 'opencode.execute',
      enabled: true,
      runMode: 'approval_required',
      updatedAt: '2026-03-20T12:00:00.000Z',
      updatedBy: null,
    });
    mockListGuildActionPolicies.mockResolvedValue([]);
    mockListActionApprovalRequests.mockResolvedValue([]);
    mockGetOpencodeExecutionSummary.mockResolvedValue({
      guildId: 'guild-1',
      windowDays: 14,
      since: '2026-03-06T00:00:00.000Z',
      executions: {
        total: 0,
        success: 0,
        failed: 0,
        approvalRequired: 0,
        avgDurationMs: 0,
        topErrors: [],
      },
      approvals: {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
      },
      generatedAt: '2026-03-20T12:30:00.000Z',
    });
    mockIsSupabaseConfigured.mockReturnValue(false);
    mockReaddir.mockRejectedValue(new Error('missing dir'));
    mockReadFile.mockRejectedValue(new Error('missing file'));

    const { buildWorkerApprovalGateSnapshot } = await import('./agentWorkerApprovalGateSnapshotService');
    const snapshot = await buildWorkerApprovalGateSnapshot({ guildId: 'guild-1' });

    expect(snapshot.workerApprovals.filePath).toBe('.runtime/worker-approvals.json');
    expect(snapshot.safetySignals.approvalRequiredCompliancePct).toBe(100);
    expect(snapshot.delegationEvidence.complete).toBeNull();
    expect(snapshot.globalArtifacts.latestGateDecision).toBeNull();
    expect(snapshot.globalArtifacts.runtimeLoopEvidence).toBeNull();
    expect(snapshot.globalArtifacts.recommendedProfileFromLatestGate).toBe('keep-current');
  });
});
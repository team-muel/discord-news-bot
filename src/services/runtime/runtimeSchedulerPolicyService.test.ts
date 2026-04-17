import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockCronJob = {
  jobId: number;
  jobName: string;
  schedule: string;
  command: string;
  active: boolean;
};

const {
  mockListSupabaseCronJobs,
  mockGetRewardSignalLoopStatus,
  mockGetEvalAutoPromoteLoopStatus,
  mockGetObsidianGraphAuditLoopStats,
  mockGetRuntimeBootstrapState,
  mockGetLocalAutonomySupervisorLoopStats,
} = vi.hoisted(() => ({
  mockListSupabaseCronJobs: vi.fn(async (): Promise<MockCronJob[]> => []),
  mockGetRewardSignalLoopStatus: vi.fn(() => ({
    enabled: true,
    running: false,
    lastRunAt: null,
    lastSummary: null,
    intervalHours: 6,
  })),
  mockGetEvalAutoPromoteLoopStatus: vi.fn(() => ({
    enabled: true,
    running: false,
    lastRunAt: null,
    lastSummary: null,
    intervalHours: 6,
  })),
  mockGetObsidianGraphAuditLoopStats: vi.fn(() => ({
    enabled: true,
    owner: 'app',
    running: false,
    intervalMin: 360,
    runOnStart: true,
    timeoutMs: 600000,
    lastRunAt: null,
    lastFinishedAt: null,
    lastStatus: 'idle',
    lastExitCode: null,
    lastSummary: null,
    snapshotPath: '/repo/.runtime/obsidian-graph-audit.json',
  })),
  mockGetRuntimeBootstrapState: vi.fn(() => ({
    serverStarted: true,
    discordReadyStarted: false,
    sharedLoopsStarted: true,
    sharedLoopsSource: 'server-process',
    pgCronReplacedLoops: [] as string[],
    pgCron: {
      status: 'not-required',
      startedAt: null as string | null,
      completedAt: null as string | null,
      lastError: null as string | null,
      summary: null,
      deferredTaskCount: 0,
    },
  })),
  mockGetLocalAutonomySupervisorLoopStats: vi.fn(() => ({
    enabled: true,
    started: true,
    running: false,
    intervalMs: 300000,
  })),
}));

vi.mock('../agent/agentRoleWorkerService', () => ({
  listAgentRoleWorkerSpecs: vi.fn(() => ([
    { id: 'local-orchestrator', title: 'Local Orchestrator worker', envKey: 'MCP_LOCAL_ORCHESTRATOR_WORKER_URL', url: 'http://127.0.0.1:8790' },
    { id: 'opendev', title: 'OpenDev worker', envKey: 'MCP_OPENDEV_WORKER_URL', url: 'http://127.0.0.1:8791' },
    { id: 'nemoclaw', title: 'NemoClaw worker', envKey: 'MCP_NEMOCLAW_WORKER_URL', url: '' },
    { id: 'openjarvis', title: 'OpenJarvis worker', envKey: 'MCP_OPENJARVIS_WORKER_URL', url: '' },
  ])),
  getAgentRoleWorkersHealthSnapshot: vi.fn(async () => ({
    'local-orchestrator': { reachable: true },
    opendev: { reachable: true },
    nemoclaw: { reachable: false },
    openjarvis: { reachable: false },
  })),
}));

vi.mock('../automationBot', () => ({
  isAutomationEnabled: vi.fn(() => true),
  getAutomationRuntimeSnapshot: vi.fn(() => ({
    jobs: {
      news: { name: 'news', running: false, schedule: '*/5 * * * *' },
      youtube: { name: 'youtube', running: true, schedule: '*/10 * * * *' },
    },
  })),
}));

vi.mock('../../discord/auth', () => ({
  getLoginSessionCleanupLoopStats: vi.fn(() => ({
    owner: 'app',
    running: false,
    intervalMs: 30 * 60 * 1000,
  })),
}));

vi.mock('../agent/agentOpsService', () => ({
  getAgentOpsSnapshot: vi.fn(() => ({
    dailyLearningEnabled: true,
    dailyLearningHour: 4,
    gotCutoverAutopilotEnabled: true,
    gotCutoverAutopilotIntervalMin: 15,
  })),
}));

vi.mock('../memory/memoryJobRunner', () => ({
  getMemoryJobRunnerStats: vi.fn(() => ({
    enabled: true,
    startedAt: '2026-03-20T00:00:00.000Z',
    pollIntervalMs: 20000,
    deadletterRecoveryIntervalMs: 120000,
  })),
}));

vi.mock('../obsidian/obsidianLoreSyncService', () => ({
  getObsidianLoreSyncLoopStats: vi.fn(() => ({
    enabled: true,
    running: true,
    owner: 'app',
    intervalMin: 30,
  })),
}));

vi.mock('../obsidian/obsidianQualityService', () => ({
  getObsidianGraphAuditLoopStats: mockGetObsidianGraphAuditLoopStats,
}));

vi.mock('../eval/retrievalEvalLoopService', () => ({
  getRetrievalEvalLoopStats: vi.fn(() => ({
    enabled: true,
    running: false,
    intervalHours: 12,
  })),
}));

vi.mock('../eval/rewardSignalLoopService', () => ({
  getRewardSignalLoopStatus: mockGetRewardSignalLoopStatus,
}));

vi.mock('../eval/evalAutoPromoteLoopService', () => ({
  getEvalAutoPromoteLoopStatus: mockGetEvalAutoPromoteLoopStatus,
}));

vi.mock('../agent/agentSloService', () => ({
  getAgentSloAlertLoopStats: vi.fn(() => ({
    enabled: true,
    running: true,
    inFlight: false,
    intervalMin: 15,
    maxGuilds: 100,
    concurrency: 4,
  })),
}));

vi.mock('./runtimeAlertService', () => ({
  getRuntimeAlertsStats: vi.fn(() => ({
    enabled: true,
    started: true,
    running: true,
    intervalMs: 60000,
  })),
}));

vi.mock('../opencode/opencodePublishWorker', () => ({
  getOpencodePublishWorkerStats: vi.fn(() => ({
    enabled: true,
    started: true,
    inFlight: false,
    running: true,
    intervalMs: 5000,
  })),
}));

vi.mock('./runtimeBootstrap', () => ({
  getRuntimeBootstrapState: mockGetRuntimeBootstrapState,
}));

vi.mock('./localAutonomySupervisorService', () => ({
  getLocalAutonomySupervisorLoopStats: mockGetLocalAutonomySupervisorLoopStats,
}));

vi.mock('../infra/supabaseExtensionOpsService', () => ({ listSupabaseCronJobs: mockListSupabaseCronJobs }));

describe('getRuntimeSchedulerPolicySnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockListSupabaseCronJobs.mockResolvedValue([]);
    mockGetRewardSignalLoopStatus.mockReturnValue({
      enabled: true,
      running: false,
      lastRunAt: null,
      lastSummary: null,
      intervalHours: 6,
    });
    mockGetEvalAutoPromoteLoopStatus.mockReturnValue({
      enabled: true,
      running: false,
      lastRunAt: null,
      lastSummary: null,
      intervalHours: 6,
    });
    mockGetObsidianGraphAuditLoopStats.mockReturnValue({
      enabled: true,
      owner: 'app',
      running: false,
      intervalMin: 360,
      runOnStart: true,
      timeoutMs: 600000,
      lastRunAt: null,
      lastFinishedAt: null,
      lastStatus: 'idle',
      lastExitCode: null,
      lastSummary: null,
      snapshotPath: '/repo/.runtime/obsidian-graph-audit.json',
    });
    mockGetRuntimeBootstrapState.mockReturnValue({
      serverStarted: true,
      discordReadyStarted: false,
      sharedLoopsStarted: true,
      sharedLoopsSource: 'server-process',
      pgCronReplacedLoops: [] as string[],
      pgCron: {
        status: 'not-required',
        startedAt: null as string | null,
        completedAt: null as string | null,
        lastError: null as string | null,
        summary: null,
        deferredTaskCount: 0,
      },
    });
  });

  it('앱 소유 login cleanup은 실제 loop running 상태를 반영한다', async () => {
    const { getRuntimeSchedulerPolicySnapshot } = await import('./runtimeSchedulerPolicyService');
    const snapshot = await getRuntimeSchedulerPolicySnapshot();

    const login = snapshot.items.find((item) => item.id === 'login-session-cleanup');
    expect(login).toBeDefined();
    expect(login?.owner).toBe('app');
    expect(login?.enabled).toBe(true);
    expect(login?.running).toBe(false);
  });

  it('서버 런타임 루프가 정책 스냅샷에 노출되고 memory startup이 service-init으로 표기된다', async () => {
    const { getRuntimeSchedulerPolicySnapshot } = await import('./runtimeSchedulerPolicyService');
    const snapshot = await getRuntimeSchedulerPolicySnapshot();

    const memory = snapshot.items.find((item) => item.id === 'memory-job-runner');
    const opencode = snapshot.items.find((item) => item.id === 'opencode-publish-worker');
    const alerts = snapshot.items.find((item) => item.id === 'runtime-alerts');
    const localAutonomy = snapshot.items.find((item) => item.id === 'local-autonomy-supervisor');
    const sloAlerts = snapshot.items.find((item) => item.id === 'agent-slo-alert-loop');
    const graphAudit = snapshot.items.find((item) => item.id === 'obsidian-graph-audit-loop');

    expect(memory?.startup).toBe('service-init');
    expect(opencode?.running).toBe(true);
    expect(alerts?.running).toBe(true);
    expect(localAutonomy).toMatchObject({ owner: 'app', startup: 'service-init', running: true, enabled: true });
    expect(sloAlerts?.startup).toBe('discord-ready');
    expect(sloAlerts?.running).toBe(true);
    expect(graphAudit).toMatchObject({ owner: 'app', schedule: 'every 360m' });
    expect(snapshot.items.find((item) => item.id === 'trading-engine')).toBeUndefined();
  });

  it('supabase 미설정 환경에서도 스냅샷 생성이 실패하지 않는다', async () => {
    mockListSupabaseCronJobs.mockRejectedValueOnce(new Error('SUPABASE_NOT_CONFIGURED'));
    const { getRuntimeSchedulerPolicySnapshot } = await import('./runtimeSchedulerPolicyService');
    const snapshot = await getRuntimeSchedulerPolicySnapshot();

    expect(snapshot.supabase).toMatchObject({ configured: false, cronJobCount: 0 });
    expect(snapshot.items.length).toBeGreaterThan(0);
  });

  it('configured advisory workers are included in scheduler snapshot', async () => {
    const { getRuntimeSchedulerPolicySnapshot } = await import('./runtimeSchedulerPolicyService');
    const snapshot = await getRuntimeSchedulerPolicySnapshot();

    const opendevWorker = snapshot.items.find((item) => item.id === 'opendev-worker');
    const localOrchestratorWorker = snapshot.items.find((item) => item.id === 'local-orchestrator-worker');
    expect(opendevWorker).toBeDefined();
    expect(opendevWorker?.enabled).toBe(true);
    expect(opendevWorker?.running).toBe(true);
    expect(localOrchestratorWorker?.running).toBe(true);
  });

  it('confirmed pg_cron-owned loops use exact cron job presence instead of generic counts', async () => {
    mockGetObsidianGraphAuditLoopStats.mockReturnValue({
      enabled: false,
      owner: 'db',
      running: false,
      intervalMin: 360,
      runOnStart: true,
      timeoutMs: 600000,
      lastRunAt: null,
      lastFinishedAt: null,
      lastStatus: 'idle',
      lastExitCode: null,
      lastSummary: null,
      snapshotPath: '/repo/.runtime/obsidian-graph-audit.json',
    });
    mockGetRuntimeBootstrapState.mockReturnValue({
      serverStarted: true,
      discordReadyStarted: true,
      sharedLoopsStarted: true,
      sharedLoopsSource: 'discord-ready',
      pgCronReplacedLoops: ['obsidianGraphAuditLoop', 'retrievalEvalLoop', 'rewardSignalLoop', 'evalAutoPromoteLoop', 'intentEvalLoop'],
      pgCron: {
        status: 'ready',
        startedAt: '2026-04-11T00:00:00.000Z',
        completedAt: '2026-04-11T00:00:05.000Z',
        lastError: null,
        summary: null,
        deferredTaskCount: 0,
      },
    });
    mockListSupabaseCronJobs.mockResolvedValueOnce([
      { jobId: 10, jobName: 'muel_obsidian_graph_audit', schedule: '30 */6 * * *', command: 'select 1', active: true },
      { jobId: 1, jobName: 'muel_retrieval_eval', schedule: '0 */24 * * *', command: 'select 1', active: true },
      { jobId: 2, jobName: 'muel_slo_check', schedule: '*/15 * * * *', command: 'select 1', active: true },
    ]);

    const { getRuntimeSchedulerPolicySnapshot } = await import('./runtimeSchedulerPolicyService');
    const snapshot = await getRuntimeSchedulerPolicySnapshot();

    const retrieval = snapshot.items.find((item) => item.id === 'retrieval-eval-loop');
  const graphAudit = snapshot.items.find((item) => item.id === 'obsidian-graph-audit-loop');
    const reward = snapshot.items.find((item) => item.id === 'reward-signal-loop');
    const autoPromote = snapshot.items.find((item) => item.id === 'eval-auto-promote-loop');
    const intent = snapshot.items.find((item) => item.id === 'intent-formation');

  expect(graphAudit).toMatchObject({ owner: 'db', enabled: true, running: true, schedule: '30 */6 * * *' });
    expect(retrieval).toMatchObject({ owner: 'db', enabled: true, running: true, schedule: '0 */24 * * *' });
    expect(reward).toMatchObject({ owner: 'db', enabled: false, running: false });
    expect(autoPromote).toMatchObject({ owner: 'db', enabled: false, running: false });
    expect(intent).toMatchObject({ owner: 'db', enabled: false, running: false });
  });
});

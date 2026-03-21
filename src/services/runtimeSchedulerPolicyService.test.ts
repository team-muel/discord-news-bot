import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSupabaseCronJobs = vi.fn(async () => []);

vi.mock('./agentRoleWorkerService', () => ({
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

vi.mock('./automationBot', () => ({
  isAutomationEnabled: vi.fn(() => true),
  getAutomationRuntimeSnapshot: vi.fn(() => ({
    jobs: {
      news: { name: 'news', running: false, schedule: '*/5 * * * *' },
      youtube: { name: 'youtube', running: true, schedule: '*/10 * * * *' },
    },
  })),
}));

vi.mock('../discord/auth', () => ({
  getLoginSessionCleanupLoopStats: vi.fn(() => ({
    owner: 'app',
    running: false,
    intervalMs: 30 * 60 * 1000,
  })),
}));

vi.mock('./agentOpsService', () => ({
  getAgentOpsSnapshot: vi.fn(() => ({
    dailyLearningEnabled: true,
    dailyLearningHour: 4,
    gotCutoverAutopilotEnabled: true,
    gotCutoverAutopilotIntervalMin: 15,
  })),
}));

vi.mock('./memoryJobRunner', () => ({
  getMemoryJobRunnerStats: vi.fn(() => ({
    enabled: true,
    startedAt: '2026-03-20T00:00:00.000Z',
    pollIntervalMs: 20000,
    deadletterRecoveryIntervalMs: 120000,
  })),
}));

vi.mock('./obsidianLoreSyncService', () => ({
  getObsidianLoreSyncLoopStats: vi.fn(() => ({
    enabled: true,
    running: true,
    intervalMin: 30,
  })),
}));

vi.mock('./retrievalEvalLoopService', () => ({
  getRetrievalEvalLoopStats: vi.fn(() => ({
    enabled: true,
    running: false,
    intervalHours: 12,
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

vi.mock('./tradingEngine', () => ({
  getTradingEngineRuntimeSnapshot: vi.fn(() => ({
    started: true,
    startedAt: '2026-03-20T00:00:00.000Z',
    paused: false,
    pausedAt: null,
    pausedReason: null,
    symbols: ['BTCUSDT'],
    timeframe: '1m',
    dryRun: true,
    strategyMode: 'cvd',
    enabled: true,
    lastLoopAt: null,
    lastLoopError: null,
  })),
}));

vi.mock('./opencodePublishWorker', () => ({
  getOpencodePublishWorkerStats: vi.fn(() => ({
    enabled: true,
    started: true,
    inFlight: false,
    running: true,
    intervalMs: 5000,
  })),
}));

vi.mock('./runtimeBootstrap', () => ({
  getRuntimeBootstrapState: vi.fn(() => ({
    serverStarted: true,
    discordReadyStarted: false,
    sharedLoopsStarted: true,
    sharedLoopsSource: 'server-process',
  })),
}));

vi.mock('./supabaseExtensionOpsService', () => ({ listSupabaseCronJobs }));

describe('getRuntimeSchedulerPolicySnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
    const trading = snapshot.items.find((item) => item.id === 'trading-engine');
    const alerts = snapshot.items.find((item) => item.id === 'runtime-alerts');

    expect(memory?.startup).toBe('service-init');
    expect(opencode?.running).toBe(true);
    expect(trading?.running).toBe(true);
    expect(alerts?.running).toBe(true);
  });

  it('supabase 미설정 환경에서도 스냅샷 생성이 실패하지 않는다', async () => {
    listSupabaseCronJobs.mockRejectedValueOnce(new Error('SUPABASE_NOT_CONFIGURED'));
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
});

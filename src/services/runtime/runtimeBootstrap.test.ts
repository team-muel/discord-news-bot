import { beforeEach, describe, expect, it, vi } from 'vitest';

const startAutomationJobs = vi.fn();
const startAutomationModules = vi.fn();
const isAutomationEnabled = vi.fn(() => true);
const startMemoryJobRunner = vi.fn();
const startObsidianLoreSyncLoop = vi.fn();
const startRetrievalEvalLoop = vi.fn();
const startRewardSignalLoop = vi.fn();
const startEvalAutoPromoteLoop = vi.fn();
const startAgentSloAlertLoop = vi.fn();
const startAgentDailyLearningLoop = vi.fn();
const startGotCutoverAutopilotLoop = vi.fn();
const autoSyncGuildTopologiesOnReady = vi.fn(() => Promise.resolve());
const startRuntimeAlerts = vi.fn();
const startOpencodePublishWorker = vi.fn();
const startBotAutoRecovery = vi.fn();
const startLoginSessionCleanupLoop = vi.fn();
const bootstrapPgCronJobs = vi.fn<
  () => Promise<{
    enabled: boolean;
    jobs: Array<{ jobName: string; status: 'created' | 'exists' | 'error'; message?: string }>;
  }>
>(() => Promise.resolve({ enabled: true, jobs: [] }));
const startConsolidationLoop = vi.fn();
const startObsidianInboxChatLoop = vi.fn();

const getPgCronReplacedLoopsFromBootstrap = vi.fn((result?: { jobs?: Array<{ jobName: string; status: string }> }) => {
  const replacements: Record<string, string> = {
    muel_memory_consolidation: 'consolidationLoop',
    muel_slo_check: 'agentSloAlertLoop',
    muel_login_session_cleanup: 'loginSessionCleanupLoop',
    muel_obsidian_lore_sync: 'obsidianLoreSyncLoop',
    muel_retrieval_eval: 'retrievalEvalLoop',
    muel_reward_signal: 'rewardSignalLoop',
    muel_eval_auto_promote: 'evalAutoPromoteLoop',
  };
  return new Set(
    (result?.jobs || [])
      .filter((job) => job.status === 'created' || job.status === 'exists')
      .map((job) => replacements[job.jobName])
      .filter(Boolean),
  );
});

vi.mock('../automationBot', () => ({
  isAutomationEnabled,
  startAutomationJobs,
  startAutomationModules,
}));
vi.mock('../memory/memoryJobRunner', () => ({ startMemoryJobRunner }));
vi.mock('../memory/memoryConsolidationService', () => ({ startConsolidationLoop }));
vi.mock('../obsidian/obsidianInboxChatLoopService', () => ({ startObsidianInboxChatLoop }));
vi.mock('../obsidian/obsidianLoreSyncService', () => ({ startObsidianLoreSyncLoop }));
vi.mock('../eval/retrievalEvalLoopService', () => ({ startRetrievalEvalLoop }));
vi.mock('../eval/rewardSignalLoopService', () => ({ startRewardSignalLoop }));
vi.mock('../eval/evalAutoPromoteLoopService', () => ({ startEvalAutoPromoteLoop }));
vi.mock('../agent/agentSloService', () => ({ startAgentSloAlertLoop }));
vi.mock('../agent/agentOpsService', () => ({
  startAgentDailyLearningLoop,
  startGotCutoverAutopilotLoop,
}));
vi.mock('../discord-support/discordTopologySyncService', () => ({ autoSyncGuildTopologiesOnReady }));
vi.mock('./runtimeAlertService', () => ({ startRuntimeAlerts }));
vi.mock('../opencode/opencodePublishWorker', () => ({ startOpencodePublishWorker }));
vi.mock('./botAutoRecoveryService', () => ({ startBotAutoRecovery }));
vi.mock('../../discord/auth', () => ({ startLoginSessionCleanupLoop }));
vi.mock('../infra/pgCronBootstrapService', () => ({
  bootstrapPgCronJobs,
  getPgCronReplacedLoopsFromBootstrap,
}));
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>();
  return { ...actual, PG_CRON_REPLACES_APP_LOOPS: false };
});
vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('runtimeBootstrap', () => {
  const flushBootstrap = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    isAutomationEnabled.mockReturnValue(true);
    bootstrapPgCronJobs.mockResolvedValue({ enabled: true, jobs: [] });
  });

  it('server runtime은 공유 루프/서버 소유 루프를 1회만 시작한다', async () => {
    const runtime = await import('./runtimeBootstrap');

    runtime.startServerProcessRuntime();
    runtime.startServerProcessRuntime();

    expect(startAutomationJobs).toHaveBeenCalledTimes(1);
    expect(startMemoryJobRunner).toHaveBeenCalledTimes(1);
    expect(startConsolidationLoop).toHaveBeenCalledTimes(1);
    expect(startObsidianInboxChatLoop).toHaveBeenCalledTimes(1);
    expect(startOpencodePublishWorker).toHaveBeenCalledTimes(1);
    expect(startRuntimeAlerts).toHaveBeenCalledTimes(1);
    expect(startBotAutoRecovery).toHaveBeenCalledTimes(1);

    expect(runtime.getRuntimeBootstrapState()).toMatchObject({
      serverStarted: true,
      sharedLoopsStarted: true,
      sharedLoopsSource: 'server-process',
    });
  });

  it('discord ready runtime은 디스코드 소유 루프를 시작하고 공유 루프 중복 실행을 피한다', async () => {
    const runtime = await import('./runtimeBootstrap');

    runtime.startServerProcessRuntime();
    const client = {
      guilds: {
        cache: {
          values: () => [][Symbol.iterator](),
        },
      },
    } as any;

    runtime.startDiscordReadyRuntime(client);
    runtime.startDiscordReadyRuntime(client);

    expect(startAutomationModules).toHaveBeenCalledTimes(1);
    expect(startAgentDailyLearningLoop).toHaveBeenCalledTimes(1);
    expect(startGotCutoverAutopilotLoop).toHaveBeenCalledTimes(1);
    expect(startLoginSessionCleanupLoop).toHaveBeenCalledTimes(1);
    expect(startObsidianLoreSyncLoop).toHaveBeenCalledTimes(1);
    expect(startRetrievalEvalLoop).toHaveBeenCalledTimes(1);
    expect(startAgentSloAlertLoop).toHaveBeenCalledTimes(1);

    // shared loop는 server runtime에서 이미 시작했으므로 추가 실행되지 않는다.
    expect(startMemoryJobRunner).toHaveBeenCalledTimes(1);
    expect(startObsidianInboxChatLoop).toHaveBeenCalledTimes(1);

    expect(runtime.getRuntimeBootstrapState()).toMatchObject({
      serverStarted: true,
      discordReadyStarted: true,
      sharedLoopsStarted: true,
      sharedLoopsSource: 'server-process',
    });
  });

  it('PG_CRON_REPLACES_APP_LOOPS=true일 때 pg_cron 소유 루프를 건너뛴다', async () => {
    // Reset modules so we can re-mock config with replaces=true
    vi.resetModules();
    vi.clearAllMocks();

    // Re-setup mocks with PG_CRON_REPLACES_APP_LOOPS=true
    vi.doMock('../../config', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../config')>();
      return { ...actual, PG_CRON_REPLACES_APP_LOOPS: true };
    });
    vi.doMock('../infra/pgCronBootstrapService', () => ({
      bootstrapPgCronJobs,
      getPgCronReplacedLoopsFromBootstrap,
    }));

    bootstrapPgCronJobs.mockResolvedValue({
      enabled: true,
      jobs: [
        { jobName: 'muel_memory_consolidation', status: 'exists' },
        { jobName: 'muel_slo_check', status: 'exists' },
        { jobName: 'muel_login_session_cleanup', status: 'exists' },
        { jobName: 'muel_obsidian_lore_sync', status: 'exists' },
        { jobName: 'muel_retrieval_eval', status: 'exists' },
        { jobName: 'muel_reward_signal', status: 'exists' },
        { jobName: 'muel_eval_auto_promote', status: 'exists' },
      ],
    });

    const runtime = await import('./runtimeBootstrap');
    runtime.startServerProcessRuntime();

    const client = {
      guilds: { cache: { values: () => [][Symbol.iterator]() } },
    } as any;
    runtime.startDiscordReadyRuntime(client);
    await flushBootstrap();

    // pg_cron이 소유한 루프는 호출되지 않아야 한다
    expect(startConsolidationLoop).not.toHaveBeenCalled();
    expect(startAgentSloAlertLoop).not.toHaveBeenCalled();
    expect(startLoginSessionCleanupLoop).not.toHaveBeenCalled();
    expect(startObsidianLoreSyncLoop).not.toHaveBeenCalled();
    expect(startRetrievalEvalLoop).not.toHaveBeenCalled();
    expect(startRewardSignalLoop).not.toHaveBeenCalled();
    expect(startEvalAutoPromoteLoop).not.toHaveBeenCalled();

    // pg_cron과 무관한 루프는 정상 실행
    expect(startMemoryJobRunner).toHaveBeenCalledTimes(1);
    expect(startObsidianInboxChatLoop).toHaveBeenCalledTimes(1);

    expect(runtime.getRuntimeBootstrapState()).toMatchObject({
      serverStarted: true,
      discordReadyStarted: true,
      pgCron: {
        status: 'ready',
      },
      pgCronReplacedLoops: expect.arrayContaining(['consolidationLoop', 'agentSloAlertLoop', 'retrievalEvalLoop', 'rewardSignalLoop', 'evalAutoPromoteLoop']),
    });
  });

  it('PG_CRON_REPLACES_APP_LOOPS=true여도 bootstrap이 실패하면 앱 루프로 fallback한다', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock('../../config', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../config')>();
      return { ...actual, PG_CRON_REPLACES_APP_LOOPS: true };
    });
    vi.doMock('../infra/pgCronBootstrapService', () => ({
      bootstrapPgCronJobs,
      getPgCronReplacedLoopsFromBootstrap,
    }));

    bootstrapPgCronJobs.mockResolvedValue({
      enabled: true,
      jobs: [
        { jobName: 'muel_memory_consolidation', status: 'error', message: 'RPC not deployed' },
      ],
    });

    const runtime = await import('./runtimeBootstrap');
    runtime.startServerProcessRuntime();

    const client = {
      guilds: { cache: { values: () => [][Symbol.iterator]() } },
    } as any;
    runtime.startDiscordReadyRuntime(client);
    await flushBootstrap();

    expect(startConsolidationLoop).toHaveBeenCalledTimes(1);
    expect(startLoginSessionCleanupLoop).toHaveBeenCalledTimes(1);
    expect(startObsidianLoreSyncLoop).toHaveBeenCalledTimes(1);
    expect(startRetrievalEvalLoop).toHaveBeenCalledTimes(1);
    expect(startAgentSloAlertLoop).toHaveBeenCalledTimes(1);

    expect(runtime.getRuntimeBootstrapState()).toMatchObject({
      pgCron: {
        status: 'failed',
      },
      pgCronReplacedLoops: [],
    });
  });
});

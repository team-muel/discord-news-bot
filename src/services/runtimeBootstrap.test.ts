import { beforeEach, describe, expect, it, vi } from 'vitest';

const startAutomationJobs = vi.fn();
const startAutomationModules = vi.fn();
const isAutomationEnabled = vi.fn(() => true);
const startMemoryJobRunner = vi.fn();
const startObsidianLoreSyncLoop = vi.fn();
const startRetrievalEvalLoop = vi.fn();
const startAgentSloAlertLoop = vi.fn();
const startAgentDailyLearningLoop = vi.fn();
const startGotCutoverAutopilotLoop = vi.fn();
const autoSyncGuildTopologiesOnReady = vi.fn(() => Promise.resolve());
const startRuntimeAlerts = vi.fn();
const startTradingEngine = vi.fn();
const startOpencodePublishWorker = vi.fn();
const startBotAutoRecovery = vi.fn();
const startLoginSessionCleanupLoop = vi.fn();

vi.mock('./automationBot', () => ({
  isAutomationEnabled,
  startAutomationJobs,
  startAutomationModules,
}));
vi.mock('./memoryJobRunner', () => ({ startMemoryJobRunner }));
vi.mock('./obsidianLoreSyncService', () => ({ startObsidianLoreSyncLoop }));
vi.mock('./retrievalEvalLoopService', () => ({ startRetrievalEvalLoop }));
vi.mock('./agentSloService', () => ({ startAgentSloAlertLoop }));
vi.mock('./agentOpsService', () => ({
  startAgentDailyLearningLoop,
  startGotCutoverAutopilotLoop,
}));
vi.mock('./discordTopologySyncService', () => ({ autoSyncGuildTopologiesOnReady }));
vi.mock('./runtimeAlertService', () => ({ startRuntimeAlerts }));
vi.mock('./tradingEngine', () => ({ startTradingEngine }));
vi.mock('./opencodePublishWorker', () => ({ startOpencodePublishWorker }));
vi.mock('./botAutoRecoveryService', () => ({ startBotAutoRecovery }));
vi.mock('../discord/auth', () => ({ startLoginSessionCleanupLoop }));
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('runtimeBootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    isAutomationEnabled.mockReturnValue(true);
  });

  it('server runtime은 공유 루프/서버 소유 루프를 1회만 시작한다', async () => {
    const runtime = await import('./runtimeBootstrap');

    runtime.startServerProcessRuntime();
    runtime.startServerProcessRuntime();

    expect(startAutomationJobs).toHaveBeenCalledTimes(1);
    expect(startMemoryJobRunner).toHaveBeenCalledTimes(1);
    expect(startOpencodePublishWorker).toHaveBeenCalledTimes(1);
    expect(startTradingEngine).toHaveBeenCalledTimes(1);
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

    expect(runtime.getRuntimeBootstrapState()).toMatchObject({
      serverStarted: true,
      discordReadyStarted: true,
      sharedLoopsStarted: true,
      sharedLoopsSource: 'server-process',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  primeDiscordIngressCutoverPolicy: vi.fn(),
  getDiscordIngressCutoverSnapshot: vi.fn(),
  executeDiscordIngress: vi.fn(),
  getBotRuntimeSnapshot: vi.fn(),
  getAutomationRuntimeSnapshot: vi.fn(),
  isAutomationEnabled: vi.fn(),
  getMemoryJobQueueStats: vi.fn(),
  getMemoryJobRunnerStats: vi.fn(),
  getRuntimeAlertsStats: vi.fn(),
  getRuntimeSchedulerPolicySnapshot: vi.fn(),
  summarizeRuntimeHealth: vi.fn(),
  spawnSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
  },
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('../src/config', () => ({
  DISCORD_DOCS_INGRESS_ADAPTER: 'openclaw',
  DISCORD_DOCS_INGRESS_HARD_DISABLE: true,
  DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT: 25,
  DISCORD_DOCS_INGRESS_SHADOW_MODE: false,
  DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER: 'openclaw',
  DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE: false,
  DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT: 75,
  DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE: true,
  PORT: 3000,
  PUBLIC_BASE_URL: 'https://runtime.test',
  START_BOT: false,
}));

vi.mock('../src/bot', () => ({
  getBotRuntimeSnapshot: mocks.getBotRuntimeSnapshot,
}));

vi.mock('../src/services/automationBot', () => ({
  getAutomationRuntimeSnapshot: mocks.getAutomationRuntimeSnapshot,
  isAutomationEnabled: mocks.isAutomationEnabled,
}));

vi.mock('../src/services/memory/memoryJobRunner', () => ({
  getMemoryJobQueueStats: mocks.getMemoryJobQueueStats,
  getMemoryJobRunnerStats: mocks.getMemoryJobRunnerStats,
}));

vi.mock('../src/services/runtime/runtimeAlertService', () => ({
  getRuntimeAlertsStats: mocks.getRuntimeAlertsStats,
}));

vi.mock('../src/services/runtime/runtimeSchedulerPolicyService', () => ({
  getRuntimeSchedulerPolicySnapshot: mocks.getRuntimeSchedulerPolicySnapshot,
}));

vi.mock('../src/routes/health', () => ({
  summarizeRuntimeHealth: mocks.summarizeRuntimeHealth,
}));

vi.mock('../src/discord/runtime/discordIngressAdapter', () => ({
  DISCORD_INGRESS_CUTOVER_SNAPSHOT_PATH: 'tmp/discord-ingress-cutover/latest.json',
  executeDiscordIngress: mocks.executeDiscordIngress,
  getDiscordIngressCutoverSnapshot: mocks.getDiscordIngressCutoverSnapshot,
  primeDiscordIngressCutoverPolicy: mocks.primeDiscordIngressCutoverPolicy,
}));

describe('run-chat-sdk-discord-cutover-validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);

    mocks.getBotRuntimeSnapshot.mockReturnValue({ ready: false });
    mocks.getAutomationRuntimeSnapshot.mockReturnValue({ healthy: false });
    mocks.isAutomationEnabled.mockReturnValue(true);
    mocks.getMemoryJobQueueStats.mockResolvedValue({ deadlettered: 0 });
    mocks.getMemoryJobRunnerStats.mockReturnValue({ enabled: true });
    mocks.getRuntimeAlertsStats.mockReturnValue({ enabled: true });
    mocks.getRuntimeSchedulerPolicySnapshot.mockResolvedValue({
      summary: {
        total: 1,
        appOwned: 1,
        dbOwned: 0,
        enabled: 1,
        running: 0,
      },
    });
    mocks.spawnSync.mockImplementation((command: string, args?: string[]) => {
      if (command === 'git' && args?.[0] === 'rev-parse') {
        return { status: 0, stdout: 'da348ab\n', stderr: '' };
      }

      return { status: 0, stdout: '', stderr: '' };
    });
    mocks.summarizeRuntimeHealth.mockReturnValue({
      healthy: false,
      status: 'degraded',
      botStatusGrade: 'offline',
      anyEnabled: true,
      allEnabledHealthy: false,
    });
    mocks.fetch.mockRejectedValue(new Error('offline'));
    mocks.getDiscordIngressCutoverSnapshot.mockReturnValue({
      policyBySurface: {
        'docs-command': {
          preferredAdapterId: 'openclaw',
          hardDisable: true,
          shadowMode: false,
          rolloutPercentage: 25,
          mode: 'rollback',
          lastUpdatedAt: '2026-04-17T12:00:00.000Z',
        },
        'muel-message': {
          preferredAdapterId: 'openclaw',
          hardDisable: false,
          shadowMode: true,
          rolloutPercentage: 75,
          mode: 'shadow',
          lastUpdatedAt: '2026-04-17T12:00:00.000Z',
        },
      },
      totals: {
        adapterErrorCount: 0,
        legacyFallbackCount: 0,
      },
      totalsBySource: {
        live: {
          adapterErrorCount: 0,
          legacyFallbackCount: 0,
        },
      },
      rollback: {
        forcedFallbackCount: 0,
        forcedFallbackCountBySource: {
          live: 0,
        },
      },
      surfaces: {
        'docs-command': {
          total: 0,
          selectedByRolloutCount: 0,
          adapterAcceptCount: 0,
          shadowOnlyCount: 0,
          bySource: {
            live: {
              total: 0,
              selectedByRolloutCount: 0,
              adapterAcceptCount: 0,
              shadowOnlyCount: 0,
            },
          },
        },
        'muel-message': {
          total: 0,
          selectedByRolloutCount: 0,
          adapterAcceptCount: 0,
          shadowOnlyCount: 0,
          bySource: {
            live: {
              total: 0,
              selectedByRolloutCount: 0,
              adapterAcceptCount: 0,
              shadowOnlyCount: 0,
            },
          },
        },
      },
      recentEvents: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('primes cutover policy with hard-disable state from config', async () => {
    const originalArgv = process.argv;
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? ''}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.argv = [originalArgv[0] || 'node', 'vitest', '--dryRun=true', '--runChecks=false'];
      const module = await import('./run-chat-sdk-discord-cutover-validation');
      await expect(module.runChatSdkDiscordCutoverValidation()).rejects.toThrow('process.exit:2');
    } finally {
      process.argv = originalArgv;
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(mocks.primeDiscordIngressCutoverPolicy).toHaveBeenNthCalledWith(1, 'docs-command', {
      preferredAdapterId: 'openclaw',
      hardDisable: true,
      shadowMode: false,
      rolloutPercentage: 25,
    });
    expect(mocks.primeDiscordIngressCutoverPolicy).toHaveBeenNthCalledWith(2, 'muel-message', {
      preferredAdapterId: 'openclaw',
      hardDisable: false,
      shadowMode: true,
      rolloutPercentage: 75,
    });
  });

  it('parses rollback rehearsal payload from full stdout even when the tail is clipped', async () => {
    const originalArgv = process.argv;
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? ''}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.summarizeRuntimeHealth.mockReturnValue({
      healthy: true,
      status: 'ok',
      botStatusGrade: 'ready',
      anyEnabled: true,
      allEnabledHealthy: true,
    });
    mocks.getBotRuntimeSnapshot.mockReturnValue({ ready: true });
    mocks.getAutomationRuntimeSnapshot.mockReturnValue({ healthy: true });
    mocks.executeDiscordIngress.mockImplementation(async (_request, policy) => {
      if (policy.hardDisable) {
        return {
          telemetry: {
            routeDecision: 'legacy_fallback',
            fallbackReason: 'hard_disabled',
            selectedByRollout: true,
          },
        };
      }

      return {
        telemetry: {
          routeDecision: 'adapter_accept',
          fallbackReason: null,
          selectedByRollout: true,
        },
      };
    });
    mocks.getDiscordIngressCutoverSnapshot
      .mockReturnValueOnce({
        policyBySurface: {
          'docs-command': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
          'muel-message': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
        },
        totals: {
          adapterErrorCount: 0,
          legacyFallbackCount: 0,
        },
        totalsBySource: {
          live: {
            adapterErrorCount: 0,
            legacyFallbackCount: 0,
          },
        },
        rollback: {
          forcedFallbackCount: 0,
          forcedFallbackCountBySource: {
            live: 0,
          },
        },
        surfaces: {
          'docs-command': {
            total: 1,
            selectedByRolloutCount: 1,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
          'muel-message': {
            total: 1,
            selectedByRolloutCount: 1,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
        },
        recentEvents: [],
      })
      .mockReturnValueOnce({
        policyBySurface: {
          'docs-command': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
          'muel-message': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
        },
        totals: {
          adapterErrorCount: 0,
          legacyFallbackCount: 0,
        },
        totalsBySource: {
          live: {
            adapterErrorCount: 0,
            legacyFallbackCount: 0,
          },
        },
        rollback: {
          forcedFallbackCount: 0,
          forcedFallbackCountBySource: {
            live: 0,
          },
        },
        surfaces: {
          'docs-command': {
            total: 1,
            selectedByRolloutCount: 1,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
          'muel-message': {
            total: 1,
            selectedByRolloutCount: 1,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
        },
        recentEvents: [
          {
            telemetry: {
              surface: 'docs-command',
              evidenceSource: 'live',
              routeDecision: 'adapter_accept',
              selectedAdapterId: 'openclaw',
              adapterId: 'openclaw',
            },
          },
          {
            telemetry: {
              surface: 'muel-message',
              evidenceSource: 'live',
              routeDecision: 'adapter_accept',
              selectedAdapterId: 'openclaw',
              adapterId: 'openclaw',
            },
          },
        ],
      });
    mocks.spawnSync.mockImplementation((command: string, args?: string[]) => {
      if (command === 'git' && args?.[0] === 'rev-parse') {
        return { status: 0, stdout: 'da348ab\n', stderr: '' };
      }

      if (command === 'cmd.exe' && args?.[3]?.includes('run-stage-rollback-rehearsal')) {
        return {
          status: 0,
          stdout: '{\n  "overall": "pass",\n  "payload": {\n    "accepted": true\n  }\n}\n',
          stderr: '',
        };
      }

      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      process.argv = [
        originalArgv[0] || 'node',
        'vitest',
        '--dryRun=false',
        '--runChecks=false',
        '--exerciseLiveEvidence=false',
        '--exerciseLabEvidence=true',
        '--acceptLabEvidence=true',
        '--exerciseRollback=true',
        '--rollbackDryRun=true',
      ];
      const module = await import('./run-chat-sdk-discord-cutover-validation');
      await expect(module.runChatSdkDiscordCutoverValidation()).rejects.toThrow('process.exit:2');
    } finally {
      process.argv = originalArgv;
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    const jsonWrite = mocks.writeFileSync.mock.calls.find(([target]) => String(target).endsWith('.json'));
    expect(jsonWrite).toBeDefined();
    const report = JSON.parse(String(jsonWrite?.[1] || '{}')) as {
      rollback: { verdict: string; reason: string };
      evidence: { rollback_rehearsal_payload: { overall: string } | null };
      required_actions: string[];
    };

    expect(report.rollback.verdict).toBe('pass');
    expect(report.rollback.reason).toBe('rollback rehearsal passed');
    expect(report.evidence.rollback_rehearsal_payload).toMatchObject({ overall: 'pass' });
    expect(report.required_actions).toEqual([]);
  });

  it('uses external health evidence when in-process runtime snapshots are cold', async () => {
    const originalArgv = process.argv;
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? ''}`);
    }) as never);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        status: 'ok',
        botStatusGrade: 'healthy',
        bot: { ready: true },
        automation: { healthy: true },
        schedulerPolicySummary: {
          total: 2,
          appOwned: 1,
          dbOwned: 1,
          enabled: 2,
          running: 2,
        },
      }),
    });

    try {
      process.argv = [
        originalArgv[0] || 'node',
        'vitest',
        '--dryRun=false',
        '--runChecks=false',
        '--exerciseLiveEvidence=false',
      ];
      const module = await import('./run-chat-sdk-discord-cutover-validation');
      await expect(module.runChatSdkDiscordCutoverValidation()).rejects.toThrow('process.exit:2');
    } finally {
      process.argv = originalArgv;
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    const jsonWrite = mocks.writeFileSync.mock.calls.find(([target]) => String(target).endsWith('.json'));
    expect(jsonWrite).toBeDefined();
    const report = JSON.parse(String(jsonWrite?.[1] || '{}')) as {
      operator_runtime: {
        verdict: string;
        source: string;
        url: string | null;
        bot_ready: boolean;
        automation_healthy: boolean;
        scheduler_policy_summary: { total: number };
      };
    };

    expect(report.operator_runtime).toMatchObject({
      verdict: 'pass',
      source: 'external-health',
      bot_ready: true,
      automation_healthy: true,
      scheduler_policy_summary: { total: 2 },
    });
    expect(report.operator_runtime.url).toContain('/health');
  });

  it('collects operator-driven live evidence by default for non-dry validation runs', async () => {
    const originalArgv = process.argv;
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      json: async () => ({
        status: 'ok',
        botStatusGrade: 'healthy',
        bot: { ready: true },
        automation: { healthy: true },
        schedulerPolicySummary: {
          total: 2,
          appOwned: 1,
          dbOwned: 1,
          enabled: 2,
          running: 2,
        },
      }),
    });
    mocks.executeDiscordIngress.mockImplementation(async (_request, policy) => {
      if (policy.hardDisable) {
        return {
          telemetry: {
            routeDecision: 'legacy_fallback',
            fallbackReason: 'hard_disabled',
            selectedByRollout: true,
          },
        };
      }

      return {
        telemetry: {
          routeDecision: policy.shadowMode ? 'shadow_only' : 'adapter_accept',
          fallbackReason: policy.shadowMode ? 'shadow_mode' : null,
          selectedByRollout: true,
        },
      };
    });
    mocks.getDiscordIngressCutoverSnapshot
      .mockReturnValueOnce({
        policyBySurface: {
          'docs-command': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
          'muel-message': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
        },
        totals: {
          adapterErrorCount: 0,
          legacyFallbackCount: 0,
        },
        totalsBySource: {
          live: {
            adapterErrorCount: 0,
            legacyFallbackCount: 0,
          },
        },
        rollback: {
          forcedFallbackCount: 0,
          forcedFallbackCountBySource: {
            live: 0,
          },
        },
        surfaces: {
          'docs-command': {
            total: 0,
            selectedByRolloutCount: 0,
            adapterAcceptCount: 0,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
          'muel-message': {
            total: 0,
            selectedByRolloutCount: 0,
            adapterAcceptCount: 0,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 0,
                selectedByRolloutCount: 0,
                adapterAcceptCount: 0,
                shadowOnlyCount: 0,
              },
            },
          },
        },
        recentEvents: [],
      })
      .mockReturnValueOnce({
        policyBySurface: {
          'docs-command': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
          'muel-message': {
            preferredAdapterId: 'openclaw',
            hardDisable: false,
            shadowMode: false,
            rolloutPercentage: 100,
            mode: 'default-on',
            lastUpdatedAt: '2026-04-17T12:00:00.000Z',
          },
        },
        totals: {
          adapterErrorCount: 0,
          legacyFallbackCount: 1,
        },
        totalsBySource: {
          live: {
            adapterErrorCount: 0,
            legacyFallbackCount: 1,
          },
        },
        rollback: {
          forcedFallbackCount: 1,
          forcedFallbackCountBySource: {
            live: 1,
          },
        },
        surfaces: {
          'docs-command': {
            total: 2,
            selectedByRolloutCount: 2,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 2,
                selectedByRolloutCount: 2,
                adapterAcceptCount: 1,
                shadowOnlyCount: 0,
              },
            },
          },
          'muel-message': {
            total: 1,
            selectedByRolloutCount: 1,
            adapterAcceptCount: 1,
            shadowOnlyCount: 0,
            bySource: {
              live: {
                total: 1,
                selectedByRolloutCount: 1,
                adapterAcceptCount: 1,
                shadowOnlyCount: 0,
              },
            },
          },
        },
        recentEvents: [
          {
            telemetry: {
              surface: 'docs-command',
              evidenceSource: 'live',
              routeDecision: 'adapter_accept',
              selectedAdapterId: 'openclaw',
              adapterId: 'openclaw',
            },
          },
          {
            telemetry: {
              surface: 'muel-message',
              evidenceSource: 'live',
              routeDecision: 'adapter_accept',
              selectedAdapterId: 'openclaw',
              adapterId: 'openclaw',
            },
          },
        ],
      });

    try {
      process.argv = [
        originalArgv[0] || 'node',
        'vitest',
        '--dryRun=false',
      ];
      const module = await import('./run-chat-sdk-discord-cutover-validation');
      await expect(module.runChatSdkDiscordCutoverValidation()).resolves.toBeUndefined();
    } finally {
      process.argv = originalArgv;
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }

    expect(mocks.executeDiscordIngress).toHaveBeenCalledTimes(3);

    const jsonWrite = mocks.writeFileSync.mock.calls.find(([target]) => String(target).endsWith('.json'));
    expect(jsonWrite).toBeDefined();
    const report = JSON.parse(String(jsonWrite?.[1] || '{}')) as {
      overall: string;
      live_rehearsal: { exercised: boolean } | null;
      rollback: { verdict: string };
      required_actions: string[];
    };

    expect(report.overall).toBe('go');
    expect(report.live_rehearsal).toMatchObject({ exercised: true });
    expect(report.rollback.verdict).toBe('pass');
    expect(report.required_actions).toEqual([]);
  });
});
import { describe, expect, it } from 'vitest';

import { buildRuntimeDiagnosticsPayload, evaluateRuntimeReadiness, summarizeRuntimeHealth } from './health';

describe('evaluateRuntimeReadiness', () => {
  it('requires the bot to be ready when START_BOT is enabled', () => {
    const result = evaluateRuntimeReadiness({
      botEnabled: true,
      botReady: false,
      automationEnabled: true,
      automationReady: true,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 503,
      detail: 'bot_not_ready',
    });
  });

  it('stays ready when the bot is healthy even if automation is degraded', () => {
    const result = evaluateRuntimeReadiness({
      botEnabled: true,
      botReady: true,
      automationEnabled: true,
      automationReady: false,
    });

    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      detail: 'bot_ready_automation_degraded',
    });
  });

  it('falls back to automation readiness only when the bot is disabled', () => {
    const result = evaluateRuntimeReadiness({
      botEnabled: false,
      botReady: false,
      automationEnabled: true,
      automationReady: true,
    });

    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      detail: 'automation_ready',
    });
  });

  it('marks all-disabled runtime as not ready', () => {
    const result = evaluateRuntimeReadiness({
      botEnabled: false,
      botReady: false,
      automationEnabled: false,
      automationReady: false,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 503,
      detail: 'all_disabled',
    });
  });
});

describe('summarizeRuntimeHealth', () => {
  it('reports degraded when all workloads are disabled', () => {
    const result = summarizeRuntimeHealth({
      botEnabled: false,
      botReady: false,
      automationEnabled: false,
      automationReady: false,
    });

    expect(result).toEqual({
      status: 'degraded',
      botStatusGrade: 'offline',
      anyEnabled: false,
      healthy: false,
      allEnabledHealthy: true,
    });
  });

  it('reports degraded when automation is unhealthy behind a healthy bot', () => {
    const result = summarizeRuntimeHealth({
      botEnabled: true,
      botReady: true,
      automationEnabled: true,
      automationReady: false,
    });

    expect(result).toEqual({
      status: 'degraded',
      botStatusGrade: 'degraded',
      anyEnabled: true,
      healthy: true,
      allEnabledHealthy: false,
    });
  });
});

describe('buildRuntimeDiagnosticsPayload', () => {
  const runtimeBootstrap = {
    serverStarted: true,
    discordReadyStarted: true,
    sharedLoopsStarted: true,
    sharedLoopsSource: 'server-process' as const,
    pgCronReplacedLoops: ['consolidationLoop'],
    pgCron: {
      status: 'failed' as const,
      startedAt: '2026-04-11T00:00:00.000Z',
      completedAt: '2026-04-11T00:01:00.000Z',
      lastError: 'RPC not deployed',
      deferredTaskCount: 2,
      summary: {
        totalJobs: 1,
        created: 0,
        existing: 0,
        error: 1,
        confirmedLoopCount: 0,
      },
    },
  };

  const startup = {
    summary: {
      total: 2,
      idle: 0,
      pending: 0,
      ok: 1,
      warn: 1,
      skipped: 0,
    },
    tasks: [
      {
        id: 'adapter-auto-load',
        label: 'Adapter auto-load',
        status: 'warn' as const,
        updatedAt: '2026-04-11T00:01:00.000Z',
        message: 'adapters-directory: EACCES',
      },
    ],
  };

  it('공개 health payload에서는 상세 진단을 숨긴다', () => {
    const result = buildRuntimeDiagnosticsPayload(runtimeBootstrap, startup, false);

    expect(result).toEqual({
      diagnosticsVisibility: 'public',
      runtimeBootstrap: {
        serverStarted: true,
        discordReadyStarted: true,
        sharedLoopsStarted: true,
        sharedLoopsSource: 'server-process',
        pgCron: {
          status: 'failed',
          startedAt: '2026-04-11T00:00:00.000Z',
          completedAt: '2026-04-11T00:01:00.000Z',
          deferredTaskCount: 2,
          summary: {
            totalJobs: 1,
            created: 0,
            existing: 0,
            error: 1,
            confirmedLoopCount: 0,
          },
        },
      },
      startup: {
        summary: {
          total: 2,
          idle: 0,
          pending: 0,
          ok: 1,
          warn: 1,
          skipped: 0,
        },
      },
    });
  });

  it('관리자 health payload에서는 상세 진단을 포함한다', () => {
    const result = buildRuntimeDiagnosticsPayload(runtimeBootstrap, startup, true);

    expect(result).toEqual({
      diagnosticsVisibility: 'admin',
      runtimeBootstrap: {
        serverStarted: true,
        discordReadyStarted: true,
        sharedLoopsStarted: true,
        sharedLoopsSource: 'server-process',
        pgCron: {
          status: 'failed',
          startedAt: '2026-04-11T00:00:00.000Z',
          completedAt: '2026-04-11T00:01:00.000Z',
          lastError: 'RPC not deployed',
          deferredTaskCount: 2,
          replacedLoops: ['consolidationLoop'],
          summary: {
            totalJobs: 1,
            created: 0,
            existing: 0,
            error: 1,
            confirmedLoopCount: 0,
          },
        },
      },
      startup,
    });
  });
});
import { describe, expect, it } from 'vitest';

import { evaluateRuntimeReadiness, summarizeRuntimeHealth } from './health';

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
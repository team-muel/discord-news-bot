import { Router } from 'express';
import type { HealthResponse } from '../contracts/bot';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT } from '../config';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../services/automationBot';
import { resolveLlmProvider } from '../services/llmClient';
import { parseBooleanEnv } from '../utils/env';

const EXTERNAL_TOOL_PROBE_ENABLED = parseBooleanEnv(process.env.EXTERNAL_TOOL_PROBE_ENABLED, false);

export type RuntimeReadinessState = {
  botEnabled: boolean;
  botReady: boolean;
  automationEnabled: boolean;
  automationReady: boolean;
};

export const evaluateRuntimeReadiness = (state: RuntimeReadinessState) => {
  if (!state.botEnabled && !state.automationEnabled) {
    return {
      ok: false,
      statusCode: 503,
      detail: 'all_disabled',
    } as const;
  }

  if (state.botEnabled && !state.botReady) {
    return {
      ok: false,
      statusCode: 503,
      detail: 'bot_not_ready',
    } as const;
  }

  if (!state.botEnabled && state.automationEnabled && !state.automationReady) {
    return {
      ok: false,
      statusCode: 503,
      detail: 'automation_not_ready',
    } as const;
  }

  if (state.botEnabled && state.botReady && state.automationEnabled && state.automationReady) {
    return {
      ok: true,
      statusCode: 200,
      detail: 'all_ready',
    } as const;
  }

  if (state.botEnabled && state.botReady && state.automationEnabled && !state.automationReady) {
    return {
      ok: true,
      statusCode: 200,
      detail: 'bot_ready_automation_degraded',
    } as const;
  }

  if (state.botEnabled && state.botReady) {
    return {
      ok: true,
      statusCode: 200,
      detail: 'bot_ready',
    } as const;
  }

  return {
    ok: Boolean(state.automationEnabled && state.automationReady),
    statusCode: state.automationEnabled && state.automationReady ? 200 : 503,
    detail: state.automationEnabled && state.automationReady ? 'automation_ready' : 'automation_not_ready',
  } as const;
};

export function createHealthRouter(): Router {
  const router = Router();

  const buildBotSnapshot = () => {
    const bot = getBotRuntimeSnapshot();
    return {
      ...bot,
      dynamicWorkerRestore: {
        enabled: Boolean(bot.dynamicWorkerRestoreEnabled),
        attemptedAt: bot.dynamicWorkerRestoreAttemptedAt,
        approvedCount: Number(bot.dynamicWorkerRestoreApprovedCount || 0),
        restoredCount: Number(bot.dynamicWorkerRestoreSuccessCount || 0),
        failedCount: Number(bot.dynamicWorkerRestoreFailedCount || 0),
        lastError: bot.dynamicWorkerRestoreLastError || null,
      },
    };
  };

  router.get('/health', (_req, res) => {
    const bot = buildBotSnapshot();
    const automation = getAutomationRuntimeSnapshot();

    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const botHealthy = botEnabled && bot.ready;
    const automationHealthy = automationEnabled && automation.healthy;
    const healthy = botHealthy || automationHealthy;
    const allEnabledHealthy = (!botEnabled || botHealthy) && (!automationEnabled || automationHealthy);
    const anyEnabled = botEnabled || automationEnabled;
    const status = allEnabledHealthy ? 'ok' : 'degraded';
    const botStatusGrade = !anyEnabled ? 'offline' : allEnabledHealthy ? 'healthy' : healthy ? 'degraded' : 'offline';

    const payload: HealthResponse = {
      status,
      botStatusGrade,
      uptimeSec: Math.floor(process.uptime()),
      bot,
      automation,
    };

    return res.status(200).json({
      ...payload,
      llmProvider: resolveLlmProvider() ?? 'none',
      openclawConfigured: Boolean(process.env.OPENCLAW_BASE_URL),
      externalToolProbeEnabled: EXTERNAL_TOOL_PROBE_ENABLED,
    });
  });

  router.get('/ready', (_req, res) => {
    const readiness = evaluateRuntimeReadiness({
      botEnabled: START_BOT,
      botReady: START_BOT && getBotRuntimeSnapshot().ready,
      automationEnabled: isAutomationEnabled(),
      automationReady: isAutomationEnabled() && getAutomationRuntimeSnapshot().healthy,
    });

    if (readiness.ok) {
      return res.status(readiness.statusCode).json({ status: 'ok', bot: readiness.detail });
    }

    return res.status(readiness.statusCode).json({ status: 'starting', bot: readiness.detail });
  });

  router.get('/api/status', (_req, res) => {
    return res.json({ status: 'ok', now: new Date().toISOString() });
  });

  router.get('/', (_req, res) => {
    res.send('Muel backend is running');
  });

  return router;
}

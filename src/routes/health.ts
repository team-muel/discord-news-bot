import { Router } from 'express';
import type { BotStatusGrade, HealthResponse } from '../contracts/bot';
import { getBotRuntimeSnapshot } from '../bot';
import { START_BOT } from '../config';
import { isUserAdmin } from '../services/adminAllowlistService';
import { getAutomationRuntimeSnapshot, isAutomationEnabled } from '../services/automationBot';
import { getExternalAdapterStatus } from '../services/tools/externalAdapterRegistry';
import { getDelegationStatus } from '../services/automation/n8nDelegationService';
import { getRuntimeBootstrapState } from '../services/runtime/runtimeBootstrap';
import { getServerInfrastructureStartupSnapshot } from '../services/runtime/bootstrapServerInfra';
import { getRuntimeSchedulerPolicySnapshot } from '../services/runtime/runtimeSchedulerPolicyService';
import { getLastMigrationValidation } from '../utils/migrationRegistry';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { existsSync, readdirSync } from 'node:fs';

export type RuntimeReadinessState = {
  botEnabled: boolean;
  botReady: boolean;
  automationEnabled: boolean;
  automationReady: boolean;
};

export const summarizeRuntimeHealth = (state: RuntimeReadinessState): {
  status: HealthResponse['status'];
  botStatusGrade: BotStatusGrade;
  anyEnabled: boolean;
  healthy: boolean;
  allEnabledHealthy: boolean;
} => {
  const botHealthy = state.botEnabled && state.botReady;
  const automationHealthy = state.automationEnabled && state.automationReady;
  const healthy = botHealthy || automationHealthy;
  const allEnabledHealthy = (!state.botEnabled || botHealthy) && (!state.automationEnabled || automationHealthy);
  const anyEnabled = state.botEnabled || state.automationEnabled;

  return {
    status: anyEnabled && allEnabledHealthy ? 'ok' : 'degraded',
    botStatusGrade: !anyEnabled ? 'offline' : allEnabledHealthy ? 'healthy' : healthy ? 'degraded' : 'offline',
    anyEnabled,
    healthy,
    allEnabledHealthy,
  };
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

export const buildRuntimeDiagnosticsPayload = (
  runtimeBootstrap: ReturnType<typeof getRuntimeBootstrapState>,
  startup: ReturnType<typeof getServerInfrastructureStartupSnapshot>,
  includeSensitiveDetails: boolean,
): Pick<HealthResponse, 'diagnosticsVisibility' | 'runtimeBootstrap' | 'startup'> => {
  const payload: Pick<HealthResponse, 'diagnosticsVisibility' | 'runtimeBootstrap' | 'startup'> = {
    diagnosticsVisibility: includeSensitiveDetails ? 'admin' : 'public',
    runtimeBootstrap: {
      serverStarted: runtimeBootstrap.serverStarted,
      discordReadyStarted: runtimeBootstrap.discordReadyStarted,
      sharedLoopsStarted: runtimeBootstrap.sharedLoopsStarted,
      sharedLoopsSource: runtimeBootstrap.sharedLoopsSource,
      pgCron: {
        status: runtimeBootstrap.pgCron.status,
        startedAt: runtimeBootstrap.pgCron.startedAt,
        completedAt: runtimeBootstrap.pgCron.completedAt,
        deferredTaskCount: runtimeBootstrap.pgCron.deferredTaskCount,
        summary: runtimeBootstrap.pgCron.summary,
      },
    },
    startup: {
      summary: startup.summary,
    },
  };

  if (includeSensitiveDetails) {
    payload.runtimeBootstrap!.pgCron.lastError = runtimeBootstrap.pgCron.lastError;
    payload.runtimeBootstrap!.pgCron.replacedLoops = runtimeBootstrap.pgCronReplacedLoops;
    payload.startup!.tasks = startup.tasks;
  }

  return payload;
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

  router.get('/health', async (req, res) => {
    const bot = buildBotSnapshot();
    const automation = getAutomationRuntimeSnapshot();

    const botEnabled = START_BOT;
    const automationEnabled = isAutomationEnabled();
    const runtimeHealth = summarizeRuntimeHealth({
      botEnabled,
      botReady: bot.ready,
      automationEnabled,
      automationReady: automation.healthy,
    });
    const runtimeBootstrap = getRuntimeBootstrapState();
    const startup = getServerInfrastructureStartupSnapshot();
    const includeSensitiveDiagnostics = req.user?.id
      ? await isUserAdmin(req.user.id).catch(() => false)
      : false;

    // n8n status: adapter availability + delegation config
    let n8nStatus: {
      adapterAvailable: boolean;
      delegationEnabled: boolean;
      delegationFirst: boolean;
      cacheAvailable: boolean | null;
      configuredTasks: number;
      totalTasks: number;
    } | undefined;

    try {
      const adapters = await getExternalAdapterStatus();
      const n8nAdapter = adapters.find((a: { id: string }) => a.id === 'n8n');
      const delegation = getDelegationStatus();
      const taskEntries = Object.values(delegation.tasks);

      n8nStatus = {
        adapterAvailable: n8nAdapter?.available ?? false,
        delegationEnabled: delegation.enabled,
        delegationFirst: delegation.delegationFirst,
        cacheAvailable: delegation.n8nCacheAvailable,
        configuredTasks: taskEntries.filter((t) => t.configured).length,
        totalTasks: taskEntries.length,
      };
    } catch {
      // Non-critical: don't fail health endpoint if n8n probe errors
    }

    // Obsidian vault readiness
    let obsidianStatus: HealthResponse['obsidian'];
    let schedulerPolicySummary: HealthResponse['schedulerPolicySummary'];
    const vaultPath = getObsidianVaultRoot();
    if (vaultPath) {
      const vaultExists = existsSync(vaultPath);
      let fileCount = 0;
      if (vaultExists) {
        try {
          const countMd = (dir: string): number => {
            let n = 0;
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory() && !entry.name.startsWith('.')) n += countMd(`${dir}/${entry.name}`);
              else if (entry.isFile() && entry.name.endsWith('.md')) n++;
            }
            return n;
          };
          fileCount = countMd(vaultPath);
        } catch { /* non-critical */ }
      }
      obsidianStatus = {
        vaultPath,
        vaultReady: vaultExists && fileCount > 0,
        fileCount,
      };
    }

    try {
      schedulerPolicySummary = (await getRuntimeSchedulerPolicySnapshot()).summary;
    } catch {
      // Non-critical: do not fail public health if scheduler snapshot is unavailable.
    }

    const payload: HealthResponse = {
      status: runtimeHealth.status,
      botStatusGrade: runtimeHealth.botStatusGrade,
      uptimeSec: Math.floor(process.uptime()),
      bot,
      automation,
      ...(n8nStatus ? { n8n: n8nStatus } : {}),
      ...(obsidianStatus ? { obsidian: obsidianStatus } : {}),
      ...(schedulerPolicySummary ? { schedulerPolicySummary } : {}),
      migrations: getLastMigrationValidation(),
      ...buildRuntimeDiagnosticsPayload(runtimeBootstrap, startup, includeSensitiveDiagnostics),
    };

    return res.status(200).json(payload);
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

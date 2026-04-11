import { rehydrateActivePipelines, listSprintPipelines } from '../sprint/sprintOrchestrator';
import { rehydrateActiveSessions } from '../multiAgentService';
import { rehydrateEventSourcingEntities } from '../sprint/eventSourcing/bridge';
import { startSprintScheduledTriggers } from '../sprint/sprintTriggers';
import { checkGitConfigHealth } from '../sprint/autonomousGit';
import { initMcpSkillRouter } from '../mcpSkillRouter';
import { syncHighRiskActionsToSandboxPolicy } from '../skills/actionRunner';
import { autoLoadAdapters } from '../tools/adapterAutoLoader';
import { wireSignalBusConsumers } from './signalBusWiring';
import { startTrustDecayTimer } from '../sprint/trustScoreService';
import { getErrorMessage } from '../../utils/errorMessage';
import logger from '../../logger';

const SANDBOX_POLICY_RESYNC_MS = 6 * 60 * 60_000;

type StartupTaskId =
  | 'sprint-rehydration'
  | 'agent-session-rehydration'
  | 'mcp-router-init'
  | 'sandbox-policy-sync'
  | 'adapter-auto-load'
  | 'observer-startup'
  | 'vault-schema-emit'
  | 'intent-formation-check';

type StartupTaskStatus = 'idle' | 'pending' | 'ok' | 'warn' | 'skipped';

type StartupTaskSnapshot = {
  label: string;
  status: StartupTaskStatus;
  updatedAt: string | null;
  message: string | null;
};

const STARTUP_TASK_LABELS: Record<StartupTaskId, string> = {
  'sprint-rehydration': 'Sprint rehydration',
  'agent-session-rehydration': 'Agent session rehydration',
  'mcp-router-init': 'MCP router initialization',
  'sandbox-policy-sync': 'Sandbox policy sync',
  'adapter-auto-load': 'Adapter auto-load',
  'observer-startup': 'Observer startup',
  'vault-schema-emit': 'Vault schema emit',
  'intent-formation-check': 'Intent formation startup check',
};

const createStartupTaskState = (): Record<StartupTaskId, StartupTaskSnapshot> => ({
  'sprint-rehydration': { label: STARTUP_TASK_LABELS['sprint-rehydration'], status: 'idle', updatedAt: null, message: null },
  'agent-session-rehydration': { label: STARTUP_TASK_LABELS['agent-session-rehydration'], status: 'idle', updatedAt: null, message: null },
  'mcp-router-init': { label: STARTUP_TASK_LABELS['mcp-router-init'], status: 'idle', updatedAt: null, message: null },
  'sandbox-policy-sync': { label: STARTUP_TASK_LABELS['sandbox-policy-sync'], status: 'idle', updatedAt: null, message: null },
  'adapter-auto-load': { label: STARTUP_TASK_LABELS['adapter-auto-load'], status: 'idle', updatedAt: null, message: null },
  'observer-startup': { label: STARTUP_TASK_LABELS['observer-startup'], status: 'idle', updatedAt: null, message: null },
  'vault-schema-emit': { label: STARTUP_TASK_LABELS['vault-schema-emit'], status: 'idle', updatedAt: null, message: null },
  'intent-formation-check': { label: STARTUP_TASK_LABELS['intent-formation-check'], status: 'idle', updatedAt: null, message: null },
});

const startupTaskState = createStartupTaskState();

const setStartupTaskState = (
  taskId: StartupTaskId,
  status: StartupTaskStatus,
  message: string | null,
): void => {
  startupTaskState[taskId] = {
    ...startupTaskState[taskId],
    status,
    updatedAt: new Date().toISOString(),
    message,
  };
};

const warnStartupTask = (taskId: StartupTaskId, tag: string, error: unknown): void => {
  const message = getErrorMessage(error);
  setStartupTaskState(taskId, 'warn', message);
  logger.warn('%s startup failed: %s', tag, message);
};

export const getServerInfrastructureStartupSnapshot = () => {
  const tasks = Object.entries(startupTaskState).map(([id, task]) => ({ id, ...task }));
  return {
    summary: {
      total: tasks.length,
      idle: tasks.filter((task) => task.status === 'idle').length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      ok: tasks.filter((task) => task.status === 'ok').length,
      warn: tasks.filter((task) => task.status === 'warn').length,
      skipped: tasks.filter((task) => task.status === 'skipped').length,
    },
    tasks,
  };
};

export const resetServerInfrastructureStartupSnapshot = (): void => {
  const next = createStartupTaskState();
  for (const key of Object.keys(next) as StartupTaskId[]) {
    startupTaskState[key] = next[key];
  }
};

/**
 * Bootstrap server-only infrastructure: sprint pipelines, MCP router,
 * sandbox policy, dynamic adapters, signal bus, and observer loop.
 */
export const bootstrapServerInfrastructure = (isPgCronOwned: (name: string) => boolean): void => {
  // Restore in-progress sprint pipelines from Supabase
  setStartupTaskState('sprint-rehydration', 'pending', 'Rehydrating active sprint pipelines');
  void rehydrateActivePipelines()
    .then(() => {
      // After legacy rehydration, populate Ventyd entityMap so shadow calls work
      const activeIds = listSprintPipelines(undefined, 50).map((p) => p.sprintId);
      if (activeIds.length > 0) {
        return rehydrateEventSourcingEntities(activeIds).then(() => {
          setStartupTaskState('sprint-rehydration', 'ok', `Rehydrated ${activeIds.length} active sprint pipeline(s)`);
        });
      }
      setStartupTaskState('sprint-rehydration', 'ok', 'No active sprint pipelines to rehydrate');
    })
    .catch((error) => {
      warnStartupTask('sprint-rehydration', '[SPRINT]', error);
    });

  // Restore in-progress agent sessions from Supabase
  setStartupTaskState('agent-session-rehydration', 'pending', 'Rehydrating active agent sessions');
  void rehydrateActiveSessions()
    .then(() => {
      setStartupTaskState('agent-session-rehydration', 'ok', 'Active agent sessions rehydrated');
    })
    .catch((error) => {
      warnStartupTask('agent-session-rehydration', '[AGENT]', error);
    });

  // Start scheduled sprint triggers (security audit, improvement)
  startSprintScheduledTriggers();

  // Initialize MCP skill router with health-aware worker discovery
  setStartupTaskState('mcp-router-init', 'pending', 'Initializing MCP router and local proxy');
  void initMcpSkillRouter()
    .then(async () => {
      // Register self (local Express MCP proxy) as a worker so sprint actions
      // can use the 162+ tools exposed at /api/mcp/rpc (native + upstream).
      const { PORT } = await import('../../config');
      const { registerLocalMcpProxy } = await import('../mcpLocalProxyWorker');
      await registerLocalMcpProxy(PORT);
      setStartupTaskState('mcp-router-init', 'ok', 'MCP router initialized and local proxy registered');
    })
    .catch((error) => {
      warnStartupTask('mcp-router-init', '[MCP-ROUTER]', error);
    });

  // Validate sprint git config at startup
  checkGitConfigHealth();

  // D-06: Sync high-risk actions to OpenShell sandbox policy at startup
  setStartupTaskState('sandbox-policy-sync', 'pending', 'Synchronizing high-risk actions to sandbox policy');
  void syncHighRiskActionsToSandboxPolicy()
    .then(() => {
      setStartupTaskState('sandbox-policy-sync', 'ok', 'Sandbox policy synchronized');
    })
    .catch((error) => {
      warnStartupTask('sandbox-policy-sync', '[SANDBOX-POLICY]', error);
    });

  // D-06: Periodic re-sync every 6 hours to catch env changes without restart
  setInterval(() => {
    void syncHighRiskActionsToSandboxPolicy().catch((error) => {
      logger.debug('[SANDBOX-POLICY] periodic sync skipped: %s', getErrorMessage(error));
    });
  }, SANDBOX_POLICY_RESYNC_MS);

  // M-15 / F-02: Auto-load dynamic adapters from adapters/ directory
  setStartupTaskState('adapter-auto-load', 'pending', 'Scanning dynamic adapters');
  void autoLoadAdapters()
    .then((result) => {
      const message = `loaded=${result.loaded} skipped=${result.skipped.length} errors=${result.errors.length}`;
      if (result.errors.length > 0) {
        const detail = `${message}; ${result.errors.slice(0, 3).join(' | ')}`;
        setStartupTaskState('adapter-auto-load', 'warn', detail);
        logger.warn('[ADAPTER-LOADER] startup auto-load completed with errors: %s', detail);
        return;
      }
      setStartupTaskState('adapter-auto-load', 'ok', message);
    })
    .catch((error) => {
      warnStartupTask('adapter-auto-load', '[ADAPTER-LOADER]', error);
    });

  // Wire cross-cutting signal bus consumers (Layer 1 integration)
  wireSignalBusConsumers();

  // Phase H: Trust decay timer — daily trust score attrition for inactive guilds
  if (isPgCronOwned('trustDecay')) {
    logger.info('[RUNTIME] trustDecay skipped — pg_cron owns it');
  } else {
    startTrustDecayTimer();
  }

  // Phase F: Observer Layer — autonomous environment scanning
  if (isPgCronOwned('observerLoop')) {
    logger.info('[RUNTIME] observerLoop skipped — pg_cron owns it');
    setStartupTaskState('observer-startup', 'skipped', 'Skipped because pg_cron owns observerLoop');
  } else {
    setStartupTaskState('observer-startup', 'pending', 'Starting observer loop');
    void import('../observer/observerOrchestrator').then(({ startObserverLoop }) => {
      startObserverLoop();
      setStartupTaskState('observer-startup', 'ok', 'Observer loop started');
    }).catch((error) => {
      warnStartupTask('observer-startup', '[OBSERVER]', error);
    });
  }

  // Emit VAULT_SCHEMA.md at startup for agent navigation
  setStartupTaskState('vault-schema-emit', 'pending', 'Emitting vault schema and tool catalog');
  void import('../obsidian/authoring').then(({ emitVaultSchema, emitToolCatalog }) => {
    return Promise.all([emitVaultSchema(), emitToolCatalog()]).then(() => {
      setStartupTaskState('vault-schema-emit', 'ok', 'Vault schema and tool catalog emitted');
    });
  }).catch((error) => {
    warnStartupTask('vault-schema-emit', '[VAULT-SCHEMA]', error);
  });

  // Phase G: Intent Formation Engine — observation → intent → sprint
  setStartupTaskState('intent-formation-check', 'pending', 'Checking intent formation startup conditions');
  void import('../../config').then(({ INTENT_FORMATION_ENABLED }) => {
    if (!INTENT_FORMATION_ENABLED) {
      logger.debug('[INTENT] Intent Formation disabled (INTENT_FORMATION_ENABLED=false)');
      setStartupTaskState('intent-formation-check', 'skipped', 'Disabled by INTENT_FORMATION_ENABLED=false');
      return;
    }
    logger.info('[RUNTIME] Intent Formation Engine enabled');
    setStartupTaskState('intent-formation-check', 'ok', 'Intent formation engine enabled');
  }).catch((error) => {
    warnStartupTask('intent-formation-check', '[INTENT]', error);
  });
};

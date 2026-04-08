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

/**
 * Bootstrap server-only infrastructure: sprint pipelines, MCP router,
 * sandbox policy, dynamic adapters, signal bus, and observer loop.
 */
export const bootstrapServerInfrastructure = (isPgCronOwned: (name: string) => boolean): void => {
  // Restore in-progress sprint pipelines from Supabase
  void rehydrateActivePipelines()
    .then(() => {
      // After legacy rehydration, populate Ventyd entityMap so shadow calls work
      const activeIds = listSprintPipelines(undefined, 50).map((p) => p.sprintId);
      if (activeIds.length > 0) {
        return rehydrateEventSourcingEntities(activeIds);
      }
    })
    .catch((error) => {
      logger.debug('[SPRINT] rehydration skipped: %s', getErrorMessage(error));
    });

  // Restore in-progress agent sessions from Supabase
  void rehydrateActiveSessions().catch((error) => {
    logger.debug('[AGENT] session rehydration skipped: %s', getErrorMessage(error));
  });

  // Start scheduled sprint triggers (security audit, improvement)
  startSprintScheduledTriggers();

  // Initialize MCP skill router with health-aware worker discovery
  void initMcpSkillRouter()
    .then(async () => {
      // Register self (local Express MCP proxy) as a worker so sprint actions
      // can use the 162+ tools exposed at /api/mcp/rpc (native + upstream).
      const { PORT } = await import('../../config');
      const { registerLocalMcpProxy } = await import('../mcpLocalProxyWorker');
      await registerLocalMcpProxy(PORT);
    })
    .catch((error) => {
      logger.debug('[MCP-ROUTER] init skipped: %s', getErrorMessage(error));
    });

  // Validate sprint git config at startup
  checkGitConfigHealth();

  // D-06: Sync high-risk actions to OpenShell sandbox policy at startup
  void syncHighRiskActionsToSandboxPolicy().catch((error) => {
    logger.debug('[SANDBOX-POLICY] startup sync skipped: %s', getErrorMessage(error));
  });

  // D-06: Periodic re-sync every 6 hours to catch env changes without restart
  setInterval(() => {
    void syncHighRiskActionsToSandboxPolicy().catch((error) => {
      logger.debug('[SANDBOX-POLICY] periodic sync skipped: %s', getErrorMessage(error));
    });
  }, SANDBOX_POLICY_RESYNC_MS);

  // M-15 / F-02: Auto-load dynamic adapters from adapters/ directory
  void autoLoadAdapters().catch((error) => {
    logger.debug('[ADAPTER-LOADER] startup auto-load skipped: %s', getErrorMessage(error));
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
  } else {
    void import('../observer/observerOrchestrator').then(({ startObserverLoop }) => {
      startObserverLoop();
    }).catch((error) => {
      logger.debug('[OBSERVER] startup skipped: %s', getErrorMessage(error));
    });
  }

  // Emit VAULT_SCHEMA.md at startup for agent navigation
  void import('../obsidian/authoring').then(({ emitVaultSchema }) => {
    return emitVaultSchema();
  }).catch((error) => {
    logger.debug('[VAULT-SCHEMA] emit skipped: %s', getErrorMessage(error));
  });

  // Phase G: Intent Formation Engine — observation → intent → sprint
  void import('../../config').then(({ INTENT_FORMATION_ENABLED }) => {
    if (!INTENT_FORMATION_ENABLED) {
      logger.debug('[INTENT] Intent Formation disabled (INTENT_FORMATION_ENABLED=false)');
      return;
    }
    logger.info('[RUNTIME] Intent Formation Engine enabled');
  }).catch((error) => {
    logger.debug('[INTENT] startup check skipped: %s', getErrorMessage(error));
  });
};

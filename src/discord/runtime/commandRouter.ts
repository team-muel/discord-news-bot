import type { Client, Message } from 'discord.js';
import logger from '../../logger';
import {
  DISCORD_CHAT_COMMAND_NAMES,
  DISCORD_CONTEXT_MENU_COMMAND_NAMES,
} from '../../../config/runtime/discordCommandCatalog.js';
import {
  CODE_THREAD_ENABLED,
  DISCORD_DOCS_INGRESS_ADAPTER,
  DISCORD_DOCS_INGRESS_HARD_DISABLE,
  DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
  DISCORD_DOCS_INGRESS_SHADOW_MODE,
  DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
  DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
  DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
  DISCORD_SIMPLE_COMMANDS_ENABLED,
  OPENCLAW_ENABLED,
  OPENCLAW_GATEWAY_URL,
  WORKER_APPROVAL_CHANNEL_ID,
} from '../../config';
import {
  CODING_INTENT_PATTERN,
  AUTOMATION_INTENT_PATTERN,
} from '../runtimePolicy';
import {
  buildSimpleEmbed,
  getErrorMessage,
  getReplyVisibility,
  EMBED_INFO,
  EMBED_WARN,
  EMBED_ERROR,
} from '../ui';
import {
  hasAdminPermission,
  markUserLoggedIn,
  hasValidLoginSession,
  LOGIN_SESSION_TTL_MS,
  LOGIN_SESSION_REFRESH_WINDOW_MS,
  LOGIN_SESSION_CLEANUP_INTERVAL_MS,
} from '../auth';
import { DISCORD_MESSAGES } from '../messages';
import { handleGroupedSubscribeCommand } from '../commands/subscribe';
import {
  handleStockPriceCommand,
  handleStockChartCommand,
  handleAnalyzeCommand,
  handleChannelIdCommand,
  handleForumIdCommand,
} from '../commands/market';
import { createAdminHandlers } from '../commands/admin';
import { createAgentHandlers } from '../commands/agent';
import { createVibeHandlers } from '../commands/vibe';
import { createDocsHandlers } from '../commands/docs';
import { createPersonaHandlers } from '../commands/persona';
import { createCrmHandlers } from '../commands/crm';
import { createTasksHandlers } from '../commands/tasks';
import { generateMetricReviewSnapshot, formatMetricReviewForDiscord } from '../../services/metricReviewFormatter';
import { startDiscordReadyWorkloads } from './readyWorkloads';
import { processPassiveMemoryCapture, isGuildLearningEnabled } from './passiveMemoryCapture';
import { handleButtonInteraction } from './buttonInteractions';
import { handleGuildCreateLifecycle, handleGuildDeleteLifecycle } from './guildLifecycle';
import { runStartupTaskSafely } from './startupTasks';
import {
  botRuntimeState,
  getBotRuntimeSnapshot,
  getManualReconnectCooldownRemainingSec,
  getUsageSummaryLine,
  getGuildUsageSummaryLine,
  getRuntimeStatusLines,
  registerSlashCommands,
  restoreApprovedDynamicWorkers,
  type ManualReconnectRequestResult,
} from './botRuntimeState';
import {
  getAutomationRuntimeSnapshot,
  triggerAutomationJob,
  type AutomationJobName,
} from '../../services/automationBot';
import { trackUserActivity } from '../../services/discord-support/userCrmService';
import { recordReactionRewardSignal } from '../../services/discord-support/discordReactionRewardService';
import { recordCommunityInteractionEvent } from '../../services/communityGraphService';
import { isAnyLlmConfigured, generateText } from '../../services/llmClient';
import { queryObsidianRAG } from '../../services/obsidian/obsidianRagService';
import { listObsidianTasksWithAdapter, toggleObsidianTaskWithAdapter } from '../../services/obsidian/router';
import {
  getChain,
  listGuildArtifacts,
} from '../../utils/sessionArtifactStore';
import {
  tryPostCodeThread,
} from '../../utils/codeThread';
import {
  startVibeSession,
  streamSessionProgress,
  inferSessionSkill,
} from '../session';
import { handleCsChannelMessage, recordRuntimeError } from '../../services/sprint/sprintTriggers';
import { setDynamicWorkerAdminNotifier } from '../../services/workerGeneration/dynamicWorkerRegistry';
import { enforceImplementApprovalRequiredPilot, startAutoWorkerProposalBackgroundLoop } from '../../services/workerGeneration/backgroundProposalSweep';
import {
  checkOpenClawGatewayHealth,
} from '../../services/openclaw/gatewayHealth';
import { autoProposeWorker } from '../../services/workerGeneration/autoWorkerProposal';
import { executeDiscordIngress, primeDiscordIngressCutoverPolicy, type DiscordIngressExecutionHandler } from './discordIngressAdapter';
import { initDiscordChatSdkRuntime, tryHandleDiscordChatSdkSlashCommand } from './chatSdkRuntime';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CommandRouterDeps = {
  getActiveToken: () => string | null;
  runManualReconnect: (reason: string) => Promise<ManualReconnectRequestResult>;
  forceRegisterSlashCommands: () => Promise<void>;
  onSessionInvalidated: () => void;
};

// ─── Command Router ───────────────────────────────────────────────────────────

let commandHandlersAttached = false;

export function attachAllHandlers(client: Client, deps: CommandRouterDeps): void {
  if (commandHandlersAttached) {
    return;
  }
  commandHandlersAttached = true;

  // ── Handler factory wiring ────────────────────────────────────────────────

  const adminHandlers = createAdminHandlers({
    getBotRuntimeSnapshot: () => getBotRuntimeSnapshot(client),
    getAutomationRuntimeSnapshot,
    hasAdminPermission,
    markUserLoggedIn,
    loginSessionTtlMs: LOGIN_SESSION_TTL_MS,
    loginSessionRefreshWindowMs: LOGIN_SESSION_REFRESH_WINDOW_MS,
    loginSessionCleanupIntervalMs: LOGIN_SESSION_CLEANUP_INTERVAL_MS,
    simpleCommandsEnabled: DISCORD_SIMPLE_COMMANDS_ENABLED,
    getUsageSummaryLine: () => getUsageSummaryLine(client),
    getGuildUsageSummaryLine,
    forceRegisterSlashCommands: deps.forceRegisterSlashCommands,
    triggerAutomationJob: (jobName, options) => triggerAutomationJob(jobName as AutomationJobName, options),
    getManualReconnectCooldownRemainingSec,
    hasActiveToken: () => Boolean(deps.getActiveToken()),
    requestManualReconnect: deps.runManualReconnect,
  });

  const executeDocsCommandIngress: DiscordIngressExecutionHandler = (params) => {
    return executeDiscordIngress(params, {
      preferredAdapterId: DISCORD_DOCS_INGRESS_ADAPTER,
      hardDisable: DISCORD_DOCS_INGRESS_HARD_DISABLE,
      shadowMode: DISCORD_DOCS_INGRESS_SHADOW_MODE,
      rolloutPercentage: DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
    });
  };

  const executePrefixedMessageIngress: DiscordIngressExecutionHandler = (params) => {
    return executeDiscordIngress(params, {
      preferredAdapterId: DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
      hardDisable: DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
      shadowMode: DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
      rolloutPercentage: DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
    });
  };

  primeDiscordIngressCutoverPolicy('docs-command', {
    preferredAdapterId: DISCORD_DOCS_INGRESS_ADAPTER,
    hardDisable: DISCORD_DOCS_INGRESS_HARD_DISABLE,
    shadowMode: DISCORD_DOCS_INGRESS_SHADOW_MODE,
    rolloutPercentage: DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
  });
  primeDiscordIngressCutoverPolicy('muel-message', {
    preferredAdapterId: DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER,
    hardDisable: DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE,
    shadowMode: DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE,
    rolloutPercentage: DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  });

  const vibeHandlers = createVibeHandlers({
    getReplyVisibility,
    startVibeSession,
    streamSessionProgress,
    tryPostCodeThread,
    codeThreadEnabled: CODE_THREAD_ENABLED,
    codingIntentPattern: CODING_INTENT_PATTERN,
    automationIntentPattern: AUTOMATION_INTENT_PATTERN,
    getErrorMessage,
    autoProposeWorker,
    executePrefixedMessageIngress,
  });

  const agentHandlers = createAgentHandlers({
    client,
    hasAdminPermission,
    handleGroupedSubscribeCommand,
    inferSessionSkill,
    streamSessionProgress,
    getRuntimeStatusLines: (guildId: string | null) => getRuntimeStatusLines(guildId, client),
    getErrorMessage,
    getChain,
    listGuildArtifacts,
  });

  const docsHandlers = createDocsHandlers({
    getReplyVisibility,
    queryObsidianRAG,
    generateText,
    isAnyLlmConfigured,
    getErrorMessage,
    executeDocsCommandIngress,
  });

  const personaHandlers = createPersonaHandlers({
    getReplyVisibility,
    hasAdminPermission,
    hasValidLoginSession,
    getErrorMessage,
  });

  const tasksHandlers = createTasksHandlers({
    listObsidianTasksWithAdapter,
    toggleObsidianTaskWithAdapter,
    getErrorMessage,
  });

  const crmHandlers = createCrmHandlers({
    getReplyVisibility,
    hasAdminPermission,
    markUserLoggedIn,
    simpleCommandsEnabled: DISCORD_SIMPLE_COMMANDS_ENABLED,
    loginSessionTtlMs: LOGIN_SESSION_TTL_MS,
    loginSessionRefreshWindowMs: LOGIN_SESSION_REFRESH_WINDOW_MS,
  });

  // ── Wire dynamic worker admin notifier ────────────────────────────────────

  setDynamicWorkerAdminNotifier(async (message) => {
    if (!WORKER_APPROVAL_CHANNEL_ID) return;
    try {
      const ch = await client.channels.fetch(WORKER_APPROVAL_CHANNEL_ID);
      if (ch?.isSendable()) await ch.send(message);
    } catch (error) {
      logger.debug('[BOT] dynamic worker admin notify skipped: %s', getErrorMessage(error));
    }
  });

  // ── Button interactions ───────────────────────────────────────────────────

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    try {
      await handleButtonInteraction({
        interaction,
        client,
        workerApprovalChannelId: WORKER_APPROVAL_CHANNEL_ID,
        startVibeSession,
        streamSessionProgress,
      });
    } catch (error) {
      logger.error('[BOT] button interaction handler failed: %s', getErrorMessage(error));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...buildSimpleEmbed('실행 실패', DISCORD_MESSAGES.bot.executionFailedBody, EMBED_ERROR), ephemeral: true }).catch(() => {});
      }
    }
  });

  // ── User context menu interactions ────────────────────────────────────────

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserContextMenuCommand()) {
      return;
    }

    try {
      if (
        interaction.commandName === DISCORD_CONTEXT_MENU_COMMAND_NAMES.USER_PROFILE
        || interaction.commandName === DISCORD_CONTEXT_MENU_COMMAND_NAMES.USER_NOTE
      ) {
        await personaHandlers.handleUserContextCommand(interaction);
      }
    } catch (error) {
      logger.error('[BOT] user context interaction handler failed: %s', getErrorMessage(error));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...buildSimpleEmbed('실행 실패', DISCORD_MESSAGES.bot.executionFailedBody, EMBED_ERROR), ephemeral: true }).catch(() => {});
      }
    }
  });

  // ── Modal interactions ────────────────────────────────────────────────────

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) {
      return;
    }

    try {
      if (interaction.customId.startsWith('persona_note_modal:')) {
        await personaHandlers.handleUserNoteModal(interaction);
      }
    } catch (error) {
      logger.error('[BOT] modal interaction handler failed: %s', getErrorMessage(error));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...buildSimpleEmbed('실행 실패', DISCORD_MESSAGES.bot.executionFailedBody, EMBED_ERROR), ephemeral: true }).catch(() => {});
      }
    }
  });

  // ── Slash command routing ─────────────────────────────────────────────────

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    // CRM: track command usage
    if (interaction.guildId) {
      trackUserActivity({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        counter: 'command_count',
      });
    }

    try {
      switch (interaction.commandName) {
        case DISCORD_CHAT_COMMAND_NAMES.HELP: {
          await adminHandlers.handleHelpCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.STOCK_PRICE: {
          await handleStockPriceCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.STOCK_CHART: {
          await handleStockChartCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.ANALYZE: {
          await handleAnalyzeCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.SUBSCRIBE: {
          await handleGroupedSubscribeCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.MAKE: {
          await vibeHandlers.handleMakeCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.ASK_COMPAT: {
          if (await tryHandleDiscordChatSdkSlashCommand(interaction)) {
            return;
          }
          await docsHandlers.handleAskCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.MUEL: {
          if (await tryHandleDiscordChatSdkSlashCommand(interaction)) {
            return;
          }
          await docsHandlers.handleAskCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.CHANGELOG: {
          await docsHandlers.handleChangelogCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.PROFILE: {
          await personaHandlers.handleProfileCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.MEMO: {
          await personaHandlers.handleMemoCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.ADMIN: {
          if (interaction.options.getSubcommand() === '세션이력') {
            await agentHandlers.handleSessionCommand(interaction);
          } else {
            await adminHandlers.handleAdminCommand(interaction, {
              handleChannelIdCommand,
              handleForumIdCommand,
            });
          }
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.MANAGE_SETTINGS: {
          await adminHandlers.handleManageSettingsCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.FORGET: {
          await adminHandlers.handleForgetCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.START: {
          await agentHandlers.handleAgentCommand(interaction, DISCORD_CHAT_COMMAND_NAMES.START);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.STATUS: {
          await adminHandlers.handleStatusCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.SKILL_LIST: {
          await agentHandlers.handleAgentCommand(interaction, DISCORD_CHAT_COMMAND_NAMES.SKILL_LIST);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.POLICY: {
          await agentHandlers.handlePolicyCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.ONBOARDING: {
          await agentHandlers.handleAgentCommand(interaction, DISCORD_CHAT_COMMAND_NAMES.ONBOARDING);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.STOP: {
          await agentHandlers.handleAgentCommand(interaction, DISCORD_CHAT_COMMAND_NAMES.STOP);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.USER: {
          await crmHandlers.handleMyInfoCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.STATS: {
          await crmHandlers.handleUserInfoCommand(interaction);
          return;
        }
        case DISCORD_CHAT_COMMAND_NAMES.METRIC_REVIEW: {
          await interaction.deferReply({ ephemeral: true });
          try {
            const snapshot = await generateMetricReviewSnapshot();
            const content = formatMetricReviewForDiscord(snapshot);
            const trimmed = content.length > 1900 ? content.slice(0, 1900) + '\n\n_(잘림)_' : content;
            await interaction.editReply({ content: trimmed });
          } catch (err) {
            await interaction.editReply({ content: `Metric Review 생성 실패: ${getErrorMessage(err)}` });
          }
          return;
        }
        default: {
          await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.bot.titleUnknownCommand, DISCORD_MESSAGES.common.unknownCommand, EMBED_WARN), ephemeral: true });
        }
      }
    } catch (error) {
      logger.error('[BOT] interaction handler failed: %s', getErrorMessage(error));
      recordRuntimeError({ message: getErrorMessage(error), code: 'INTERACTION_HANDLER' });
      const errorBody = DISCORD_MESSAGES.bot.executionFailedBody;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.bot.titleExecutionFailed, errorBody, EMBED_ERROR)).catch((replyError) => {
          logger.debug('[BOT] interaction error editReply skipped: %s', getErrorMessage(replyError));
        });
      } else {
        await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.bot.titleExecutionFailed, errorBody, EMBED_ERROR), ephemeral: true }).catch((replyError) => {
          logger.debug('[BOT] interaction error reply skipped: %s', getErrorMessage(replyError));
        });
      }
    }
  });

  // ── Message handler ───────────────────────────────────────────────────────

  client.on('messageCreate', async (message) => {
    if (!DISCORD_SIMPLE_COMMANDS_ENABLED) {
      return;
    }
    if (message.author.bot) {
      return;
    }

    // CRM: track message activity
    if (message.guildId) {
      trackUserActivity({
        userId: message.author.id,
        guildId: message.guildId,
        counter: 'message_count',
      });
    }

    try {
      try {
        await vibeHandlers.handleVibeMessage(message);
      } catch (error) {
        logger.warn('[BOT] vibe message handling failed: %s', getErrorMessage(error));
      }

      // Skip passive memory (including Discord API fetch) when guild learning is disabled
      if (message.guildId) {
        const learningEnabled = await isGuildLearningEnabled(message.guildId).catch(() => false);
        if (learningEnabled) {
          void processPassiveMemoryCapture(message).catch((error) => {
            logger.debug('[BOT] passive memory capture skipped: %s', getErrorMessage(error));
          });
        }
      }

      // C-13: Route CS channel messages to sprint trigger pipeline
      void handleCsChannelMessage(message.channelId, message.content || '', message.author.id).catch((error) => {
        logger.debug('[BOT] CS channel message handler skipped: %s', getErrorMessage(error));
      });
    } catch (error) {
      logger.warn('[BOT] messageCreate handler failed: %s', getErrorMessage(error));
      recordRuntimeError({ message: getErrorMessage(error), code: 'MESSAGE_CREATE_HANDLER' });
    }
  });

  // ── Client ready ──────────────────────────────────────────────────────────

  client.on('clientReady', () => {
    botRuntimeState.ready = true;
    botRuntimeState.started = true;
    botRuntimeState.lastReadyAt = new Date().toISOString();
    botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
    botRuntimeState.lastAlertAt = null;
    botRuntimeState.lastAlertReason = null;
    botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

    runStartupTaskSafely('registerSlashCommands', () => registerSlashCommands(client));
    runStartupTaskSafely('initDiscordChatSdkRuntime', () => initDiscordChatSdkRuntime());
    runStartupTaskSafely('restoreApprovedDynamicWorkers', () => restoreApprovedDynamicWorkers());
    runStartupTaskSafely('enforceImplementApprovalRequiredPilot', () => enforceImplementApprovalRequiredPilot([...client.guilds.cache.keys()]));
    // OpenClaw Gateway preflight — warn early if configured but unreachable
    if (OPENCLAW_ENABLED || OPENCLAW_GATEWAY_URL) {
      runStartupTaskSafely('checkOpenClawGatewayHealth', async () => {
        const ok = await checkOpenClawGatewayHealth();
        if (!ok) logger.warn('[STARTUP] OpenClaw Gateway unreachable: %s', OPENCLAW_GATEWAY_URL || '(not configured)');
        else logger.info('[STARTUP] OpenClaw Gateway reachable');
      });
    }
    runStartupTaskSafely('startAutoWorkerProposalBackgroundLoop', () => startAutoWorkerProposalBackgroundLoop());
    runStartupTaskSafely('startDiscordReadyWorkloads', () => startDiscordReadyWorkloads(client));
  });

  // ── Guild lifecycle ───────────────────────────────────────────────────────

  client.on('guildCreate', (guild) => {
    handleGuildCreateLifecycle(guild);
  });

  client.on('guildDelete', (guild) => {
    handleGuildDeleteLifecycle(guild);
  });

  // ── CRM member tracking ───────────────────────────────────────────────────

  client.on('guildMemberAdd', (member) => {
    if (member.user.bot) return;
    trackUserActivity({ userId: member.id, guildId: member.guild.id, counter: 'session_count', delta: 0 });
  });

  client.on('guildMemberRemove', (member) => {
    if (member.user?.bot) return;
    trackUserActivity({ userId: member.id, guildId: member.guild.id, counter: 'session_count', delta: 0 });
  });

  // ── Reaction handlers ────────────────────────────────────────────────────

  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      if (reaction.partial) {
        await reaction.fetch();
      }

      const guildId = reaction.message.guildId;
      const channelId = reaction.message.channelId;
      const messageId = reaction.message.id;
      if (!guildId || !channelId || !messageId) {
        return;
      }

      recordReactionRewardSignal({
        guildId,
        channelId,
        messageId,
        userId: user.id,
        emoji: reaction.emoji.name || '',
        direction: 'add',
      });

      // CRM: track reaction activity (giver + receiver)
      trackUserActivity({ userId: user.id, guildId, counter: 'reaction_given_count' });
      const targetUserId = String(reaction.message.author?.id || '').trim();
      if (targetUserId && targetUserId !== user.id && !reaction.message.author?.bot) {
        trackUserActivity({ userId: targetUserId, guildId, counter: 'reaction_received_count' });
        await recordCommunityInteractionEvent({
          guildId,
          actorUserId: user.id,
          targetUserId,
          channelId,
          sourceMessageId: messageId,
          eventType: 'reaction',
          eventTs: new Date().toISOString(),
          weight: 0.4,
          metadata: {
            source: 'message_reaction_add',
            emoji: reaction.emoji.name || '',
            direction: 'add',
          },
        });
      }
    } catch (error) {
      logger.debug('[REACTION-REWARD] add skipped reason=%s', getErrorMessage(error));
    }
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      if (reaction.partial) {
        await reaction.fetch();
      }

      const guildId = reaction.message.guildId;
      const channelId = reaction.message.channelId;
      const messageId = reaction.message.id;
      if (!guildId || !channelId || !messageId) {
        return;
      }

      recordReactionRewardSignal({
        guildId,
        channelId,
        messageId,
        userId: user.id,
        emoji: reaction.emoji.name || '',
        direction: 'remove',
      });

      // Record removal in community_interaction_events so reward signal can subtract
      const targetUserId = String(reaction.message.author?.id || '').trim();
      if (targetUserId && targetUserId !== user.id && !reaction.message.author?.bot) {
        await recordCommunityInteractionEvent({
          guildId,
          actorUserId: user.id,
          targetUserId,
          channelId,
          sourceMessageId: messageId,
          eventType: 'reaction',
          eventTs: new Date().toISOString(),
          weight: 0.4,
          metadata: {
            source: 'message_reaction_remove',
            emoji: reaction.emoji.name || '',
            direction: 'remove',
          },
        });
      }
    } catch (error) {
      logger.debug('[REACTION-REWARD] remove skipped reason=%s', getErrorMessage(error));
    }
  });

  // ── Gateway lifecycle ─────────────────────────────────────────────────────

  client.on('shardDisconnect', (event) => {
    logger.warn('[BOT] shardDisconnect code=%d reason=%s', Number(event.code), event.reason || 'unknown');
    botRuntimeState.ready = false;
    botRuntimeState.lastDisconnectAt = new Date().toISOString();
    botRuntimeState.lastDisconnectCode = Number(event.code);
    botRuntimeState.lastDisconnectReason = event.reason || null;
    botRuntimeState.lastInvalidatedAt = event.code === 4014 ? botRuntimeState.lastDisconnectAt : botRuntimeState.lastInvalidatedAt;
    botRuntimeState.lastAlertAt = botRuntimeState.lastDisconnectAt;
    botRuntimeState.lastAlertReason = event.reason || `Gateway disconnect code ${event.code}`;
  });

  client.on('invalidated', () => {
    logger.error('[BOT] Gateway session invalidated');
    botRuntimeState.ready = false;
    botRuntimeState.lastInvalidatedAt = new Date().toISOString();
    botRuntimeState.lastAlertAt = botRuntimeState.lastInvalidatedAt;
    botRuntimeState.lastAlertReason = 'Gateway session invalidated';
    // Clear stale token to force re-read from env on next reconnect
    deps.onSessionInvalidated();
  });

  client.on('shardError', (error) => {
    logger.error('[BOT] shardError: %s', getErrorMessage(error));
  });

  client.on('error', (error) => {
    logger.error('[BOT] client error: %s', getErrorMessage(error));
  });

  client.on('warn', (info) => {
    logger.warn('[BOT] client warn: %s', info);
  });
}

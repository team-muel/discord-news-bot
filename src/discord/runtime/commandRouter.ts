import type { Client, Message } from 'discord.js';
import logger from '../../logger';
import {
  OPENCLAW_ENABLED,
  OPENCLAW_GATEWAY_URL,
} from '../../config';
import {
  SIMPLE_COMMANDS_ENABLED,
  CODE_THREAD_ENABLED,
  CODING_INTENT_PATTERN,
  AUTOMATION_INTENT_PATTERN,
  WORKER_APPROVAL_CHANNEL_ID,
} from '../commandDefinitions';
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
import { checkOpenClawGatewayHealth } from '../../services/openclaw/gatewayHealth';
import { autoProposeWorker } from '../../services/workerGeneration/autoWorkerProposal';

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
    simpleCommandsEnabled: SIMPLE_COMMANDS_ENABLED,
    getUsageSummaryLine: () => getUsageSummaryLine(client),
    getGuildUsageSummaryLine,
    forceRegisterSlashCommands: deps.forceRegisterSlashCommands,
    triggerAutomationJob: (jobName, options) => triggerAutomationJob(jobName as AutomationJobName, options),
    getManualReconnectCooldownRemainingSec,
    hasActiveToken: () => Boolean(deps.getActiveToken()),
    requestManualReconnect: deps.runManualReconnect,
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
      logger.error('[BOT] button interaction handler failed: %o', error);
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
      if (interaction.commandName === '유저 프로필 보기' || interaction.commandName === '유저 메모 추가') {
        await personaHandlers.handleUserContextCommand(interaction);
      }
    } catch (error) {
      logger.error('[BOT] user context interaction handler failed: %o', error);
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
      logger.error('[BOT] modal interaction handler failed: %o', error);
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
        case 'ping': {
          await interaction.reply({
            ...buildSimpleEmbed(DISCORD_MESSAGES.bot.titlePong, DISCORD_MESSAGES.bot.pongBody(client.ws.status, client.ws.ping), EMBED_INFO),
            ephemeral: true,
          });
          return;
        }
        case 'help':
        case '도움말': {
          await adminHandlers.handleHelpCommand(interaction);
          return;
        }
        case '설정': {
          await adminHandlers.handleSettingsCommand(interaction);
          return;
        }
        case '로그인': {
          await adminHandlers.handleLoginCommand(interaction);
          return;
        }
        case '주가': {
          await handleStockPriceCommand(interaction);
          return;
        }
        case '차트': {
          await handleStockChartCommand(interaction);
          return;
        }
        case '분석': {
          await handleAnalyzeCommand(interaction);
          return;
        }
        case '구독': {
          await handleGroupedSubscribeCommand(interaction);
          return;
        }
        case '세션': {
          await agentHandlers.handleSessionCommand(interaction);
          return;
        }
        case '해줘': {
          await vibeHandlers.handleVibeCommand(interaction);
          return;
        }
        case '만들어줘': {
          await vibeHandlers.handleMakeCommand(interaction);
          return;
        }
        case '물어봐': {
          await docsHandlers.handleAskCommand(interaction);
          return;
        }
        case '문서': {
          await docsHandlers.handleDocsCommand(interaction);
          return;
        }
        case '할일': {
          const sub = interaction.options.getSubcommand();
          if (sub === '목록') {
            await tasksHandlers.handleTasksListCommand(interaction);
          } else if (sub === '완료') {
            await tasksHandlers.handleTasksToggleCommand(interaction);
          }
          return;
        }
        case '유저': {
          await personaHandlers.handleUserCommand(interaction);
          return;
        }
        case '관리자': {
          await adminHandlers.handleAdminCommand(interaction, {
            handleChannelIdCommand,
            handleForumIdCommand,
          });
          return;
        }
        case '관리설정': {
          await adminHandlers.handleManageSettingsCommand(interaction);
          return;
        }
        case '잊어줘': {
          await adminHandlers.handleForgetCommand(interaction);
          return;
        }
        case '시작': {
          await agentHandlers.handleAgentCommand(interaction, '시작');
          return;
        }
        case '상태': {
          await adminHandlers.handleStatusCommand(interaction);
          return;
        }
        case '스킬목록': {
          await agentHandlers.handleAgentCommand(interaction, '스킬목록');
          return;
        }
        case '정책': {
          await agentHandlers.handlePolicyCommand(interaction);
          return;
        }
        case '온보딩': {
          await agentHandlers.handleAgentCommand(interaction, '온보딩');
          return;
        }
        case '학습': {
          await agentHandlers.handleUserLearningCommand(interaction);
          return;
        }
        case '중지': {
          await agentHandlers.handleAgentCommand(interaction, '중지');
          return;
        }
        case '내정보': {
          await crmHandlers.handleMyInfoCommand(interaction);
          return;
        }
        case '유저정보': {
          await crmHandlers.handleUserInfoCommand(interaction);
          return;
        }
        case '지표리뷰': {
          await interaction.deferReply({ ephemeral: true });
          try {
            const snapshot = await generateMetricReviewSnapshot();
            const content = formatMetricReviewForDiscord(snapshot);
            // Discord message limit is 2000 chars
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
      logger.error('[BOT] interaction handler failed: %o', error);
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
    if (!SIMPLE_COMMANDS_ENABLED) {
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
        logger.warn('[BOT] vibe message handling failed: %o', error);
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
      logger.warn('[BOT] messageCreate handler failed: %o', error);
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

    void registerSlashCommands(client).catch((err) => logger.error('[BOT] registerSlashCommands failed: %s', getErrorMessage(err)));
    void restoreApprovedDynamicWorkers().catch((err) => logger.error('[BOT] restoreApprovedDynamicWorkers failed: %s', getErrorMessage(err)));
    void enforceImplementApprovalRequiredPilot([...client.guilds.cache.keys()]).catch((err) => logger.error('[BOT] enforceImplementApprovalRequiredPilot failed: %s', getErrorMessage(err)));
    // OpenClaw Gateway preflight — warn early if configured but unreachable
    if (OPENCLAW_ENABLED || OPENCLAW_GATEWAY_URL) {
      void checkOpenClawGatewayHealth().then((ok) => {
        if (!ok) logger.warn('[STARTUP] OpenClaw Gateway unreachable: %s', OPENCLAW_GATEWAY_URL || '(not configured)');
        else logger.info('[STARTUP] OpenClaw Gateway reachable');
      });
    }
    startAutoWorkerProposalBackgroundLoop();
    startDiscordReadyWorkloads(client);
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
    logger.error('[BOT] shardError: %o', error);
  });

  client.on('error', (error) => {
    logger.error('[BOT] client error: %o', error);
  });

  client.on('warn', (info) => {
    logger.warn('[BOT] client warn: %s', info);
  });
}

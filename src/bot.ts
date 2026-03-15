import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  Partials,
  type Guild,
  type Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import logger from './logger';
import {
  DISCORD_COMMAND_GUILD_ID,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
} from './config';
import { isUserAdmin } from './services/adminAllowlistService';
import {
  getAutomationRuntimeSnapshot,
  triggerAutomationJob,
} from './services/automationBot';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';
import {
  type AgentSession,
  getAgentPolicy,
  getAgentSession,
  listAgentSkills,
  getMultiAgentRuntimeSnapshot,
  listGuildAgentSessions,
  startAgentSession,
} from './services/multiAgentService';
import { recordReactionRewardSignal } from './services/discordReactionRewardService';
import { isAnyLlmConfigured } from './services/llmClient';
import { queryObsidianRAG, initObsidianRAG } from './services/obsidianRagService';
import { generateText } from './services/llmClient';
import {
  getAgentOpsSnapshot,
  triggerDailyLearningRun,
  triggerGuildOnboardingSession,
} from './services/agentOpsService';
import { forgetUserRagData } from './services/privacyForgetService';
import {
  getArtifact,
  getChain,
  listGuildArtifacts,
  saveArtifact,
} from './utils/sessionArtifactStore';
import {
  DISCORD_MSG_LIMIT,
  buildCodeActionRow,
  extractCodeBlocks,
  tryPostCodeThread,
} from './utils/codeThread';
import { runWorkerGenerationPipeline, rerunWorkerPipeline } from './services/workerGeneration/workerGenerationPipeline';
import { getApproval, listApprovals, updateApprovalStatus } from './services/workerGeneration/workerApprovalStore';
import { loadDynamicWorkerFromCode, loadDynamicWorkerFromFile, setDynamicWorkerAdminNotifier } from './services/workerGeneration/dynamicWorkerRegistry';
import {
  recordWorkerApprovalDecision,
  recordWorkerGenerationResult,
  recordWorkerProposalClick,
} from './services/workerGeneration/workerProposalMetrics';
import { cleanupSandbox } from './services/workerGeneration/workerSandbox';
import { evaluateWorkerActivationGate } from './services/agentRuntimeReadinessService';
// ─── Discord layer modules ────────────────────────────────────────────────────
import {
  buildSimpleEmbed,
  buildUserCard,
  buildAdminCard,
  getErrorMessage,
  getReplyVisibility,
  EMBED_INFO,
  EMBED_SUCCESS,
  EMBED_WARN,
  EMBED_ERROR,
  type ReplyVisibility,
} from './discord/ui';
import {
  commandDefinitions,
  SIMPLE_COMMANDS_ENABLED,
  SIMPLE_COMMAND_ALLOWLIST,
  LEGACY_SESSION_COMMANDS_ENABLED,
  LEGACY_SESSION_COMMAND_NAMES,
  LEGACY_SUBSCRIBE_COMMAND_ENABLED,
  CODE_THREAD_ENABLED,
  CODING_INTENT_PATTERN,
  AUTOMATION_INTENT_PATTERN,
  WORKER_APPROVAL_CHANNEL_ID,
  CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC,
} from './discord/commandDefinitions';
import {
  streamSessionProgress,
  startVibeSession,
  inferSessionSkill,
  type ProgressSink,
  type ProgressRenderOptions,
  buildSessionProgressText,
} from './discord/session';
import {
  hasAdminPermission,
  hasFeatureAccess,
  markUserLoggedIn,
  hasValidLoginSession,
  loggedInUsersByGuild,
  cacheLoginSession,
  uncacheLoginSession,
  LOGIN_SESSION_TTL_MS,
  LOGIN_SESSION_REFRESH_WINDOW_MS,
  LOGIN_SESSION_CLEANUP_INTERVAL_MS,
} from './discord/auth';
import { handleGroupedSubscribeCommand } from './discord/commands/subscribe';
import {
  handleStockPriceCommand,
  handleStockChartCommand,
  handleAnalyzeCommand,
  handleChannelIdCommand,
  handleForumIdCommand,
} from './discord/commands/market';
import { createAdminHandlers } from './discord/commands/admin';
import { createAgentHandlers } from './discord/commands/agent';
import { createVibeHandlers } from './discord/commands/vibe';
import { createDocsHandlers } from './discord/commands/docs';
import { registerSlashCommands as registerSlashCommandsFromLifecycle } from './discord/lifecycle';
import { startDiscordReadyWorkloads } from './discord/runtime/readyWorkloads';
import { processPassiveMemoryCapture } from './discord/runtime/passiveMemoryCapture';
import { handleButtonInteraction } from './discord/runtime/buttonInteractions';
import { handleGuildCreateLifecycle, handleGuildDeleteLifecycle } from './discord/runtime/guildLifecycle';
import { DISCORD_MESSAGES } from './discord/messages';
import { isStockFeatureEnabled } from './services/stockService';


export const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.MessageContent,
], partials: [Partials.Message, Partials.Channel, Partials.Reaction] });

const MANUAL_RECONNECT_COOLDOWN_MS = parseInt(
  process.env.BOT_MANUAL_RECONNECT_COOLDOWN_MS
  || process.env.DISCORD_MANUAL_RECONNECT_COOLDOWN_MS
  || '30000',
  10,
);

export type BotRuntimeSnapshot = {
  started: boolean;
  ready: boolean;
  wsStatus: number;
  tokenPresent: boolean;
  reconnectQueued: boolean;
  reconnectAttempts: number;
  lastReadyAt: string | null;
  lastLoginAttemptAt: string | null;
  lastLoginErrorAt: string | null;
  lastLoginError: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectReason: string | null;
  lastInvalidatedAt: string | null;
  lastAlertAt: string | null;
  lastAlertReason: string | null;
  lastRecoveryAt: string | null;
  lastManualReconnectAt: string | null;
  manualReconnectCooldownRemainingSec: number;
  dynamicWorkerRestoreEnabled: boolean;
  dynamicWorkerRestoreAttemptedAt: string | null;
  dynamicWorkerRestoreApprovedCount: number;
  dynamicWorkerRestoreSuccessCount: number;
  dynamicWorkerRestoreFailedCount: number;
  dynamicWorkerRestoreLastError: string | null;
};

const botRuntimeState: BotRuntimeSnapshot = {
  started: false,
  ready: false,
  wsStatus: -1,
  tokenPresent: false,
  reconnectQueued: false,
  reconnectAttempts: 0,
  lastReadyAt: null,
  lastLoginAttemptAt: null,
  lastLoginErrorAt: null,
  lastLoginError: null,
  lastDisconnectAt: null,
  lastDisconnectCode: null,
  lastDisconnectReason: null,
  lastInvalidatedAt: null,
  lastAlertAt: null,
  lastAlertReason: null,
  lastRecoveryAt: null,
  lastManualReconnectAt: null,
  manualReconnectCooldownRemainingSec: 0,
  dynamicWorkerRestoreEnabled: String(process.env.DYNAMIC_WORKER_RESTORE_ON_BOOT || 'true').trim().toLowerCase() !== 'false',
  dynamicWorkerRestoreAttemptedAt: null,
  dynamicWorkerRestoreApprovedCount: 0,
  dynamicWorkerRestoreSuccessCount: 0,
  dynamicWorkerRestoreFailedCount: 0,
  dynamicWorkerRestoreLastError: null,
};

let commandHandlersAttached = false;
let activeToken: string | null = null;
let reconnectInProgress = false;
const DYNAMIC_WORKER_RESTORE_ON_BOOT = String(process.env.DYNAMIC_WORKER_RESTORE_ON_BOOT || 'true').trim().toLowerCase() !== 'false';

const restoreApprovedDynamicWorkers = async () => {
  if (!DYNAMIC_WORKER_RESTORE_ON_BOOT) {
    return;
  }

  botRuntimeState.dynamicWorkerRestoreEnabled = true;
  botRuntimeState.dynamicWorkerRestoreAttemptedAt = new Date().toISOString();
  botRuntimeState.dynamicWorkerRestoreApprovedCount = 0;
  botRuntimeState.dynamicWorkerRestoreSuccessCount = 0;
  botRuntimeState.dynamicWorkerRestoreFailedCount = 0;
  botRuntimeState.dynamicWorkerRestoreLastError = null;

  try {
    const approved = await listApprovals({ status: 'approved' });
    botRuntimeState.dynamicWorkerRestoreApprovedCount = approved.length;
    if (approved.length === 0) {
      logger.info('[DYNAMIC-WORKER] restore skipped: no approved entries');
      return;
    }

    let restored = 0;
    let failed = 0;

    for (const entry of approved) {
      if (!entry.validationPassed) {
        failed += 1;
        continue;
      }

      let loaded = entry.sandboxFilePath
        ? await loadDynamicWorkerFromFile(entry.sandboxFilePath, entry.id)
        : { ok: false, error: 'missing sandbox file path' };

      if (!loaded.ok && entry.generatedCode) {
        loaded = await loadDynamicWorkerFromCode({
          approvalId: entry.id,
          generatedCode: entry.generatedCode,
          actionNameHint: entry.actionName,
        });
      }

      if (loaded.ok) {
        restored += 1;
      } else {
        failed += 1;
        logger.warn(
          '[DYNAMIC-WORKER] restore failed approval=%s action=%s error=%s',
          entry.id,
          entry.actionName,
          loaded.error || 'unknown',
        );
      }
    }

    botRuntimeState.dynamicWorkerRestoreSuccessCount = restored;
    botRuntimeState.dynamicWorkerRestoreFailedCount = failed;

    logger.info('[DYNAMIC-WORKER] restore completed approved=%d restored=%d failed=%d', approved.length, restored, failed);
  } catch (error) {
    const message = getErrorMessage(error);
    botRuntimeState.dynamicWorkerRestoreLastError = message;
    logger.error('[DYNAMIC-WORKER] restore process failed: %s', message);
  }
};

export type ManualReconnectRequestResult = {
  ok: boolean;
  status: 'accepted' | 'rejected';
  reason: 'OK' | 'COOLDOWN' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
};

const replyLegacySessionRedirect = async (interaction: ChatInputCommandInteraction) => {
  await interaction.reply({
    ...buildSimpleEmbed(
      DISCORD_MESSAGES.bot.titleLegacySessionGuide,
      DISCORD_MESSAGES.bot.legacySessionGuideBody,
      EMBED_INFO,
    ),
    ephemeral: true,
  });
};

const replyLegacySubscribeRedirect = async (interaction: ChatInputCommandInteraction) => {
  await interaction.reply({
    ...buildSimpleEmbed(
      '명령 통합 안내',
      '구독 기능은 /세션 구독으로 통합되었습니다.\n사용 예: /세션 구독 동작:추가 종류:뉴스',
      EMBED_INFO,
    ),
    ephemeral: true,
  });
};

const getManualReconnectCooldownRemainingSec = () => {
  if (!botRuntimeState.lastManualReconnectAt) {
    return 0;
  }

  const lastReconnectAtMs = Date.parse(botRuntimeState.lastManualReconnectAt);
  if (!Number.isFinite(lastReconnectAtMs)) {
    return 0;
  }

  const remainingMs = Math.max(0, MANUAL_RECONNECT_COOLDOWN_MS - (Date.now() - lastReconnectAtMs));
  return Math.ceil(remainingMs / 1000);
};

const getUsageSummaryLine = async (): Promise<string> => {
  const guildCount = client.guilds.cache.size;

  if (!isSupabaseConfigured()) {
    return `Usage: guilds=${guildCount} | sources=0 (supabase not configured)`;
  }

  try {
    const db = getSupabaseClient();
    const { data, error } = await db.from('sources').select('guild_id,is_active,name');
    if (error) {
      return `Usage: guilds=${guildCount} | source-stats unavailable (${error.message})`;
    }

    const rows = data || [];
    const active = rows.filter((row: any) => Boolean(row.is_active)).length;
    const youtube = rows.filter((row: any) => String(row.name || '').startsWith('youtube-')).length;
    const news = rows.filter((row: any) => String(row.name || '') === 'google-finance-news').length;
    const activeGuilds = new Set(rows.map((row: any) => String(row.guild_id || 'unknown'))).size;
    return `Usage: guilds=${guildCount} | activeGuilds=${activeGuilds} | sources=${rows.length} (active=${active}, yt=${youtube}, news=${news})`;
  } catch (error) {
    const message = getErrorMessage(error);
    return `Usage: guilds=${guildCount} | source-stats unavailable (${message})`;
  }
};

const getGuildUsageSummaryLine = async (guildId: string | null): Promise<string | null> => {
  if (!guildId || !isSupabaseConfigured()) {
    return null;
  }

  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('sources')
      .select('is_active,name')
      .eq('guild_id', guildId);

    if (error) {
      return `Current guild: usage unavailable (${error.message})`;
    }

    const rows = data || [];
    const active = rows.filter((row: any) => Boolean(row.is_active)).length;
    const youtube = rows.filter((row: any) => String(row.name || '').startsWith('youtube-')).length;
    const news = rows.filter((row: any) => String(row.name || '') === 'google-finance-news').length;

    return `Current guild: sources=${rows.length} (active=${active}, yt=${youtube}, news=${news})`;
  } catch (error) {
    const message = getErrorMessage(error);
    return `Current guild: usage unavailable (${message})`;
  }
};

const registerSlashCommands = async () => {
  await registerSlashCommandsFromLifecycle({
    client,
    commandDefinitions,
    discordCommandGuildId: DISCORD_COMMAND_GUILD_ID,
    clearGuildScopedCommandsOnGlobalSync: CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC,
  });
};

export const forceRegisterSlashCommands = async () => {
  await registerSlashCommands();
};

const getRuntimeStatusLines = async (guildId: string | null): Promise<string[]> => {
  const bot = getBotRuntimeSnapshot();
  const automation = getAutomationRuntimeSnapshot();
  const usage = await getUsageSummaryLine();
  const guildUsage = await getGuildUsageSummaryLine(guildId);
  const jobStates = Object.values(automation.jobs)
    .map((job) => {
      const lastState = job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt))
        ? `error(${job.lastError || 'unknown'})`
        : job.running
          ? 'running'
          : 'idle';
      return `${job.name}: ${lastState}`;
    })
    .join(' | ');

  return [
    '[런타임 상태]',
    `Bot ready: ${String(bot.ready)} | wsStatus: ${bot.wsStatus}`,
    `Reconnect queued: ${String(bot.reconnectQueued)} | attempts: ${bot.reconnectAttempts}`,
    `Dynamic worker restore: enabled=${String(bot.dynamicWorkerRestoreEnabled)} approved=${bot.dynamicWorkerRestoreApprovedCount} restored=${bot.dynamicWorkerRestoreSuccessCount} failed=${bot.dynamicWorkerRestoreFailedCount}`,
    bot.dynamicWorkerRestoreLastError
      ? `Dynamic restore error: ${bot.dynamicWorkerRestoreLastError}`
      : null,
    '',
    '[자동화 상태]',
    `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
    '',
    '[사용량]',
    usage,
    guildUsage,
  ].filter(Boolean) as string[];
};


const runManualReconnect = async (reason: string): Promise<ManualReconnectRequestResult> => {
  if (!activeToken) {
    logger.warn('[BOT] Manual reconnect skipped: token unavailable');
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  if (reconnectInProgress) {
    logger.warn('[BOT] Manual reconnect skipped: reconnect already in progress');
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  reconnectInProgress = true;
  botRuntimeState.reconnectQueued = true;
  botRuntimeState.lastManualReconnectAt = new Date().toISOString();
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  logger.warn('[BOT] Manual reconnect requested: %s', reason);

  try {
    await Promise.resolve((client as any).destroy());
  } catch (error) {
    logger.warn('[BOT] client.destroy() during manual reconnect failed: %o', error);
  }

  try {
    await startBot(activeToken);
    botRuntimeState.lastRecoveryAt = new Date().toISOString();
    botRuntimeState.lastAlertAt = null;
    botRuntimeState.lastAlertReason = null;
    return {
      ok: true,
      status: 'accepted',
      reason: 'OK',
      message: '봇 재연결 요청을 전송했습니다.',
    };
  } catch (error) {
    logger.error('[BOT] Manual reconnect failed: %o', error);
    botRuntimeState.lastLoginErrorAt = new Date().toISOString();
    botRuntimeState.lastLoginError = getErrorMessage(error);
    botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
    botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
    return {
      ok: false,
      status: 'rejected',
      reason: 'RECONNECT_FAILED',
      message: '재연결에 실패했습니다. 서버 로그를 확인하세요.',
    };
  } finally {
    reconnectInProgress = false;
    botRuntimeState.reconnectQueued = false;
  }
};

export const requestManualReconnect = async (source: string): Promise<ManualReconnectRequestResult> => {
  const remaining = getManualReconnectCooldownRemainingSec();
  if (remaining > 0) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'COOLDOWN',
      message: `재연결 쿨다운 중입니다. ${remaining}초 후 다시 시도하세요.`,
    };
  }

  if (reconnectInProgress) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'IN_FLIGHT',
      message: '재연결이 이미 진행 중입니다.',
    };
  }

  if (!activeToken) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'NO_TOKEN',
      message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
    };
  }

  return runManualReconnect(source);
};

const adminHandlers = createAdminHandlers({
  getBotRuntimeSnapshot,
  getAutomationRuntimeSnapshot,
  hasAdminPermission,
  markUserLoggedIn,
  loginSessionTtlMs: LOGIN_SESSION_TTL_MS,
  loginSessionRefreshWindowMs: LOGIN_SESSION_REFRESH_WINDOW_MS,
  loginSessionCleanupIntervalMs: LOGIN_SESSION_CLEANUP_INTERVAL_MS,
  simpleCommandsEnabled: SIMPLE_COMMANDS_ENABLED,
  legacySubscribeCommandEnabled: LEGACY_SUBSCRIBE_COMMAND_ENABLED,
  legacySessionCommandsEnabled: LEGACY_SESSION_COMMANDS_ENABLED,
  getUsageSummaryLine,
  getGuildUsageSummaryLine,
  forceRegisterSlashCommands,
  triggerAutomationJob: (jobName, options) => triggerAutomationJob(jobName as any, options),
  getManualReconnectCooldownRemainingSec,
  hasActiveToken: () => Boolean(activeToken),
  requestManualReconnect: runManualReconnect,
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
});

const agentHandlers = createAgentHandlers({
  client,
  hasAdminPermission,
  handleGroupedSubscribeCommand,
  inferSessionSkill,
  streamSessionProgress,
  getRuntimeStatusLines,
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

const attachCommandHandlers = () => {
  if (commandHandlersAttached) {
    return;
  }

  commandHandlersAttached = true;

  // Wire circuit-breaker admin notifier for dynamic workers
  setDynamicWorkerAdminNotifier(async (message) => {
    if (!WORKER_APPROVAL_CHANNEL_ID) return;
    try {
      const ch = await client.channels.fetch(WORKER_APPROVAL_CHANNEL_ID);
      if (ch && 'send' in ch) await (ch as any).send(message);
    } catch (error) {
      logger.debug('[BOT] dynamic worker admin notify skipped: %s', getErrorMessage(error));
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    await handleButtonInteraction({
      interaction,
      client,
      workerApprovalChannelId: WORKER_APPROVAL_CHANNEL_ID,
      startVibeSession,
      streamSessionProgress,
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
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
        case '뮤엘': {
          await vibeHandlers.handleVibeCommand(interaction);
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
          if (!LEGACY_SUBSCRIBE_COMMAND_ENABLED) {
            await replyLegacySubscribeRedirect(interaction);
            return;
          }
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
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await agentHandlers.handleAgentCommand(interaction, '시작');
          return;
        }
        case '상태': {
          await adminHandlers.handleStatusCommand(interaction);
          return;
        }
        case '스킬목록': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await agentHandlers.handleAgentCommand(interaction, '스킬목록');
          return;
        }
        case '정책': {
          await agentHandlers.handlePolicyCommand(interaction);
          return;
        }
        case '온보딩': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await agentHandlers.handleAgentCommand(interaction, '온보딩');
          return;
        }
        case '학습': {
          await agentHandlers.handleUserLearningCommand(interaction);
          return;
        }
        case '중지': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await agentHandlers.handleAgentCommand(interaction, '중지');
          return;
        }
        default: {
          await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.bot.titleUnknownCommand, DISCORD_MESSAGES.common.unknownCommand, EMBED_WARN), ephemeral: true });
        }
      }
    } catch (error) {
      logger.error('[BOT] interaction handler failed: %o', error);
      const message = DISCORD_MESSAGES.bot.executionFailedBody;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.bot.titleExecutionFailed, message, EMBED_ERROR)).catch((replyError) => {
          logger.debug('[BOT] interaction error editReply skipped: %s', getErrorMessage(replyError));
        });
      } else {
        await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.bot.titleExecutionFailed, message, EMBED_ERROR), ephemeral: true }).catch((replyError) => {
          logger.debug('[BOT] interaction error reply skipped: %s', getErrorMessage(replyError));
        });
      }
    }
  });
};

  client.on('messageCreate', async (message) => {
    if (!SIMPLE_COMMANDS_ENABLED) {
      return;
    }

    try {
      try {
        await vibeHandlers.handleVibeMessage(message);
      } catch (error) {
        logger.warn('[BOT] vibe message handling failed: %o', error);
      }

      await processPassiveMemoryCapture(message);
    } catch (error) {
      logger.warn('[BOT] messageCreate handler failed: %o', error);
    }
  });

client.on('clientReady', () => {
  botRuntimeState.ready = true;
  botRuntimeState.started = true;
  botRuntimeState.lastReadyAt = new Date().toISOString();
  botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
  botRuntimeState.lastAlertAt = null;
  botRuntimeState.lastAlertReason = null;
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  void registerSlashCommands();
  void restoreApprovedDynamicWorkers();
  startDiscordReadyWorkloads(client);
});

client.on('guildCreate', (guild) => {
  handleGuildCreateLifecycle(guild);
});

client.on('guildDelete', (guild) => {
  handleGuildDeleteLifecycle(guild);
});

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
  } catch (error) {
    logger.debug('[REACTION-REWARD] remove skipped reason=%s', getErrorMessage(error));
  }
});

client.on('shardDisconnect', (event) => {
  botRuntimeState.ready = false;
  botRuntimeState.lastDisconnectAt = new Date().toISOString();
  botRuntimeState.lastDisconnectCode = Number(event.code);
  botRuntimeState.lastDisconnectReason = event.reason || null;
  botRuntimeState.lastInvalidatedAt = event.code === 4014 ? botRuntimeState.lastDisconnectAt : botRuntimeState.lastInvalidatedAt;
  botRuntimeState.lastAlertAt = botRuntimeState.lastDisconnectAt;
  botRuntimeState.lastAlertReason = event.reason || `Gateway disconnect code ${event.code}`;
});

client.on('invalidated', () => {
  botRuntimeState.ready = false;
  botRuntimeState.lastInvalidatedAt = new Date().toISOString();
  botRuntimeState.lastAlertAt = botRuntimeState.lastInvalidatedAt;
  botRuntimeState.lastAlertReason = 'Gateway session invalidated';
});

export function getBotRuntimeSnapshot(): BotRuntimeSnapshot {
  const started = botRuntimeState.started;
  const liveWsStatus = Number(client.ws?.status ?? botRuntimeState.wsStatus ?? -1);
  const manualCooldown = getManualReconnectCooldownRemainingSec();
  botRuntimeState.manualReconnectCooldownRemainingSec = manualCooldown;
  return {
    ...botRuntimeState,
    started,
    ready: client.isReady(),
    wsStatus: started ? liveWsStatus : -1,
    manualReconnectCooldownRemainingSec: manualCooldown,
  };
}

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');

  activeToken = token;
  attachCommandHandlers();

  botRuntimeState.tokenPresent = Boolean(token);
  const maxRetries = DISCORD_START_RETRIES;
  const readyTimeout = DISCORD_READY_TIMEOUT_MS;

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    botRuntimeState.lastLoginAttemptAt = new Date().toISOString();
    botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
    botRuntimeState.reconnectQueued = attempt > 1;
    try {
      logger.info('[BOT] Attempting login (attempt %d/%d)', attempt, maxRetries);
      await client.login(token);

      // Wait for clientReady event with configurable timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discord client ready timeout')), readyTimeout);
        if (client.isReady()) {
          clearTimeout(timeout);
          return resolve();
        }
        client.once('clientReady', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      logger.info('[BOT] Discord client logged in');
      botRuntimeState.started = true;
      botRuntimeState.reconnectQueued = false;
      botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
      return;
    } catch (err) {
      logger.error('[BOT] Login attempt %d failed: %o', attempt, err);
      botRuntimeState.lastLoginErrorAt = new Date().toISOString();
      botRuntimeState.lastLoginError = err instanceof Error ? err.message : String(err);
      botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
      botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
      try {
        await Promise.resolve((client as any).destroy());
      } catch (e) {
        logger.debug('[BOT] Error during client.destroy(): %o', e);
      }

      if (attempt < maxRetries) {
        const backoffMs = Math.min(30_000, 500 * Math.pow(2, attempt));
        logger.info('[BOT] Waiting %dms before retry', backoffMs);
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        botRuntimeState.reconnectQueued = false;
        throw err;
      }
    }
  }
}

export default { client, startBot };

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
  isAutomationEnabled,
  startAutomationModules,
  triggerAutomationJob,
} from './services/automationBot';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';
import {
  type AgentSession,
  cancelAgentSession,
  getAgentPolicy,
  getAgentSession,
  listAgentSkills,
  getMultiAgentRuntimeSnapshot,
  listGuildAgentSessions,
  startAgentSession,
} from './services/multiAgentService';
import { createMemoryItem } from './services/agentMemoryStore';
import { recordDiscordChannelMessageSignal } from './services/discordChannelTelemetryService';
import { recordReactionRewardSignal } from './services/discordReactionRewardService';
import { autoSyncGuildTopologiesOnReady } from './services/discordTopologySyncService';
import { getGuildActionPolicy } from './services/skills/actionGovernanceStore';
import { isUserLearningEnabled } from './services/userLearningPrefsService';
import { isAnyLlmConfigured } from './services/llmClient';
import { queryObsidianRAG, initObsidianRAG } from './services/obsidianRagService';
import { generateText } from './services/llmClient';
import {
  getAgentOpsSnapshot,
  onGuildJoined,
  startAgentDailyLearningLoop,
  triggerDailyLearningRun,
  triggerGuildOnboardingSession,
} from './services/agentOpsService';
import { forgetGuildRagData, forgetUserRagData } from './services/privacyForgetService';
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
  startLoginSessionCleanupLoop,
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
const LEARNING_POLICY_ACTION = 'memory_learning';
const DYNAMIC_WORKER_RESTORE_ON_BOOT = String(process.env.DYNAMIC_WORKER_RESTORE_ON_BOOT || 'true').trim().toLowerCase() !== 'false';
const learningPolicyCache = new Map<string, { enabled: boolean; fetchedAt: number }>();

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

const isGuildLearningEnabled = async (guildId: string): Promise<boolean> => {
  const cached = learningPolicyCache.get(guildId);
  if (cached && (Date.now() - cached.fetchedAt) < 30_000) {
    return cached.enabled;
  }
  const policy = await getGuildActionPolicy(guildId, LEARNING_POLICY_ACTION);
  const enabled = policy.enabled;
  learningPolicyCache.set(guildId, { enabled, fetchedAt: Date.now() });
  return enabled;
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

    const customId = interaction.customId || '';
    const colonIdx = customId.indexOf(':');
    if (colonIdx < 0) {
      return;
    }

    const action = customId.slice(0, colonIdx);
    const parentSessionId = customId.slice(colonIdx + 1).trim();

    const CODE_BUTTON_ACTIONS = new Set(['code_regen', 'code_refactor', 'code_test', 'code_history']);
    const WORKER_BUTTON_ACTIONS = new Set(['worker_propose', 'worker_approve', 'worker_reject', 'worker_refactor']);
    const SESSION_BUTTON_ACTIONS = new Set(['session_run', 'session_remove']);
    const FORGET_BUTTON_ACTIONS = new Set(['forget_confirm_user', 'forget_confirm_guild', 'forget_cancel']);
    if (!CODE_BUTTON_ACTIONS.has(action) && !WORKER_BUTTON_ACTIONS.has(action) && !SESSION_BUTTON_ACTIONS.has(action) && !FORGET_BUTTON_ACTIONS.has(action)) {
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.guildOnly, ephemeral: true });
      return;
    }

    // ── Forget confirmation button handlers ─────────────────────────────────
    if (FORGET_BUTTON_ACTIONS.has(action)) {
      const payloadParts = parentSessionId.split(':');
      const requesterId = payloadParts[payloadParts.length - 1] || '';
      if (!requesterId || requesterId !== interaction.user.id) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetRequesterOnly, ephemeral: true });
        return;
      }

      if (action === 'forget_cancel') {
        await interaction.update({ content: DISCORD_MESSAGES.bot.forgetCancelled, components: [] });
        return;
      }

      if (action === 'forget_confirm_guild') {
        if (!(await isUserAdmin(interaction.user.id))) {
          await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetGuildAdminOnly, ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await forgetGuildRagData({
            guildId: interaction.guildId,
            requestedBy: interaction.user.id,
            reason: 'button:forget_confirm_guild',
          });
          await interaction.editReply(DISCORD_MESSAGES.bot.forgetGuildDone(result.supabase.totalDeleted, result.obsidian.removedPaths.length));
        } catch (error) {
          await interaction.editReply(DISCORD_MESSAGES.bot.forgetGuildFailed(getErrorMessage(error)));
        }
        return;
      }

      const targetUserId = payloadParts[0] || '';
      if (!targetUserId) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetTargetMissing, ephemeral: true });
        return;
      }
      if (targetUserId !== interaction.user.id && !(await isUserAdmin(interaction.user.id))) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetOtherUserAdminOnly, ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await forgetUserRagData({
          userId: targetUserId,
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
          reason: 'button:forget_confirm_user',
        });
        await interaction.editReply(DISCORD_MESSAGES.bot.forgetUserDone(result.supabase.totalDeleted, result.obsidian.removedPaths.length));
      } catch (error) {
        await interaction.editReply(DISCORD_MESSAGES.bot.forgetUserFailed(getErrorMessage(error)));
      }
      return;
    }

    // ── Session control button handlers ─────────────────────────────────────
    if (SESSION_BUTTON_ACTIONS.has(action)) {
      if (!(await isUserAdmin(interaction.user.id))) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionControlAdminOnly, ephemeral: true });
        return;
      }

      const target = getAgentSession(parentSessionId);
      if (!target || target.guildId !== interaction.guildId) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionNotFoundMaybeClosed, ephemeral: true });
        return;
      }

      if (action === 'session_run') {
        try {
          const replay = startAgentSession({
            guildId: interaction.guildId,
            requestedBy: interaction.user.id,
            goal: target.goal,
            skillId: target.requestedSkillId,
            priority: target.priority,
            isAdmin: true,
          });
          await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionRunStarted(replay.id), ephemeral: true });
        } catch (error) {
          await interaction.reply({ content: DISCORD_MESSAGES.bot.runFailed(getErrorMessage(error)), ephemeral: true });
        }
        return;
      }

      const result = cancelAgentSession(parentSessionId);
      await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionRemoveResult(result.ok, parentSessionId, result.message), ephemeral: true });
      return;
    }

    // ── Worker-generation button handlers ───────────────────────────────────
    if (WORKER_BUTTON_ACTIONS.has(action)) {
      if (action === 'worker_propose') {
        // customId: worker_propose:<sessionId>:<encodedGoal>
        const sepIdx = parentSessionId.indexOf(':');
        const goalEncoded = sepIdx >= 0 ? parentSessionId.slice(sepIdx + 1) : '';
        const goal = goalEncoded ? decodeURIComponent(goalEncoded) : parentSessionId;

        await interaction.deferReply({ ephemeral: true });
        recordWorkerProposalClick();
        const pipeResult = await runWorkerGenerationPipeline({
          goal,
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
        });
        recordWorkerGenerationResult(pipeResult.ok, pipeResult.ok ? undefined : pipeResult.error);

        if (!pipeResult.ok) {
          await interaction.editReply(`❌ 워커 생성 실패: ${pipeResult.error}`);
          return;
        }

        const appr = pipeResult.approval;
        const validLine = appr.validationPassed
          ? '✅ 검증 통과'
          : `⚠️ 검증 이슈 ${appr.validationErrors.length}개: ${appr.validationErrors.slice(0, 2).join('; ')}`;
        const codeSnippet = appr.generatedCode.length > 1400
          ? `${appr.generatedCode.slice(0, 1400)}\n... (truncated)`
          : appr.generatedCode;

        const adminRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`worker_approve:${appr.id}`)
            .setLabel('✅ 배포 승인')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`worker_reject:${appr.id}`)
            .setLabel('❌ 반려')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`worker_refactor:${appr.id}`)
            .setLabel('🔧 리팩토링 지시')
            .setStyle(ButtonStyle.Secondary),
        );

        const adminContent = [
          `📦 **새 워커 생성 승인 요청**`,
          `요청자: <@${interaction.user.id}>`,
          `목적: ${goal.slice(0, 100)}`,
          `액션 이름: \`${appr.actionName}\``,
          `승인 ID: \`${appr.id}\``,
          `상태: ${validLine}`,
          '',
          '**생성된 코드:**',
          `\`\`\`javascript\n${codeSnippet}\n\`\`\``,
        ].join('\n').slice(0, 1950);

        let adminMsgId: string | undefined;
        let adminChId: string | undefined;
        try {
          const targetChId = WORKER_APPROVAL_CHANNEL_ID || interaction.channelId || '';
          if (targetChId) {
            const adminCh = await client.channels.fetch(targetChId);
            if (adminCh && 'send' in adminCh) {
              const sent = await (adminCh as any).send({ content: adminContent, components: [adminRow] });
              adminMsgId = sent.id as string;
              adminChId = targetChId;
            }
          }
        } catch (error) {
          logger.debug('[BOT] worker approval admin channel send skipped: %s', getErrorMessage(error));
        }

        await updateApprovalStatus(appr.id, 'pending', { adminMessageId: adminMsgId, adminChannelId: adminChId });
        await interaction.editReply(
          adminMsgId
            ? `📨 관리자 채널에 승인 요청을 보냈습니다.\n승인 ID: \`${appr.id}\``
            : `⚠️ 채널 전송에 실패했습니다. 관리자에게 승인 ID를 전달해주세요: \`${appr.id}\``,
        );
        return;
      }

      // Approve / Reject / Refactor — admin only
      if (!(await isUserAdmin(interaction.user.id))) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.workerApproveAdminOnly, ephemeral: true });
        return;
      }

      const appr = await getApproval(parentSessionId);
      if (!appr) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.approvalNotFound, ephemeral: true });
        return;
      }

      if (action === 'worker_approve') {
        await interaction.deferUpdate();
        if (!appr.validationPassed) {
          await interaction.followUp({ content: `⚠️ 이 워커는 검증에 실패했습니다: ${appr.validationErrors.join(', ')}`, ephemeral: true });
          return;
        }

        let gate: Awaited<ReturnType<typeof evaluateWorkerActivationGate>> | null = null;
        try {
          gate = await evaluateWorkerActivationGate({
            guildId: appr.guildId,
            actorId: interaction.user.id,
          });
        } catch (error) {
          logger.warn('[BOT] worker activation gate check failed; fail-closed: %s', getErrorMessage(error));
          await interaction.followUp({
            content: '🚫 운영 준비도 게이트 확인 중 오류가 발생해 워커 활성화를 차단했습니다. 잠시 후 다시 시도하거나 관리자 API /api/bot/agent/runtime/readiness 를 확인해주세요.',
            ephemeral: true,
          });
          return;
        }

        if (gate && !gate.allowed) {
          const details = gate.reasons.length > 0
            ? `\n- ${gate.reasons.join('\n- ')}`
            : '';
          await interaction.followUp({
            content: `🚫 현재 운영 준비도 게이트를 통과하지 못해 워커 활성화를 차단했습니다.${details}\n\n관리자 API /api/bot/agent/runtime/readiness 로 상태를 먼저 확인해주세요.`,
            ephemeral: true,
          });
          return;
        }

        let loadResult = appr.sandboxFilePath
          ? await loadDynamicWorkerFromFile(appr.sandboxFilePath, appr.id)
          : { ok: false, error: 'missing sandbox file path' };
        if (!loadResult.ok && appr.generatedCode) {
          loadResult = await loadDynamicWorkerFromCode({
            approvalId: appr.id,
            generatedCode: appr.generatedCode,
            actionNameHint: appr.actionName,
          });
        }
        if (loadResult.ok) {
          recordWorkerApprovalDecision('approved');
          await updateApprovalStatus(parentSessionId, 'approved');
          try {
            const prev = interaction.message.content.split('\n✅')[0].split('\n❌')[0];
            await interaction.message.edit({ content: `${prev}\n\n✅ **워커 활성화 완료** (승인자: <@${interaction.user.id}>)\n액션: \`${appr.actionName}\``, components: [] });
          } catch (error) {
            logger.debug('[BOT] worker approval message edit skipped: %s', getErrorMessage(error));
          }
        } else {
          await interaction.followUp({ content: `❌ 워커 로드 실패: ${loadResult.error}`, ephemeral: true });
        }
        return;
      }

      if (action === 'worker_reject') {
        await interaction.deferUpdate();
        await cleanupSandbox(appr.sandboxDir);
        recordWorkerApprovalDecision('rejected');
        await updateApprovalStatus(parentSessionId, 'rejected');
        try {
          const prev = interaction.message.content.split('\n✅')[0].split('\n❌')[0];
          await interaction.message.edit({ content: `${prev}\n\n❌ **반려됨** (처리자: <@${interaction.user.id}>)`, components: [] });
        } catch (error) {
          logger.debug('[BOT] worker reject message edit skipped: %s', getErrorMessage(error));
        }
        return;
      }

      if (action === 'worker_refactor') {
        await interaction.deferReply({ ephemeral: true });
        recordWorkerApprovalDecision('refactor_requested');
        const refactorResult = await rerunWorkerPipeline({
          approvalId: parentSessionId,
          goal: appr.goal,
          guildId: appr.guildId,
          requestedBy: interaction.user.id,
          refactorHint: '더 효율적이고 안전하게 리팩토링해줘',
        });

        if (!refactorResult.ok) {
          await interaction.editReply(`❌ 리팩토링 실패: ${refactorResult.error}`);
          return;
        }

        const newAppr = refactorResult.approval;
        const codeSnippet = newAppr.generatedCode.length > 1300
          ? `${newAppr.generatedCode.slice(0, 1300)}\n... (truncated)`
          : newAppr.generatedCode;
        const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`worker_approve:${newAppr.id}`).setLabel('✅ 배포 승인').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`worker_reject:${newAppr.id}`).setLabel('❌ 반려').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`worker_refactor:${newAppr.id}`).setLabel('🔧 리팩토링 지시').setStyle(ButtonStyle.Secondary),
        );
        try {
          await interaction.message.edit({
            content: [
              `📦 **워커 리팩토링 결과** (요청자: <@${interaction.user.id}>)`,
              `액션: \`${newAppr.actionName}\` | 승인 ID: \`${newAppr.id}\``,
              `상태: ${newAppr.validationPassed ? '✅ 검증 통과' : `⚠️ 이슈 ${newAppr.validationErrors.length}개`}`,
              '',
              '**리팩토링된 코드:**',
              `\`\`\`javascript\n${codeSnippet}\n\`\`\``,
            ].join('\n').slice(0, 1950),
            components: [newRow],
          });
        } catch (error) {
          logger.debug('[BOT] worker refactor message edit skipped: %s', getErrorMessage(error));
        }
        await interaction.editReply('🔧 리팩토링이 완료됐습니다. 관리자 메시지를 확인해주세요.');
        return;
      }

      return;
    }

    if (action === 'code_history') {
      await interaction.deferReply({ ephemeral: true });
      const chain = getChain(parentSessionId);
      if (chain.length === 0) {
        await interaction.editReply('이 세션의 코드 이력이 없습니다.');
        return;
      }
      const lines = chain.map((e, i) => {
        const prefix = i === 0 ? '🌱 원본' : `↳ v${i + 1}`;
        return `${prefix} [\`${e.sessionId.slice(0, 8)}\`] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개 | ${e.createdAt.slice(0, 10)}`;
      });
      await interaction.editReply(lines.join('\n'));
      return;
    }

    const parentArtifact = getArtifact(parentSessionId);
    if (!parentArtifact) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.parentSessionNotFound, ephemeral: true });
      return;
    }

    const ACTION_GOALS: Record<string, string> = {
      code_regen: `다음 코드를 재생성해줘. 같은 요구사항이지만 더 나은 구현으로:\n${parentArtifact.fullGoal.slice(0, 400)}`,
      code_refactor: `다음 코드를 리팩터해줘. 가독성·성능·설계를 개선하되 기존 기능은 유지:\n${parentArtifact.fullGoal.slice(0, 400)}`,
      code_test: `다음 코드에 대한 테스트 코드를 추가해줘. 단위 테스트와 핵심 케이스를 포함:\n${parentArtifact.fullGoal.slice(0, 400)}`,
    };
    const newGoal = ACTION_GOALS[action] || parentArtifact.fullGoal;

    await interaction.deferUpdate();

    const thread = interaction.channel;
    if (!thread || !('send' in thread)) {
      return;
    }

    const ACTION_LABELS: Record<string, string> = {
      code_regen: DISCORD_MESSAGES.bot.codeActionRegen,
      code_refactor: DISCORD_MESSAGES.bot.codeActionRefactor,
      code_test: DISCORD_MESSAGES.bot.codeActionTest,
    };
    const label = ACTION_LABELS[action] || action;

    let newSession: AgentSession;
    try {
      newSession = startVibeSession(interaction.guildId, interaction.user.id, newGoal);
      (newSession as any).__parentSessionId = parentSessionId; // hint for artifact linking
    } catch (error) {
      await thread.send(DISCORD_MESSAGES.bot.codeStartFailed(getErrorMessage(error)));
      return;
    }

    const progressMsg = await thread.send(DISCORD_MESSAGES.bot.codeProgressLines(label, newSession.id).join('\n'));

    await streamSessionProgress(
      { update: (content) => progressMsg.edit(content) },
      newSession.id,
      newGoal,
      { showDebugBlocks: false, maxLinks: 2 },
    );

    const completed = getAgentSession(newSession.id);
    if (completed?.status === 'completed') {
      const rawResult = String(completed.result || '').trim();
      const blocks = extractCodeBlocks(rawResult);
      if (blocks.length > 0) {
        saveArtifact({
          sessionId: completed.id,
          guildId: interaction.guildId,
          goalSummary: newGoal.slice(0, 40),
          fullGoal: newGoal,
          codeBlocks: blocks,
          rawResult,
          threadId: thread.id,
          parentSessionId,
          createdAt: new Date().toISOString(),
        });

        for (const [i, block] of blocks.entries()) {
          const safe = block.length > DISCORD_MSG_LIMIT
            ? `${block.slice(0, DISCORD_MSG_LIMIT)}\n... (truncated)`
            : block;
          const isLast = i === blocks.length - 1;
          try {
            if (isLast) {
              await thread.send({ content: safe, components: [buildCodeActionRow(completed.id)] });
            } else {
              await thread.send(safe);
            }
          } catch (error) {
            logger.debug('[BOT] code block send retry after failure: %s', getErrorMessage(error));
            try {
              await thread.send(safe);
            } catch (retryError) {
              logger.debug('[BOT] code block send retry skipped: %s', getErrorMessage(retryError));
            }
          }
        }
      }
    }
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

      if (message.guildId && !message.author.bot) {
        recordDiscordChannelMessageSignal({
          guildId: message.guildId,
          channelId: message.channelId,
          channelName: (message.channel as any)?.name || 'unknown',
          authorId: message.author.id,
        });
      }

      // Optional passive memory capture by guild policy + user preference
      if (message.guildId && !message.author.bot) {
        const guildEnabled = await isGuildLearningEnabled(message.guildId);
        const userEnabled = guildEnabled ? await isUserLearningEnabled(message.author.id, message.guildId) : false;
        const enabled = guildEnabled && userEnabled;
        const content = String(message.content || '').trim();
        if (enabled && content.length >= 20 && !content.startsWith('/')) {
          await createMemoryItem({
            guildId: message.guildId,
            channelId: message.channelId,
            type: 'episode',
            title: `discord:${message.author.id}:${new Date().toISOString().slice(0, 10)}`,
            content: content.slice(0, 2000),
            tags: ['discord-chat', 'auto-captured', `user:${message.author.id}`, `channel:${message.channelId}`],
            confidence: 0.55,
            actorId: 'system',
            ownerUserId: message.author.id,
            source: {
              sourceKind: 'discord_message',
              sourceMessageId: message.id,
              sourceAuthorId: message.author.id,
              sourceRef: `discord://guild/${message.guildId}/channel/${message.channelId}/message/${message.id}`,
              excerpt: content.slice(0, 300),
            },
          }).catch((error) => {
            logger.debug('[MEMORY] passive capture skipped: %s', getErrorMessage(error));
          });
        }
      }
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
  if (isAutomationEnabled()) {
    startAutomationModules(client);
  }

  void restoreApprovedDynamicWorkers();

  startAgentDailyLearningLoop(client);
  startLoginSessionCleanupLoop();

  void autoSyncGuildTopologiesOnReady(client.guilds.cache.values()).catch((error) => {
    logger.debug('[DISCORD-TOPOLOGY] ready sweep skipped reason=%s', getErrorMessage(error));
  });
});

client.on('guildCreate', (guild) => {
  const result = onGuildJoined(guild);
  logger.info('[AGENT-OPS] guildCreate onboarding guild=%s ok=%s message=%s', guild.id, String(result.ok), result.message);
});

client.on('guildDelete', (guild) => {
  const autoPurgeEnabled = String(process.env.FORGET_ON_GUILD_DELETE || 'true').trim().toLowerCase() !== 'false';
  if (!autoPurgeEnabled) {
    return;
  }

  void (async () => {
    try {
      const result = await forgetGuildRagData({
        guildId: guild.id,
        requestedBy: 'system:guildDelete',
        reason: 'discord guildDelete event',
        deleteObsidian: true,
      });
      logger.warn(
        '[PRIVACY-FORGET] guildDelete purge completed guild=%s deleted=%d obsidianPaths=%d',
        guild.id,
        result.supabase.totalDeleted,
        result.obsidian.removedPaths.length,
      );
    } catch (error) {
      logger.error('[PRIVACY-FORGET] guildDelete purge failed guild=%s error=%s', guild.id, error instanceof Error ? error.message : String(error));
    }
  })();
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

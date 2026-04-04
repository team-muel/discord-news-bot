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
  DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
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
import { recordCommunityInteractionEvent } from './services/communityGraphService';
import { recordReactionRewardSignal } from './services/discord-support/discordReactionRewardService';
import { trackUserActivity } from './services/discord-support/userCrmService';
import { isAnyLlmConfigured } from './services/llmClient';
import { queryObsidianRAG, initObsidianRAG } from './services/obsidian/obsidianRagService';
import { listObsidianTasksWithAdapter, toggleObsidianTaskWithAdapter } from './services/obsidian/router';
import { generateText } from './services/llmClient';
import {
  getAgentOpsSnapshot,
  triggerDailyLearningRun,
  triggerGuildOnboardingSession,
} from './services/agent/agentOpsService';
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
import { runWithConcurrency } from './utils/async';
import { runWorkerGenerationPipeline, rerunWorkerPipeline } from './services/workerGeneration/workerGenerationPipeline';
import { getApproval, listApprovals, updateApprovalStatus } from './services/workerGeneration/workerApprovalStore';
import { loadDynamicWorkerFromCode, loadDynamicWorkerFromFile, setDynamicWorkerAdminNotifier } from './services/workerGeneration/dynamicWorkerRegistry';
import {
  recordWorkerApprovalDecision,
  recordWorkerGenerationResult,
  recordWorkerProposalClick,
  getWorkerProposalMetricsSnapshot,
} from './services/workerGeneration/workerProposalMetrics';
import { cleanupSandbox } from './services/workerGeneration/workerSandbox';
import { executeExternalAction } from './services/tools/externalAdapterRegistry';
import { parseBooleanEnv } from './utils/env';
import { evaluateWorkerActivationGate } from './services/agent/agentRuntimeReadinessService';
import { getGuildActionPolicy, upsertGuildActionPolicy } from './services/skills/actionGovernanceStore';
import { triggerLacunaSprintIfNeeded, type LacunaCandidate } from './services/sprint/selfImprovementLoop';
import {
  evaluateAutoProposalPromotionGate,
  enforceImplementApprovalRequiredPilot,
  startAutoWorkerProposalBackgroundLoop,
} from './services/workerGeneration/backgroundProposalSweep';
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
import { createPersonaHandlers } from './discord/commands/persona';
import { createCrmHandlers } from './discord/commands/crm';
import { createTasksHandlers } from './discord/commands/tasks';
import { startDiscordReadyWorkloads } from './discord/runtime/readyWorkloads';
import { processPassiveMemoryCapture, isGuildLearningEnabled } from './discord/runtime/passiveMemoryCapture';
import { handleCsChannelMessage, recordRuntimeError } from './services/sprint/sprintTriggers';
import { handleButtonInteraction } from './discord/runtime/buttonInteractions';
import { handleGuildCreateLifecycle, handleGuildDeleteLifecycle } from './discord/runtime/guildLifecycle';
import { loginDiscordClientWithTimeout } from './discord/runtime/loginAttempt';
import { probeDiscordGatewayConnectivity } from './discord/runtime/gatewayPreflight';
import { DISCORD_MESSAGES } from './discord/messages';
import { isStockFeatureEnabled } from './services/trading/stockService';


const discordIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMembers,
  ...(DISCORD_MESSAGE_CONTENT_INTENT_ENABLED ? [GatewayIntentBits.MessageContent] : []),
];

export const client = new Client({
  intents: discordIntents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

const MANUAL_RECONNECT_COOLDOWN_MS = parseInt(
  process.env.BOT_MANUAL_RECONNECT_COOLDOWN_MS
  || process.env.DISCORD_MANUAL_RECONNECT_COOLDOWN_MS
  || '30000',
  10,
);
const DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS = Math.max(
  0,
  Number(process.env.DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS || 5 * 60_000),
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
  loginRateLimitUntil: string | null;
  loginRateLimitRemainingSec: number;
  loginRateLimitReason: string | null;
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
  loginRateLimitUntil: null,
  loginRateLimitRemainingSec: 0,
  loginRateLimitReason: null,
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
  reason: 'OK' | 'COOLDOWN' | 'RATE_LIMIT' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
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

const getLoginRateLimitRemainingSec = () => {
  if (!botRuntimeState.loginRateLimitUntil) {
    return 0;
  }

  const untilMs = Date.parse(botRuntimeState.loginRateLimitUntil);
  if (!Number.isFinite(untilMs)) {
    return 0;
  }

  return Math.ceil(Math.max(0, untilMs - Date.now()) / 1000);
};

const clearLoginRateLimit = () => {
  botRuntimeState.loginRateLimitUntil = null;
  botRuntimeState.loginRateLimitRemainingSec = 0;
  botRuntimeState.loginRateLimitReason = null;
};

const isDiscordLoginRateLimitedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Discord login rate-limited; retry after/i.test(message);
};

const setLoginRateLimit = (cooldownMs: number, reason: string) => {
  const safeCooldownMs = Math.max(1_000, Number(cooldownMs) || 0) + DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS;
  botRuntimeState.loginRateLimitUntil = new Date(Date.now() + safeCooldownMs).toISOString();
  botRuntimeState.loginRateLimitRemainingSec = Math.ceil(safeCooldownMs / 1000);
  botRuntimeState.loginRateLimitReason = reason;
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
  if (!client.application) {
    logger.warn('[BOT] Discord application context unavailable, skipping slash command sync');
    return;
  }

  try {
    let targetGuildIdForFastSync: string | null = null;
    if (DISCORD_COMMAND_GUILD_ID) {
      let guild: Guild | undefined;
      try {
        guild = await client.guilds.fetch(DISCORD_COMMAND_GUILD_ID);
      } catch (fetchError) {
        logger.error('[BOT] Failed to fetch target guild %s for slash sync: %o', DISCORD_COMMAND_GUILD_ID, fetchError);
      }

      if (guild) {
        await guild.commands.set(commandDefinitions);
        logger.info('[BOT] Slash commands synced to guild=%s (%d commands)', DISCORD_COMMAND_GUILD_ID, commandDefinitions.length);
        targetGuildIdForFastSync = DISCORD_COMMAND_GUILD_ID;
      }

      if (!guild) {
        logger.warn('[BOT] Falling back to global slash command sync because target guild is unavailable');
      }
    }

    await client.application.commands.set(commandDefinitions);
    logger.info('[BOT] Slash commands synced globally (%d commands)', commandDefinitions.length);

    if (CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC) {
      let cleared = 0;
      for (const guild of client.guilds.cache.values()) {
        if (targetGuildIdForFastSync && guild.id === targetGuildIdForFastSync) continue;
        try {
          await guild.commands.set([]);
          cleared += 1;
        } catch (clearError) {
          logger.warn('[BOT] Failed to clear guild-scoped commands for guild=%s: %o', guild.id, clearError);
        }
      }
      logger.info('[BOT] Cleared stale guild-scoped commands for %d guild(s)', cleared);
    }
  } catch (error) {
    logger.error('[BOT] Failed to sync slash commands: %o', error);
  }
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
    // Re-read token from env if cleared (e.g., after invalidation)
    const token = activeToken || process.env.DISCORD_BOT_TOKEN || null;
    if (!token) {
      reconnectInProgress = false;
      botRuntimeState.reconnectQueued = false;
      return {
        ok: false,
        status: 'rejected',
        reason: 'NO_TOKEN',
        message: '활성 봇 토큰이 없어 재연결할 수 없습니다.',
      };
    }
    await startBot(token);
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
    if (/Discord login rate-limited; retry after/i.test(botRuntimeState.lastLoginError || '')) {
      // Ensure rate-limit state is set even if startBot threw before setLoginRateLimit
      if (getLoginRateLimitRemainingSec() <= 0) {
        const fallbackCooldownMs = 10 * 60_000; // 10 min safety net
        setLoginRateLimit(fallbackCooldownMs, botRuntimeState.lastLoginError || 'rate-limit fallback');
        logger.warn('[BOT] Rate-limit state missing after 429 error; applied fallback cooldown %dms', fallbackCooldownMs);
      }
      return {
        ok: false,
        status: 'rejected',
        reason: 'RATE_LIMIT',
        message: `Discord 로그인 한도에 걸렸습니다. ${getLoginRateLimitRemainingSec()}초 후 다시 시도하세요.`,
      };
    }
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

  const rateLimitRemainingSec = getLoginRateLimitRemainingSec();
  if (rateLimitRemainingSec > 0) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'RATE_LIMIT',
      message: `Discord 로그인 한도에 걸렸습니다. ${rateLimitRemainingSec}초 후 다시 시도하세요.`,
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
  autoProposeWorker: async ({ guildId, requestedBy, request }) => {
    const AUTO_PROPOSAL_PROMOTION_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.VIBE_AUTO_WORKER_PROMOTION_ENABLED || 'true').trim());
    const AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY = Math.max(1, Number(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY || 5));
    const AUTO_PROPOSAL_PROMOTION_WINDOW_DAYS = Math.max(1, Number(process.env.VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS || 7));
    const AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS = Math.max(1, Number(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS || 3));
    const AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE = Math.min(1, Math.max(0, Number(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE || 0.65)));
    const AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE = Math.min(1, Math.max(0, Number(process.env.VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE || 0.10)));
    const AUTO_PROPOSAL_DAILY_CAP_PER_GUILD = Math.max(1, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_DAILY_CAP_PER_GUILD || 10));
    const AUTO_PROPOSAL_DUPLICATE_WINDOW_MS = Math.max(60_000, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_DUPLICATE_WINDOW_MS || 24 * 60 * 60_000));
    const AUTO_PROPOSAL_MIN_SUCCESS_RATE = Math.min(1, Math.max(0, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_MIN_SUCCESS_RATE || 0.45)));
    const AUTO_PROPOSAL_MIN_SAMPLES = Math.max(3, Number(process.env.VIBE_AUTO_WORKER_PROPOSAL_MIN_SAMPLES || 6));

    const nowMs = Date.now();
    const dayAgoIso = new Date(nowMs - 24 * 60 * 60_000).toISOString();
    const dedupSinceMs = nowMs - AUTO_PROPOSAL_DUPLICATE_WINDOW_MS;
    const normalizeGoal = (input: string): string => String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();

    const allApprovals = await listApprovals({ status: 'all' });
    const guildRecentApprovals = allApprovals.filter((entry) => entry.guildId === guildId && entry.createdAt >= dayAgoIso);
    if (guildRecentApprovals.length >= AUTO_PROPOSAL_DAILY_CAP_PER_GUILD) {
      return {
        ok: false,
        error: `AUTO_PROPOSAL_DAILY_CAP_REACHED:${AUTO_PROPOSAL_DAILY_CAP_PER_GUILD}`,
      };
    }

    const normalizedRequest = normalizeGoal(request);
    const hasRecentDuplicate = allApprovals.some((entry) => {
      if (entry.guildId !== guildId) {
        return false;
      }
      const createdAtMs = Date.parse(entry.createdAt);
      if (!Number.isFinite(createdAtMs) || createdAtMs < dedupSinceMs) {
        return false;
      }
      return normalizeGoal(entry.goal) === normalizedRequest;
    });
    if (hasRecentDuplicate) {
      return {
        ok: false,
        error: 'AUTO_PROPOSAL_DUPLICATE_RECENT',
      };
    }

    if (AUTO_PROPOSAL_PROMOTION_ENABLED) {
      const promotion = await evaluateAutoProposalPromotionGate({
        guildId,
        request,
        windowDays: AUTO_PROPOSAL_PROMOTION_WINDOW_DAYS,
        minFrequency: AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY,
        minDistinctRequesters: AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS,
        minOutcomeScore: AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE,
        maxPolicyBlockRate: AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE,
      });

      if (!promotion.ok) {
        return {
          ok: false,
          error: [
            'AUTO_PROPOSAL_PROMOTION_THRESHOLD',
            `freq=${promotion.frequency}/${AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY}`,
            `distinct=${promotion.distinctRequesters}/${AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS}`,
            `outcome=${promotion.avgOutcomeScore.toFixed(3)}/${AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE.toFixed(3)}`,
            `policy_block=${promotion.policyBlockRate.toFixed(3)}/${AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE.toFixed(3)}`,
          ].join(':'),
        };
      }
    }

    const metrics = getWorkerProposalMetricsSnapshot();
    if (metrics.generationRequested >= AUTO_PROPOSAL_MIN_SAMPLES && metrics.generationSuccessRate < AUTO_PROPOSAL_MIN_SUCCESS_RATE) {
      return {
        ok: false,
        error: `AUTO_PROPOSAL_QUALITY_GUARD:${metrics.generationSuccessRate.toFixed(3)}<${AUTO_PROPOSAL_MIN_SUCCESS_RATE.toFixed(3)}`,
      };
    }

    const pipeResult = await runWorkerGenerationPipeline({
      goal: request,
      guildId,
      requestedBy,
    });
    recordWorkerGenerationResult(pipeResult.ok, pipeResult.ok ? undefined : pipeResult.error);
    if (!pipeResult.ok) {
      return {
        ok: false,
        error: pipeResult.error,
      };
    }

    return {
      ok: true,
      approvalId: pipeResult.approval.id,
    };
  },
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
            const { generateMetricReviewSnapshot, formatMetricReviewForDiscord } = await import('./services/metricReviewFormatter');
            const snapshot = await generateMetricReviewSnapshot();
            const content = formatMetricReviewForDiscord(snapshot);
            // Discord message limit is 2000 chars
            const trimmed = content.length > 1900 ? content.slice(0, 1900) + '\n\n_(잘림)_' : content;
            await interaction.editReply({ content: trimmed });
          } catch (err) {
            await interaction.editReply({ content: `Metric Review 생성 실패: ${err instanceof Error ? err.message : String(err)}` });
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
};

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

client.on('clientReady', () => {
  botRuntimeState.ready = true;
  botRuntimeState.started = true;
  botRuntimeState.lastReadyAt = new Date().toISOString();
  botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
  botRuntimeState.lastAlertAt = null;
  botRuntimeState.lastAlertReason = null;
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  void registerSlashCommands().catch((err) => logger.error('[BOT] registerSlashCommands failed: %s', err instanceof Error ? err.message : String(err)));
  void restoreApprovedDynamicWorkers().catch((err) => logger.error('[BOT] restoreApprovedDynamicWorkers failed: %s', err instanceof Error ? err.message : String(err)));
  void enforceImplementApprovalRequiredPilot([...client.guilds.cache.keys()]).catch((err) => logger.error('[BOT] enforceImplementApprovalRequiredPilot failed: %s', err instanceof Error ? err.message : String(err)));
  startAutoWorkerProposalBackgroundLoop();
  startDiscordReadyWorkloads(client);
});

client.on('guildCreate', (guild) => {
  handleGuildCreateLifecycle(guild);
});

client.on('guildDelete', (guild) => {
  handleGuildDeleteLifecycle(guild);
});

// CRM: track member join/leave (touch-only, no counter increment)
client.on('guildMemberAdd', (member) => {
  if (member.user.bot) return;
  trackUserActivity({ userId: member.id, guildId: member.guild.id, counter: 'session_count', delta: 0 });
});

client.on('guildMemberRemove', (member) => {
  if (member.user?.bot) return;
  trackUserActivity({ userId: member.id, guildId: member.guild.id, counter: 'session_count', delta: 0 });
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
  activeToken = null;
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

export function getBotRuntimeSnapshot(): BotRuntimeSnapshot {
  const started = botRuntimeState.started;
  const liveWsStatus = Number(client.ws?.status ?? botRuntimeState.wsStatus ?? -1);
  const manualCooldown = getManualReconnectCooldownRemainingSec();
  const loginRateLimitRemainingSec = getLoginRateLimitRemainingSec();
  botRuntimeState.manualReconnectCooldownRemainingSec = manualCooldown;
  botRuntimeState.loginRateLimitRemainingSec = loginRateLimitRemainingSec;
  return {
    ...botRuntimeState,
    started,
    ready: client.isReady(),
    wsStatus: started ? liveWsStatus : -1,
    manualReconnectCooldownRemainingSec: manualCooldown,
    loginRateLimitRemainingSec,
  };
}

export async function startBot(token: string): Promise<void> {
  if (!token) throw new Error('Discord token is required');

  activeToken = token;
  attachCommandHandlers();

  botRuntimeState.tokenPresent = Boolean(token);
  const maxRetries = DISCORD_START_RETRIES;
  const readyTimeout = DISCORD_READY_TIMEOUT_MS;
  const initialRateLimitRemainingSec = getLoginRateLimitRemainingSec();

  if (client.isReady()) {
    logger.warn('[BOT] client already ready');
    return;
  }

  if (initialRateLimitRemainingSec > 0) {
    botRuntimeState.loginRateLimitRemainingSec = initialRateLimitRemainingSec;
    throw new Error(`Discord login rate-limited; retry after ${initialRateLimitRemainingSec}s`);
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    botRuntimeState.lastLoginAttemptAt = new Date().toISOString();
    botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
    botRuntimeState.reconnectQueued = attempt > 1;
    try {
      const preflightTimeoutMs = Math.max(5_000, Math.min(15_000, Math.floor(readyTimeout / 8)));
      const preflight = await probeDiscordGatewayConnectivity(token, preflightTimeoutMs);
      if (!preflight.ok) {
        const preflightLog = preflight.blocking ? logger.error.bind(logger) : logger.warn.bind(logger);
        preflightLog(
          '[BOT] Discord preflight failed restOk=%s wsOk=%s status=%s cached=%s cooldownMs=%d bot=%s gateway=%s reason=%s',
          String(preflight.restOk),
          String(preflight.wsOk),
          String(preflight.statusCode),
          String(preflight.cached),
          Number(preflight.cooldownMs || 0),
          preflight.botTag || 'unknown',
          preflight.gatewayUrl || 'unknown',
          preflight.error || 'unknown',
        );
        if (preflight.statusCode === 429 && Number(preflight.cooldownMs || 0) > 0) {
          setLoginRateLimit(preflight.cooldownMs, preflight.error || 'discord gateway/bot rate limited');
          throw new Error(`Discord login rate-limited; retry after ${getLoginRateLimitRemainingSec()}s`);
        }
        if (preflight.blocking) {
          throw new Error(`Discord preflight failed: ${preflight.error || 'unknown'}`);
        }
      } else {
        logger.info(
          '[BOT] Discord preflight ok cached=%s gateway=%s',
          String(preflight.cached),
          preflight.gatewayUrl || 'unknown',
        );
      }

      logger.info(
        '[BOT] Attempting login (attempt %d/%d, timeoutMs=%d, messageContentIntent=%s)',
        attempt,
        maxRetries,
        readyTimeout,
        String(DISCORD_MESSAGE_CONTENT_INTENT_ENABLED),
      );
      await loginDiscordClientWithTimeout(client, token, readyTimeout);

      logger.info('[BOT] Discord client logged in');
      clearLoginRateLimit();
      botRuntimeState.started = true;
      botRuntimeState.reconnectQueued = false;
      botRuntimeState.reconnectAttempts = Math.max(0, attempt - 1);
      return;
    } catch (err) {
      if (isDiscordLoginRateLimitedError(err)) {
        logger.warn('[BOT] Login attempt %d deferred by Discord rate limit: %s', attempt, err instanceof Error ? err.message : String(err));
      } else {
        logger.error('[BOT] Login attempt %d failed: %o', attempt, err);
      }
      botRuntimeState.lastLoginErrorAt = new Date().toISOString();
      botRuntimeState.lastLoginError = err instanceof Error ? err.message : String(err);
      botRuntimeState.lastAlertAt = botRuntimeState.lastLoginErrorAt;
      botRuntimeState.lastAlertReason = botRuntimeState.lastLoginError;
      try {
        await Promise.resolve((client as any).destroy());
      } catch (e) {
        logger.debug('[BOT] Error during client.destroy(): %o', e);
      }

      const rateLimitRemainingSec = getLoginRateLimitRemainingSec();
      if (rateLimitRemainingSec > 0) {
        botRuntimeState.reconnectQueued = false;
        throw err;
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

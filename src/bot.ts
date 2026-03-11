import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
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
import {
  createYouTubeSubscription,
  deleteYouTubeSubscription,
  listYouTubeSubscriptions,
  type YouTubeSubscription,
} from './services/youtubeSubscriptionStore';
import {
  createNewsChannelSubscription,
  deleteNewsChannelSubscription,
  listNewsChannelSubscriptions,
} from './services/newsChannelStore';
import {
  getDiscordLoginSessionExpiryMs,
  purgeExpiredDiscordLoginSessions,
  upsertDiscordLoginSession,
} from './services/discordLoginSessionStore';
import { fetchStockChartImageUrl, fetchStockQuote, isStockFeatureEnabled } from './services/stockService';
import { generateInvestmentAnalysis, isInvestmentAnalysisEnabled } from './services/investmentAnalysisService';
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
import { isAnyLlmConfigured } from './services/llmClient';
import {
  getAgentOpsSnapshot,
  onGuildJoined,
  startAgentDailyLearningLoop,
  triggerDailyLearningRun,
  triggerGuildOnboardingSession,
} from './services/agentOpsService';

export const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] });

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
};

let commandHandlersAttached = false;
let activeToken: string | null = null;
let reconnectInProgress = false;
const CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC = !['0', 'false', 'no', 'off']
  .includes(String(process.env.DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC || 'true').toLowerCase());
const SIMPLE_COMMANDS_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.DISCORD_SIMPLE_COMMANDS_ENABLED || 'true').toLowerCase());
const SIMPLE_COMMAND_ALLOWLIST = new Set(['ping', '도움말', '설정', '구독', '로그인']);
const LEGACY_SESSION_COMMANDS_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.LEGACY_SESSION_COMMANDS_ENABLED || 'false').toLowerCase());
const LEGACY_SESSION_COMMAND_NAMES = new Set(['시작', '상태', '스킬목록', '정책', '온보딩', '학습', '중지']);
const LEGACY_SUBSCRIBE_COMMAND_ENABLED = !['0', 'false', 'no', 'off']
  .includes(String(process.env.LEGACY_SUBSCRIBE_COMMAND_ENABLED || 'false').toLowerCase());
const LOGIN_SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_TTL_MS || 24 * 60 * 60 * 1000),
);
const LOGIN_SESSION_REFRESH_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS || 2 * 60 * 60 * 1000),
);
const LOGIN_SESSION_CLEANUP_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS || 30 * 60 * 1000),
);
const loggedInUsersByGuild = new Map<string, Map<string, number>>();
let loginSessionCleanupTimer: NodeJS.Timeout | null = null;

export type ManualReconnectRequestResult = {
  ok: boolean;
  status: 'accepted' | 'rejected';
  reason: 'OK' | 'COOLDOWN' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
};

type ReplyVisibility = 'private' | 'public';

const EMBED_INFO = 0x2f80ed;
const EMBED_SUCCESS = 0x2ecc71;
const EMBED_WARN = 0xf39c12;
const EMBED_ERROR = 0xe74c3c;

const buildSimpleEmbed = (title: string, description: string, color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      description: String(description || '').slice(0, 3900),
      color,
    },
  ],
});

const buildUserCard = (title: string, description: string, color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      description: String(description || '').slice(0, 3900),
      color,
      footer: { text: 'Muel for Users' },
    },
  ],
});

const buildAdminCard = (title: string, summary: string, details: string[] = [], color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      color,
      description: String(summary || '').slice(0, 2000),
      fields: details.length > 0
        ? [
          {
            name: '상세 정보',
            value: details.join('\n').slice(0, 1000),
          },
        ]
        : undefined,
      footer: { text: 'Muel for Admins' },
    },
  ],
});

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

    if (parts.length > 0) {
      return parts.join(' | ');
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
};

const getReplyVisibility = (interaction: ChatInputCommandInteraction): ReplyVisibility => {
  const value = interaction.options.getString('응답방식') || interaction.options.getString('공개범위');
  return value === 'public' ? 'public' : 'private';
};

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is responsive'),
  new SlashCommandBuilder()
    .setName('도움말')
    .setDescription('사용 가능한 명령어 안내'),
  new SlashCommandBuilder()
    .setName('설정')
    .setDescription('현재 봇 사용 모드/설정 안내')
    .addStringOption((option) =>
      option
        .setName('항목')
        .setDescription('확인할 설정 항목')
        .setRequired(false)
        .addChoices(
          { name: '모드', value: 'mode' },
          { name: '명령어', value: 'commands' },
          { name: '자동화', value: 'automation' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('로그인')
    .setDescription('내 계정으로 봇 기능 사용 가능 여부를 진단합니다')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('주가')
    .setDescription('주식 현재 가격 조회')
    .addStringOption((option) =>
      option
        .setName('symbol')
        .setDescription('예: AAPL, TSLA, MSFT')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('응답방식')
        .setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices(
          { name: '나만 보기', value: 'private' },
          { name: '채널에 공유', value: 'public' },
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('차트')
    .setDescription('주식 30일 차트 조회')
    .addStringOption((option) =>
      option
        .setName('symbol')
        .setDescription('예: AAPL, TSLA, MSFT')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('응답방식')
        .setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices(
          { name: '나만 보기', value: 'private' },
          { name: '채널에 공유', value: 'public' },
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('분석')
    .setDescription('AI 투자 관점 분석')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('기업/종목/테마 입력')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('응답방식')
        .setDescription('응답을 나만 볼지, 채널에 공유할지 선택')
        .addChoices(
          { name: '나만 보기', value: 'private' },
          { name: '채널에 공유', value: 'public' },
        )
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('구독')
    .setDescription('영상/게시글/뉴스를 구독합니다')
    .addStringOption((option) =>
      option
        .setName('동작')
        .setDescription('무엇을 할지 선택')
        .setRequired(false)
        .addChoices(
          { name: '추가', value: 'add' },
          { name: '해제', value: 'remove' },
          { name: '목록', value: 'list' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('종류')
        .setDescription('대상 구독 종류 (미입력 시 자동 추론)')
        .setRequired(false)
        .addChoices(
          { name: '영상', value: 'videos' },
          { name: '게시글', value: 'posts' },
          { name: '뉴스', value: 'news' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('유튜브채널')
        .setDescription('영상/게시글일 때 채널 URL 또는 UC... 채널 ID')
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName('디스코드채널')
        .setDescription('추가/해제 대상 Discord 채널 (목록은 생략 가능)')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        )
        .setRequired(false),
    ),
      new SlashCommandBuilder()
        .setName('해줘')
        .setDescription('자연어로 요청하면 작업을 알아서 진행합니다')
        .setDMPermission(false)
        .addStringOption((option) =>
          option
            .setName('요청')
            .setDescription('예: 고양이 영상 찾아줘, 이번주 애플 주가 요약해줘')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('공개범위')
            .setDescription('응답을 나만 볼지 채널에 공유할지 선택')
            .addChoices(
              { name: '나만 보기', value: 'private' },
              { name: '채널에 공유', value: 'public' },
            )
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName('세션')
        .setDescription('자동화 세션 추가/조회/제거')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) =>
          sub
            .setName('추가')
            .setDescription('새 자동화 세션 실행')
            .addStringOption((option) =>
              option
                .setName('스킬')
                .setDescription('실행할 스킬(미입력 시 자동 선택)')
                .setRequired(false)
                .addChoices(
                  { name: 'ops-plan', value: 'ops-plan' },
                  { name: 'ops-execution', value: 'ops-execution' },
                  { name: 'ops-critique', value: 'ops-critique' },
                  { name: 'guild-onboarding-blueprint', value: 'guild-onboarding-blueprint' },
                  { name: 'incident-review', value: 'incident-review' },
                  { name: 'webhook', value: 'webhook' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('요청')
                .setDescription('하고 싶은 작업(미입력 시 기본 실행안 생성)')
                .setRequired(false),
            )
            .addStringOption((option) =>
              option
                .setName('설명')
                .setDescription('추가 설명(선택)')
                .setRequired(false),
            )
            .addStringOption((option) =>
              option
                .setName('공개범위')
                .setDescription('응답을 나만 볼지 채널에 공유할지 선택')
                .addChoices(
                  { name: '나만 보기', value: 'private' },
                  { name: '채널에 공유', value: 'public' },
                )
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('구독')
            .setDescription('구독 자동화 세션 관리(추가/해제/목록)')
            .addStringOption((option) =>
              option
                .setName('동작')
                .setDescription('무엇을 할지 선택')
                .setRequired(false)
                .addChoices(
                  { name: '추가', value: 'add' },
                  { name: '해제', value: 'remove' },
                  { name: '목록', value: 'list' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('종류')
                .setDescription('대상 구독 종류 (미입력 시 자동 추론)')
                .setRequired(false)
                .addChoices(
                  { name: '영상', value: 'videos' },
                  { name: '게시글', value: 'posts' },
                  { name: '뉴스', value: 'news' },
                ),
            )
            .addStringOption((option) =>
              option
                .setName('유튜브채널')
                .setDescription('영상/게시글일 때 채널 URL 또는 UC... 채널 ID')
                .setRequired(false),
            )
            .addChannelOption((option) =>
              option
                .setName('디스코드채널')
                .setDescription('추가/해제 대상 Discord 채널 (목록은 생략 가능)')
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                  ChannelType.PublicThread,
                  ChannelType.PrivateThread,
                  ChannelType.AnnouncementThread,
                )
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('조회')
            .setDescription('세션 상태 조회')
            .addStringOption((option) =>
              option
                .setName('세션아이디')
                .setDescription('조회할 세션 ID(생략 시 최근 목록)')
                .setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName('제거')
            .setDescription('실행 중 세션 제거(중지 요청)')
            .addStringOption((option) =>
              option
                .setName('세션아이디')
                .setDescription('제거할 세션 ID')
                .setRequired(true),
            ),
        ),
      new SlashCommandBuilder()
        .setName('시작')
        .setDescription('세션 시작(호환 명령)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
          option
            .setName('목표')
            .setDescription('예: 온보딩 자동화 정책 설계')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('스킬')
            .setDescription('특정 스킬을 지정해 단일 실행')
            .addChoices(
              { name: 'ops-plan', value: 'ops-plan' },
              { name: 'ops-execution', value: 'ops-execution' },
              { name: 'ops-critique', value: 'ops-critique' },
              { name: 'guild-onboarding-blueprint', value: 'guild-onboarding-blueprint' },
              { name: 'incident-review', value: 'incident-review' },
            )
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('우선순위')
            .setDescription('실행 전략: 빠름/균형/정밀')
            .addChoices(
              { name: '빠름', value: 'fast' },
              { name: '균형', value: 'balanced' },
              { name: '정밀', value: 'precise' },
            )
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('공개범위')
            .setDescription('응답을 나만 볼지 채널에 공유할지 선택')
            .addChoices(
              { name: '나만 보기', value: 'private' },
              { name: '채널에 공유', value: 'public' },
            )
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName('상태')
        .setDescription('최근 세션 또는 특정 세션 상태 확인')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
          option
            .setName('종류')
            .setDescription('운영/세션/전체 중 표시할 상태 유형')
            .addChoices(
              { name: '전체', value: 'all' },
              { name: '운영', value: 'runtime' },
              { name: '세션', value: 'session' },
            )
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('세션아이디')
            .setDescription('확인할 세션 ID')
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName('스킬목록')
        .setDescription('사용 가능한 스킬 목록 확인')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('정책')
        .setDescription('실행 한도 및 운영 정책 조회')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('온보딩')
        .setDescription('현재 길드 온보딩 분석 실행')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      new SlashCommandBuilder()
        .setName('학습')
        .setDescription('현재 길드 일일 학습/회고 실행')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
          option
            .setName('목표')
            .setDescription('선택: 기본 회고 목표 대신 사용자 지정 목표')
            .setRequired(false),
        ),
      new SlashCommandBuilder()
        .setName('중지')
        .setDescription('실행 중 세션 중지 요청')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
          option
            .setName('세션아이디')
            .setDescription('중지할 세션 ID')
            .setRequired(true),
        ),
]
  .map((definition) => definition.toJSON())
  .filter((definition) => {
    const name = String((definition as any).name || '');
    if (!LEGACY_SUBSCRIBE_COMMAND_ENABLED && name === '구독') {
      return false;
    }
    if (!LEGACY_SESSION_COMMANDS_ENABLED && LEGACY_SESSION_COMMAND_NAMES.has(name)) {
      return false;
    }
    return !SIMPLE_COMMANDS_ENABLED || SIMPLE_COMMAND_ALLOWLIST.has(name);
  });

const replyLegacySessionRedirect = async (interaction: ChatInputCommandInteraction) => {
  await interaction.reply({
    ...buildSimpleEmbed(
      '명령 통합 안내',
      '해당 명령은 /세션으로 통합되었습니다.\n사용 예: /세션 추가, /세션 조회, /세션 제거',
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

const hasAdminPermission = async (interaction: ChatInputCommandInteraction): Promise<boolean> => {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  try {
    return await isUserAdmin(interaction.user.id);
  } catch {
    return false;
  }
};

const cacheLoginSession = (guildId: string, userId: string, expiresAt: number) => {
  const guildUsers = loggedInUsersByGuild.get(guildId) || new Map<string, number>();
  guildUsers.set(userId, expiresAt);
  loggedInUsersByGuild.set(guildId, guildUsers);
};

const uncacheLoginSession = (guildId: string, userId: string) => {
  const guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) {
    return;
  }

  guildUsers.delete(userId);
  if (guildUsers.size === 0) {
    loggedInUsersByGuild.delete(guildId);
  }
};

const markUserLoggedIn = async (guildId: string, userId: string): Promise<'persisted' | 'memory-only'> => {
  const expiresAt = Date.now() + LOGIN_SESSION_TTL_MS;
  cacheLoginSession(guildId, userId, expiresAt);

  try {
    const persisted = await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return persisted ? 'persisted' : 'memory-only';
  } catch (error) {
    logger.warn('[BOT] Failed to persist login session guild=%s user=%s: %s', guildId, userId, getErrorMessage(error));
    return 'memory-only';
  }
};

const maybeRefreshLoginSession = async (guildId: string, userId: string, expiresAt: number): Promise<void> => {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs > LOGIN_SESSION_REFRESH_WINDOW_MS) {
    return;
  }

  const newExpiry = Date.now() + LOGIN_SESSION_TTL_MS;
  cacheLoginSession(guildId, userId, newExpiry);

  try {
    await upsertDiscordLoginSession({
      guildId,
      userId,
      expiresAt: new Date(newExpiry).toISOString(),
    });
  } catch (error) {
    logger.warn('[BOT] Failed to refresh login session guild=%s user=%s: %s', guildId, userId, getErrorMessage(error));
  }
};

const hasValidLoginSession = async (guildId: string, userId: string): Promise<boolean> => {
  const guildUsers = loggedInUsersByGuild.get(guildId);
  if (!guildUsers) {
    try {
      const persistedExpiry = await getDiscordLoginSessionExpiryMs({ guildId, userId });
      if (!persistedExpiry) {
        return false;
      }

      cacheLoginSession(guildId, userId, persistedExpiry);
      await maybeRefreshLoginSession(guildId, userId, persistedExpiry);
      return true;
    } catch (error) {
      logger.warn('[BOT] Failed to load login session guild=%s user=%s: %s', guildId, userId, getErrorMessage(error));
      return false;
    }
  }

  const expiresAt = guildUsers.get(userId);
  if (!expiresAt) {
    try {
      const persistedExpiry = await getDiscordLoginSessionExpiryMs({ guildId, userId });
      if (!persistedExpiry) {
        return false;
      }

      cacheLoginSession(guildId, userId, persistedExpiry);
      await maybeRefreshLoginSession(guildId, userId, persistedExpiry);
      return true;
    } catch (error) {
      logger.warn('[BOT] Failed to load login session guild=%s user=%s: %s', guildId, userId, getErrorMessage(error));
      return false;
    }
  }

  if (Date.now() > expiresAt) {
    uncacheLoginSession(guildId, userId);
    return false;
  }

  await maybeRefreshLoginSession(guildId, userId, expiresAt);

  return true;
};

const startLoginSessionCleanupLoop = () => {
  if (loginSessionCleanupTimer) {
    return;
  }

  const runCleanup = async () => {
    try {
      const deleted = await purgeExpiredDiscordLoginSessions();
      if (deleted > 0) {
        logger.info('[BOT] Login session cleanup removed %d expired row(s)', deleted);
      }
    } catch (error) {
      logger.warn('[BOT] Login session cleanup failed: %s', getErrorMessage(error));
    }
  };

  void runCleanup();
  loginSessionCleanupTimer = setInterval(() => {
    void runCleanup();
  }, LOGIN_SESSION_CLEANUP_INTERVAL_MS);

  if (typeof loginSessionCleanupTimer.unref === 'function') {
    loginSessionCleanupTimer.unref();
  }
};

const hasFeatureAccess = async (interaction: ChatInputCommandInteraction): Promise<boolean> => {
  if (await hasAdminPermission(interaction)) {
    return true;
  }

  if (!interaction.guildId) {
    return false;
  }

  return hasValidLoginSession(interaction.guildId, interaction.user.id);
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
        if (targetGuildIdForFastSync && guild.id === targetGuildIdForFastSync) {
          continue;
        }
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
    '',
    '[자동화 상태]',
    `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
    '',
    '[사용량]',
    usage,
    guildUsage,
  ].filter(Boolean) as string[];
};

const handleStatusCommand = async (interaction: ChatInputCommandInteraction) => {
  const lines = await getRuntimeStatusLines(interaction.guildId);

  await interaction.reply({
    ...buildSimpleEmbed('런타임 상태', lines.join('\n'), EMBED_INFO),
    ephemeral: true,
  });
};

const handleHelpCommand = async (interaction: ChatInputCommandInteraction) => {
  const simpleUserLines = [
    '`/구독` 영상/게시글/뉴스 구독 통합 관리',
    '`/로그인` 내 계정 권한/사용 가능 상태 진단',
    '`/설정` 현재 사용 모드/설정 확인',
    '`/ping` 상태 확인',
    '`@봇이름 고양이 영상 찾아줘`처럼 멘션으로 자연어 요청',
    '봇 답변에 답글로 이어서 대화 가능',
  ];

  const advancedAdminLines = [
    '`/시작` 세션 시작(호환 명령)',
    '`/상태` 운영/세션 상태 조회 (`종류`: 전체|운영|세션)',
    '`/스킬목록` 사용 가능한 스킬셋 조회',
    '`/정책` 실행 한도/가드레일 확인',
    '`/온보딩` 현재 길드 온보딩 분석 실행',
    '`/학습` 현재 길드 일일 학습/회고 실행',
    '`/중지` 실행 중 세션 중지 요청',
  ];

  await interaction.reply({
    embeds: [
      {
        title: 'Muel 명령어 안내',
        color: 0x2f80ed,
        description: SIMPLE_COMMANDS_ENABLED
          ? '보이는 명령어를 최소화했습니다. 구독/설정/ping + 자연어 대화로 사용하세요.'
          : '자주 쓰는 핵심 명령만 빠르게 확인하세요.',
        fields: [
          {
            name: SIMPLE_COMMANDS_ENABLED ? '권장 명령' : '일반 명령',
            value: SIMPLE_COMMANDS_ENABLED
              ? simpleUserLines.join('\n')
              : [
                '`/구독` 영상/게시글/뉴스 구독 통합 관리',
                '`/로그인` 내 계정 권한/사용 가능 상태 진단',
                '`/설정` 현재 사용 모드/설정 확인',
                '`/ping` 상태 확인',
                '`/주가` 현재 주가 조회 (`응답방식` 선택 가능)',
                '`/차트` 30일 차트 조회 (`응답방식` 선택 가능)',
                '`/분석` 기업 분석 (`응답방식` 선택 가능)',
              ].join('\n'),
          },
          {
            name: SIMPLE_COMMANDS_ENABLED ? '고급 모드 안내' : '관리자 명령',
            value: SIMPLE_COMMANDS_ENABLED
              ? '고급 명령이 필요하면 `DISCORD_SIMPLE_COMMANDS_ENABLED=false` 로 전환하세요.'
              : advancedAdminLines.join('\n'),
          },
          {
            name: '관리자 기준',
            value: 'Discord 서버 `Administrator` 권한이 있거나, 시스템 admin allowlist에 등록된 사용자입니다.',
          },
        ],
      },
    ],
    ephemeral: true,
  });
};

const handleSettingsCommand = async (interaction: ChatInputCommandInteraction) => {
  const category = (interaction.options.getString('항목') || 'mode').trim();
  const lines: string[] = [];

  if (category === 'mode') {
    lines.push(`SIMPLE_COMMANDS_ENABLED=${String(SIMPLE_COMMANDS_ENABLED)}`);
    lines.push('현재 권장 UX: /구독, /도움말, /설정, /ping + 자연어 대화');
    lines.push(`LOGIN_SESSION_TTL_MS=${LOGIN_SESSION_TTL_MS}`);
    lines.push(`LOGIN_SESSION_REFRESH_WINDOW_MS=${LOGIN_SESSION_REFRESH_WINDOW_MS}`);
  } else if (category === 'commands') {
    lines.push('보이는 명령어: /구독, /도움말, /설정, /ping');
    lines.push('자연어 상호작용: 멘션 또는 답글로 요청');
    lines.push(`LEGACY_SUBSCRIBE_COMMAND_ENABLED=${String(LEGACY_SUBSCRIBE_COMMAND_ENABLED)}`);
    lines.push(`LEGACY_SESSION_COMMANDS_ENABLED=${String(LEGACY_SESSION_COMMANDS_ENABLED)}`);
  } else if (category === 'automation') {
    lines.push('자동화는 내부 세션/스케줄러로 동작합니다.');
    lines.push('구독 관련 자동화는 /구독 명령 하나에서 통합 관리합니다.');
    lines.push(`LOGIN_SESSION_CLEANUP_INTERVAL_MS=${LOGIN_SESSION_CLEANUP_INTERVAL_MS}`);
  }

  await interaction.reply({
    ...buildSimpleEmbed('설정', lines.join('\n'), EMBED_INFO),
    ephemeral: true,
  });
};

const handleLoginCommand = async (interaction: ChatInputCommandInteraction) => {
  const checks: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  const inGuild = Boolean(interaction.guildId);
  checks.push(`서버 채널 사용: ${inGuild ? 'OK' : 'FAIL'}`);
  if (!inGuild) {
    blockers.push('서버 채널에서 다시 시도해주세요.');
  }

  const admin = await hasAdminPermission(interaction);
  checks.push(`관리자 권한: ${admin ? 'OK' : 'LIMITED'}`);

  checks.push(`LLM 설정: ${isAnyLlmConfigured() ? 'OK' : 'MISSING'}`);
  if (!isAnyLlmConfigured()) {
    warnings.push('자연어 자동화 기능은 LLM 키 설정이 필요합니다.');
  }

  checks.push(`주가 기능 키: ${isStockFeatureEnabled() ? 'OK' : 'MISSING'}`);
  checks.push(`Supabase 연결: ${isSupabaseConfigured() ? 'OK' : 'LIMITED'}`);
  checks.push(`명령 최소화 모드: ${SIMPLE_COMMANDS_ENABLED ? 'ON' : 'OFF'}`);

  if (inGuild && blockers.length === 0 && interaction.guildId) {
    const mode = await markUserLoggedIn(interaction.guildId, interaction.user.id);
    checks.push('사용자 로그인 세션: ACTIVE');
    checks.push(`세션 영속화: ${mode === 'persisted' ? 'OK' : 'MEMORY_ONLY'}`);
    checks.push(`세션 만료 정책: ttl=${LOGIN_SESSION_TTL_MS}ms, sliding=${LOGIN_SESSION_REFRESH_WINDOW_MS}ms`);
    if (mode !== 'persisted') {
      warnings.push('Supabase 미설정 또는 저장 실패로 재시작 후 로그인 유지가 제한될 수 있습니다.');
    }
  }

  const title = blockers.length === 0 ? '로그인/권한 진단: 정상' : '로그인/권한 진단: 점검 필요';
  const summary = blockers.length === 0
    ? '로그인 세션이 활성화되었습니다. 이제 주요 기능 사용이 가능합니다.'
    : blockers.slice(0, 4).join('\n');

  await interaction.reply({
    ...buildSimpleEmbed(
      title,
      [
        '[진단 결과]',
        ...checks,
        '',
        '[안내]',
        blockers.length === 0
          ? '이제 /구독 추가/해제와 자연어 요청을 사용할 수 있습니다. 문제가 지속되면 /도움말 확인 후 다시 시도하세요.'
          : summary,
        warnings.length > 0 ? '[제한 사항]' : '',
        ...(warnings.length > 0 ? warnings : []),
      ].join('\n'),
      blockers.length === 0 ? EMBED_SUCCESS : EMBED_WARN,
    ),
    ephemeral: true,
  });
};

const handleAdminSyncCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ ...buildSimpleEmbed('권한 오류', 'Admin permission is required.', EMBED_ERROR), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await forceRegisterSlashCommands();
  await interaction.editReply(buildSimpleEmbed('동기화 요청 완료', '슬래시 명령 재등록을 요청했습니다. 10~60초 후 다시 확인하세요.', EMBED_SUCCESS));
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

const handleAutomationRunCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
    return;
  }

  const jobName = interaction.options.getString('job', true);
  if (jobName !== 'youtube-monitor' && jobName !== 'news-monitor') {
    await interaction.reply({ ...buildAdminCard('입력 오류', 'Invalid job name.', ['허용 값: youtube-monitor, news-monitor'], EMBED_WARN), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await triggerAutomationJob(jobName, { guildId: interaction.guildId || undefined });
  await interaction.editReply(buildAdminCard(
    result.ok ? '자동화 실행 수락' : '자동화 실행 실패',
    result.message,
    [`job=${jobName}`, `guild=${interaction.guildId || 'unknown'}`],
    result.ok ? EMBED_SUCCESS : EMBED_ERROR,
  ));
};

const handleReconnectCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ ...buildSimpleEmbed('권한 오류', 'Admin permission is required.', EMBED_ERROR), ephemeral: true });
    return;
  }

  const remaining = getManualReconnectCooldownRemainingSec();
  if (remaining > 0) {
    await interaction.reply({
      ...buildSimpleEmbed('재연결 대기', `Reconnect is on cooldown. Try again in ${remaining}s.`, EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  if (!activeToken) {
    await interaction.reply({ ...buildSimpleEmbed('재연결 실패', 'DISCORD token is not loaded.', EMBED_ERROR), ephemeral: true });
    return;
  }

  await interaction.reply({
    ...buildSimpleEmbed('재연결 요청', 'Reconnect requested. Restarting Discord client...', EMBED_INFO),
    ephemeral: true,
  });

  setTimeout(() => {
    void runManualReconnect(`slash-command:${interaction.user.id}`);
  }, 300);
};

const handleStockPriceCommand = async (interaction: ChatInputCommandInteraction) => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply(buildSimpleEmbed('주가 조회 불가', 'ALPHA_VANTAGE_KEY가 없어 주가 기능을 사용할 수 없습니다.', EMBED_WARN));
    return;
  }

  const quote = await fetchStockQuote(symbol);
  if (!quote) {
    await interaction.editReply(buildSimpleEmbed('주가 조회 실패', symbol, EMBED_ERROR));
    return;
  }

  await interaction.editReply({
    embeds: [
      {
        title: `📈 ${quote.symbol} 주가`,
        color: EMBED_SUCCESS,
        description: [
          `현재 가격: ${quote.price}`,
          `오늘 최고: ${quote.high}`,
          `오늘 최저: ${quote.low}`,
          `오늘 시가: ${quote.open}`,
          `전일 종가: ${quote.prevClose}`,
        ].join('\n'),
      },
    ],
  });
};

const handleStockChartCommand = async (interaction: ChatInputCommandInteraction) => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply(buildSimpleEmbed('차트 조회 불가', 'ALPHA_VANTAGE_KEY가 없어 차트 기능을 사용할 수 없습니다.', EMBED_WARN));
    return;
  }

  const imageUrl = await fetchStockChartImageUrl(symbol);
  if (!imageUrl) {
    await interaction.editReply(buildSimpleEmbed('차트 생성 실패', symbol, EMBED_ERROR));
    return;
  }

  await interaction.editReply({
    embeds: [
      {
        title: `${symbol} 주가 차트`,
        color: 0x2ecc71,
        image: { url: imageUrl },
      },
    ],
  });
};

const handleAnalyzeCommand = async (interaction: ChatInputCommandInteraction) => {
  const query = interaction.options.getString('query', true).trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  const answer = await generateInvestmentAnalysis(query);
  const title = isInvestmentAnalysisEnabled() ? '📊 AI 투자 분석' : '📊 투자 분석 (제한 모드)';
  await interaction.editReply({
    embeds: [
      {
        title,
        description: answer.slice(0, 3900),
        color: 0x3498db,
      },
    ],
  });
};

const handleChannelIdCommand = async (interaction: ChatInputCommandInteraction) => {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.reply({
    ...buildSimpleEmbed(
      '채널 정보',
      `channel_id=${channel.id}\nname=${channel.name}\ntype=${ChannelType[channel.type] ?? channel.type}`,
      EMBED_INFO,
    ),
    ephemeral: true,
  });
};

const handleForumIdCommand = async (interaction: ChatInputCommandInteraction) => {
  const forum = interaction.options.getChannel('forum', true);
  if (forum.type !== ChannelType.GuildForum) {
    await interaction.reply({
      ...buildSimpleEmbed('입력 오류', '선택한 채널이 포럼 채널이 아닙니다.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    ...buildSimpleEmbed('포럼 정보', `forum_id=${forum.id}\nname=${forum.name}`, EMBED_INFO),
    ephemeral: true,
  });
};

const formatSubscriptionLine = (row: YouTubeSubscription): string => {
  const kind = row.url.endsWith('#posts') ? 'posts' : row.url.endsWith('#videos') ? 'videos' : 'unknown';
  const channelId = row.url.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/)?.[1] || 'unknown';
  const discordTarget = row.channel_id ? `<#${row.channel_id}>` : '-';
  return `#${row.id} [${kind}] youtube=${channelId} -> discord=${discordTarget}`;
};

const getChannelTypeLabel = (channelType: number): string => {
  const mapped = ChannelType[channelType];
  return typeof mapped === 'string' ? mapped : String(channelType);
};

const resolveRowChannelMeta = async (
  interaction: ChatInputCommandInteraction,
  row: YouTubeSubscription,
): Promise<string> => {
  if (!interaction.guild || !row.channel_id) {
    return 'unknown';
  }

  try {
    const channel = await interaction.guild.channels.fetch(row.channel_id);
    if (!channel) {
      return 'missing';
    }
    return `${channel.name} (${getChannelTypeLabel(channel.type)})`;
  } catch {
    return 'missing';
  }
};

const handleSubscribeCommand = async (
  interaction: ChatInputCommandInteraction,
  kind: 'videos' | 'posts',
) => {
  if (!(await hasFeatureAccess(interaction))) {
    await interaction.reply({
      ...buildSimpleEmbed('권한 오류', '이 기능을 사용하려면 /로그인을 먼저 실행해주세요.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  const channelInput = (interaction.options.getString('유튜브채널') || '').trim();
  const targetChannel = interaction.options.getChannel('디스코드채널', true);

  if (!channelInput) {
    await interaction.reply({ ...buildSimpleEmbed('입력 오류', '영상/게시글 구독은 유튜브채널을 입력해주세요.', EMBED_WARN), ephemeral: true });
    return;
  }

  if (
    targetChannel.type !== ChannelType.GuildText
    && targetChannel.type !== ChannelType.GuildAnnouncement
    && targetChannel.type !== ChannelType.PublicThread
    && targetChannel.type !== ChannelType.PrivateThread
    && targetChannel.type !== ChannelType.AnnouncementThread
  ) {
    await interaction.reply({ ...buildSimpleEmbed('채널 유형 오류', '텍스트/공지/포럼 스레드 채널만 구독 대상으로 지정할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await createYouTubeSubscription({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      discordChannelId: targetChannel.id,
      channelInput,
      kind,
    });

    const state = result.created ? '등록 완료' : '이미 등록됨';
    await interaction.editReply(buildSimpleEmbed(
      '구독 처리 결과',
      `${state}: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`,
      EMBED_SUCCESS,
    ));
  } catch (error) {
    const message = getErrorMessage(error);
    await interaction.editReply(buildSimpleEmbed('구독 등록 실패', message, EMBED_ERROR));
  }
};

const handleSubscribeNewsCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasFeatureAccess(interaction))) {
    await interaction.reply({
      ...buildSimpleEmbed('권한 오류', '이 기능을 사용하려면 /로그인을 먼저 실행해주세요.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  const targetChannel = interaction.options.getChannel('디스코드채널', true);
  if (!ensureNewsChannelType(interaction, targetChannel.type)) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await createNewsChannelSubscription({
      userId: interaction.user.id,
      guildId: interaction.guildId,
      discordChannelId: targetChannel.id,
    });

    const state = result.created ? '등록 완료' : '이미 등록됨';
    await interaction.editReply(buildSimpleEmbed('뉴스 구독', `${state}: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`, EMBED_SUCCESS));
  } catch (error) {
    await interaction.editReply(buildSimpleEmbed('뉴스 구독 실패', getErrorMessage(error), EMBED_ERROR));
  }
};

const handleSubscriptionListCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const [ytRows, newsRows] = await Promise.all([
      listYouTubeSubscriptions({ guildId: interaction.guildId }),
      listNewsChannelSubscriptions({ guildId: interaction.guildId }),
    ]);

    if (ytRows.length === 0 && newsRows.length === 0) {
      await interaction.editReply(buildSimpleEmbed('구독 목록', '등록된 구독이 없습니다.', EMBED_INFO));
      return;
    }

    const previewYtRows = ytRows.slice(0, 20);
    const ytLines = await Promise.all(
      previewYtRows.map(async (row) => {
        const line = formatSubscriptionLine(row);
        const channelMeta = await resolveRowChannelMeta(interaction, row);
        return `${line} | channel=${channelMeta}`;
      }),
    );
    const ytSuffix = ytRows.length > 20 ? `\n...(${ytRows.length - 20} more)` : '';
    const newsLines = newsRows.slice(0, 20).map((row) => {
      const target = row.channel_id ? `<#${row.channel_id}>` : '-';
      return `#${row.id} [news] -> ${target}`;
    });
    const newsSuffix = newsRows.length > 20 ? `\n...(${newsRows.length - 20} more)` : '';

    await interaction.editReply(buildSimpleEmbed(
      '통합 구독 목록',
      [
        `[YouTube] ${ytRows.length}개`,
        ...(ytLines.length > 0 ? ytLines : ['- 없음']),
        ytSuffix,
        '',
        `[News] ${newsRows.length}개`,
        ...(newsLines.length > 0 ? newsLines : ['- 없음']),
        newsSuffix,
      ].filter(Boolean).join('\n'),
      EMBED_INFO,
    ));
  } catch (error) {
    const message = getErrorMessage(error);
    await interaction.editReply(buildSimpleEmbed('구독 목록 조회 실패', message, EMBED_ERROR));
  }
};

const handleUnsubscribeCommand = async (
  interaction: ChatInputCommandInteraction,
  forcedKind?: 'videos' | 'posts' | 'news',
) => {
  if (!(await hasFeatureAccess(interaction))) {
    await interaction.reply({
      ...buildSimpleEmbed('권한 오류', '이 기능을 사용하려면 /로그인을 먼저 실행해주세요.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  const kind = (forcedKind || interaction.options.getString('종류') || '').trim();
  if (kind !== 'videos' && kind !== 'posts' && kind !== 'news') {
    await interaction.reply({ ...buildSimpleEmbed('입력 오류', '종류는 videos, posts, news만 가능합니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  const channelInput = (interaction.options.getString('유튜브채널') || '').trim();
  const targetChannel = interaction.options.getChannel('디스코드채널');
  if (!targetChannel) {
    await interaction.reply({ ...buildSimpleEmbed('입력 오류', '해제 동작에는 디스코드채널이 필요합니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  if (
    targetChannel.type !== ChannelType.GuildText
    && targetChannel.type !== ChannelType.GuildAnnouncement
    && targetChannel.type !== ChannelType.PublicThread
    && targetChannel.type !== ChannelType.PrivateThread
    && targetChannel.type !== ChannelType.AnnouncementThread
  ) {
    await interaction.reply({ ...buildSimpleEmbed('채널 유형 오류', '텍스트/공지/포럼 스레드 채널만 해제 대상으로 지정할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (kind === 'news') {
      const result = await deleteNewsChannelSubscription({
        guildId: interaction.guildId,
        discordChannelId: targetChannel.id,
      });

      if (!result.deleted) {
        await interaction.editReply(buildSimpleEmbed('구독 해제', `해제 대상이 없습니다: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`, EMBED_WARN));
        return;
      }

      await interaction.editReply(buildSimpleEmbed('구독 해제 완료', `해제 완료: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`, EMBED_SUCCESS));
      return;
    }

    if (!channelInput) {
      await interaction.editReply(buildSimpleEmbed('입력 오류', '영상/게시글 해제 시 유튜브채널을 입력해주세요.', EMBED_WARN));
      return;
    }

    const result = await deleteYouTubeSubscription({
      guildId: interaction.guildId,
      discordChannelId: targetChannel.id,
      channelInput,
      kind,
    });

    if (!result.deleted) {
      await interaction.editReply(buildSimpleEmbed('구독 해제', `해제 대상이 없습니다: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`, EMBED_WARN));
      return;
    }

    await interaction.editReply(buildSimpleEmbed('구독 해제 완료', `해제 완료: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`, EMBED_SUCCESS));
  } catch (error) {
    const message = getErrorMessage(error);
    await interaction.editReply(buildSimpleEmbed('구독 해제 실패', message, EMBED_ERROR));
  }
};

const handleGroupedSubscribeCommand = async (interaction: ChatInputCommandInteraction) => {
  const explicitAction = (interaction.options.getString('동작') || '').trim();
  const explicitKind = (interaction.options.getString('종류') || '').trim();
  const channelInput = (interaction.options.getString('유튜브채널') || '').trim();
  const hasTargetChannel = Boolean(interaction.options.getChannel('디스코드채널'));

  let legacySub: string | null = null;
  try {
    legacySub = interaction.options.getSubcommand(false);
  } catch {
    legacySub = null;
  }

  const action = explicitAction
    || (legacySub === '목록' ? 'list' : legacySub === '해제' ? 'remove' : (legacySub && legacySub !== '구독') ? 'add' : hasTargetChannel || channelInput ? 'add' : 'list');

  const kind = explicitKind
    || (legacySub === '영상' ? 'videos' : legacySub === '게시글' ? 'posts' : legacySub === '뉴스' ? 'news' : '')
    || (channelInput ? 'videos' : hasTargetChannel ? 'news' : '');

  if (action === 'list') {
    await handleSubscriptionListCommand(interaction);
    return;
  }

  if (action === 'add') {
    if (kind === 'news') {
      await handleSubscribeNewsCommand(interaction);
      return;
    }

    if (kind === 'videos' || kind === 'posts') {
      await handleSubscribeCommand(interaction, kind);
      return;
    }

    await interaction.reply({ ...buildSimpleEmbed('입력 오류', '추가 동작에는 종류(영상/게시글/뉴스)가 필요합니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  if (action === 'remove') {
    const removeKind = (kind === 'videos' || kind === 'posts' || kind === 'news')
      ? kind
      : (channelInput ? 'videos' : 'news');
    await handleUnsubscribeCommand(interaction, removeKind);
    return;
  }

  await interaction.reply({ ...buildSimpleEmbed('입력 오류', '동작은 추가/해제/목록 중 하나여야 합니다.', EMBED_WARN), ephemeral: true });
};

const ensureNewsChannelType = (interaction: ChatInputCommandInteraction, channelType: number): boolean => {
  if (
    channelType !== ChannelType.GuildText
    && channelType !== ChannelType.GuildAnnouncement
    && channelType !== ChannelType.PublicThread
    && channelType !== ChannelType.PrivateThread
    && channelType !== ChannelType.AnnouncementThread
  ) {
    void interaction.reply({ ...buildSimpleEmbed('채널 유형 오류', '텍스트/공지/포럼 스레드 채널만 등록할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return false;
  }
  return true;
};

const handleAdminCommand = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case '상태': {
      await handleStatusCommand(interaction);
      return;
    }
    case '자동화실행':
    case '즉시전송': {
      await handleAutomationRunCommand(interaction);
      return;
    }
    case '재연결': {
      await handleReconnectCommand(interaction);
      return;
    }
    case '채널아이디': {
      await handleChannelIdCommand(interaction);
      return;
    }
    case '포럼아이디': {
      await handleForumIdCommand(interaction);
      return;
    }
    case '동기화': {
      await handleAdminSyncCommand(interaction);
      return;
    }
    default: {
      await interaction.reply({ ...buildSimpleEmbed('명령 오류', '지원되지 않는 관리자 서브명령입니다.', EMBED_WARN), ephemeral: true });
    }
  }
};

const formatAgentSessionLine = (session: AgentSession) => {
  const safeGoal = String(session.goal || '').replace(/\s+/g, ' ').slice(0, 48);
  return `${session.id} | ${session.status} | priority=${session.priority} | ${session.updatedAt} | ${safeGoal}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildSessionProgressText = (session: AgentSession, goal: string) => {
  const steps = session.steps;
  const completed = steps.filter((step) => step.status === 'completed').length;
  const running = steps.find((step) => step.status === 'running');
  const pending = steps.filter((step) => step.status === 'pending').length;

  if (session.status === 'queued') {
    return [
      '작업을 준비 중입니다...',
      `목표: ${goal}`,
      `우선순위: ${session.priority}`,
      `진행: completed=${completed}, pending=${pending}`,
    ].join('\n');
  }

  if (session.status === 'running') {
    return [
      '이러한 작업을 진행 중입니다...',
      `목표: ${goal}`,
      `우선순위: ${session.priority}`,
      `현재 단계: ${running ? `${running.role} - ${running.title}` : '다음 단계를 준비 중'}`,
      `진행: completed=${completed}/${steps.length}`,
    ].join('\n');
  }

  if (session.status === 'cancelled') {
    return [
      '작업이 중지되었습니다.',
      `목표: ${goal}`,
      session.error ? `사유: ${session.error}` : '',
    ].filter(Boolean).join('\n');
  }

  if (session.status === 'failed') {
    return [
      '작업이 실패했습니다.',
      `목표: ${goal}`,
      `오류: ${session.error || 'unknown'}`,
    ].join('\n');
  }

  const result = String(session.result || '').trim();
  const clipped = result.length > 1700 ? `${result.slice(0, 1700)}\n...` : result;
  return [
    '작업이 완료되었습니다.',
    `목표: ${goal}`,
    clipped ? `결과:\n${clipped}` : '결과가 비어 있습니다.',
  ].join('\n\n');
};

type ProgressSink = {
  update: (content: string) => Promise<unknown>;
};

const streamSessionProgress = async (sink: ProgressSink, sessionId: string, goal: string) => {
  const startedAt = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  const intervalMs = 2200;
  let previous = '';

  while (Date.now() - startedAt < timeoutMs) {
    const session = getAgentSession(sessionId);
    if (!session) {
      await sink.update('세션 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    const text = buildSessionProgressText(session, goal);
    if (text !== previous) {
      await sink.update(text);
      previous = text;
    }

    if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
      return;
    }

    await sleep(intervalMs);
  }

  await sink.update([
    '작업은 계속 진행 중입니다.',
    `세션: ${sessionId}`,
    '진행 상황은 /상태 세션아이디:<ID> 로 확인할 수 있습니다.',
  ].join('\n'));
};

const startVibeSession = (guildId: string, userId: string, request: string): AgentSession => {
  return startAgentSession({
    guildId,
    requestedBy: userId,
    goal: request,
    priority: 'fast',
  });
};

const inferSessionSkill = (text: string): 'ops-plan' | 'ops-execution' | 'ops-critique' | 'guild-onboarding-blueprint' | 'incident-review' | 'webhook' => {
  const normalized = String(text || '').toLowerCase();

  if (/web\s*hook|webhook|웹훅/.test(normalized)) {
    return 'webhook';
  }
  if (/onboard|온보딩|신규 서버|초기 설정/.test(normalized)) {
    return 'guild-onboarding-blueprint';
  }
  if (/incident|장애|사고|회고|재발/.test(normalized)) {
    return 'incident-review';
  }
  if (/critique|검토|리스크|위험|보완/.test(normalized)) {
    return 'ops-critique';
  }
  if (/plan|계획|로드맵|단계/.test(normalized)) {
    return 'ops-plan';
  }

  return 'ops-execution';
};

const handleVibeCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId) {
    await interaction.reply({ ...buildUserCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
    return;
  }

  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  const request = (interaction.options.getString('요청', true) || '').trim();
  if (!request) {
    await interaction.editReply(buildUserCard('입력 오류', '요청을 입력해주세요. 예: 고양이 영상 찾아줘', EMBED_WARN));
    return;
  }

  let session: AgentSession;
  try {
    session = startVibeSession(interaction.guildId, interaction.user.id, request);
  } catch (error) {
    await interaction.editReply(buildUserCard('작업 시작 실패', getErrorMessage(error), EMBED_ERROR));
    return;
  }

  await interaction.editReply(buildUserCard(
    '요청 수락',
    [
      '요청을 이해했어요. 바로 진행할게요.',
      `세션: ${session.id}`,
      `요청: ${request}`,
      '진행 상황을 실시간으로 보여드릴게요...',
    ].join('\n'),
    EMBED_INFO,
  ));

  await streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard('진행 상태', content, EMBED_INFO)) }, session.id, request);
};

const handleSessionCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ ...buildAdminCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', [], EMBED_WARN), ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === '추가') {
    const shared = getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const skill = (interaction.options.getString('스킬') || '').trim();
    const request = (interaction.options.getString('요청') || '').trim();
    const description = (interaction.options.getString('설명') || '').trim();
    const combinedText = [request, description].filter(Boolean).join('\n').trim();
    const selectedSkill = skill || inferSessionSkill(combinedText);
    const mappedSkillId = selectedSkill === 'webhook' ? 'ops-execution' : selectedSkill;
    const skillLabel = selectedSkill === 'webhook' ? 'webhook(ops-execution 매핑)' : selectedSkill;
    const baseRequest = request || '현재 길드 기준 자동화 실행안을 제안하고 즉시 적용 순서를 정리해줘.';
    const goal = [
      `세션 스킬 실행: ${skillLabel}`,
      `요청: ${baseRequest}`,
      description ? `설명: ${description}` : '설명: 없음',
      selectedSkill === 'webhook' ? '요청: 웹훅 자동화 관점으로 실행안을 작성' : '',
    ].filter(Boolean).join('\n');

    let session: AgentSession;
    try {
      session = startAgentSession({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        goal,
        skillId: mappedSkillId,
        priority: 'balanced',
      });
    } catch (error) {
      await interaction.editReply(buildAdminCard('세션 추가 실패', getErrorMessage(error), [`skill=${skill}`], EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildAdminCard(
      '세션 추가 완료',
      `세션 ${session.id} 실행을 시작했습니다.`,
      [
        `skill=${skillLabel}`,
        `session=${session.id}`,
        `requestedBy=${interaction.user.id}`,
      ],
      EMBED_SUCCESS,
    ));

    await streamSessionProgress({ update: (content) => interaction.editReply(buildAdminCard('세션 진행 상태', content, [`session=${session.id}`], EMBED_INFO)) }, session.id, session.goal);
    return;
  }

  if (sub === '조회') {
    await interaction.deferReply({ ephemeral: true });
    const sessionId = (interaction.options.getString('세션아이디') || '').trim();

    if (sessionId) {
      const session = getAgentSession(sessionId);
      if (!session || session.guildId !== interaction.guildId) {
        await interaction.editReply(buildAdminCard('세션 조회 실패', '해당 세션을 찾을 수 없습니다.', [`session=${sessionId}`], EMBED_WARN));
        return;
      }

      await interaction.editReply(buildAdminCard(
        '세션 조회',
        `상태: ${session.status}`,
        [
          `session=${session.id}`,
          `priority=${session.priority}`,
          `goal=${session.goal.slice(0, 240)}`,
          session.error ? `error=${session.error.slice(0, 180)}` : 'error=none',
        ],
        EMBED_INFO,
      ));
      return;
    }

    const sessions = listGuildAgentSessions(interaction.guildId, 10);
    if (sessions.length === 0) {
      await interaction.editReply(buildAdminCard('세션 조회', '최근 세션이 없습니다.', [`guild=${interaction.guildId}`], EMBED_INFO));
      return;
    }

    await interaction.editReply(buildAdminCard(
      '최근 세션 조회',
      `총 ${sessions.length}개`,
      sessions.map((session) => `${session.id} | ${session.status} | ${session.updatedAt}`),
      EMBED_INFO,
    ));
    return;
  }

  if (sub === '구독') {
    await handleGroupedSubscribeCommand(interaction);
    return;
  }

  if (sub === '제거') {
    await interaction.deferReply({ ephemeral: true });
    const sessionId = interaction.options.getString('세션아이디', true).trim();
    const session = getAgentSession(sessionId);
    if (!session || session.guildId !== interaction.guildId) {
      await interaction.editReply(buildAdminCard('세션 제거 실패', '해당 세션을 찾을 수 없습니다.', [`session=${sessionId}`], EMBED_WARN));
      return;
    }

    const result = cancelAgentSession(sessionId);
    await interaction.editReply(buildAdminCard(
      result.ok ? '세션 제거 요청 수락' : '세션 제거 실패',
      result.ok ? '중지 요청을 전달했습니다.' : result.message,
      [`session=${sessionId}`],
      result.ok ? EMBED_SUCCESS : EMBED_ERROR,
    ));
    return;
  }

  await interaction.reply({ ...buildAdminCard('명령 오류', '지원되지 않는 세션 서브명령입니다.', [], EMBED_WARN), ephemeral: true });
};

const parseVibeRequestFromMessage = (message: Message): string => {
  let text = String(message.content || '').trim();
  if (!text) {
    return '';
  }

  if (client.user) {
    const mentionPattern = new RegExp(`^<@!?${client.user.id}>\\s*`, 'i');
    text = text.replace(mentionPattern, '').trim();
  }

  if (text.startsWith('해줘')) {
    text = text.slice('해줘'.length).trim();
  }

  if (text.startsWith(':')) {
    text = text.slice(1).trim();
  }

  return text;
};

const handleVibeMessage = async (message: Message) => {
  if (!message.guildId || message.author.bot || !client.user) {
    return;
  }

  const raw = String(message.content || '').trim();
  const isMentioned = message.mentions.has(client.user.id);
  const isReplyToBot = message.reference?.messageId && message.mentions.repliedUser?.id === client.user.id;
  const isPrefixed = raw.toLowerCase().startsWith('해줘');
  if (!isMentioned && !isReplyToBot && !isPrefixed) {
    return;
  }

  const request = parseVibeRequestFromMessage(message);
  if (!request) {
    await message.reply('원하는 작업을 함께 적어주세요. 예: `@봇이름 고양이 영상 찾아줘`');
    return;
  }

  const progressMessage = await message.reply([
    '요청을 이해했어요. 바로 진행할게요.',
    `요청: ${request}`,
    '진행 상황을 실시간으로 보여드릴게요...',
  ].join('\n'));

  let session: AgentSession;
  try {
    session = startVibeSession(message.guildId, message.author.id, request);
  } catch (error) {
    await progressMessage.edit(`작업 시작 실패: ${getErrorMessage(error)}`);
    return;
  }

  await progressMessage.edit([
    '요청을 이해했어요. 바로 진행할게요.',
    `세션: ${session.id}`,
    `요청: ${request}`,
    '진행 상황을 실시간으로 보여드릴게요...',
  ].join('\n'));

  await streamSessionProgress({ update: (content) => progressMessage.edit(content) }, session.id, request);
};

const handleAgentCommand = async (interaction: ChatInputCommandInteraction, forcedSub?: string) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ ...buildAdminCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', [], EMBED_WARN), ephemeral: true });
    return;
  }

  const sub = forcedSub || interaction.options.getSubcommand();

  if (sub === '실행' || sub === '시작') {
    const shared = getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const goal = interaction.options.getString('목표', true).trim();
    const skillId = (interaction.options.getString('스킬') || '').trim();
    const priority = (interaction.options.getString('우선순위') || 'balanced').trim();
    if (!goal) {
      await interaction.editReply(buildAdminCard('입력 오류', '목표를 입력해주세요.', ['파라미터: 목표'], EMBED_WARN));
      return;
    }

    let session: AgentSession;
    try {
      session = startAgentSession({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        goal,
        skillId: skillId || null,
        priority,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      await interaction.editReply(buildAdminCard('세션 시작 실패', message, [`guild=${interaction.guildId}`], EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildAdminCard(
      '요청 수락',
      [
        '요청을 수락했습니다.',
        `세션: ${session.id}`,
        `목표: ${session.goal}`,
        `우선순위: ${session.priority}`,
        '진행 상황을 실시간으로 표시합니다...',
      ].join('\n'),
      [
        `session=${session.id}`,
        `requestedBy=${interaction.user.id}`,
      ],
      EMBED_INFO,
    ));

    await streamSessionProgress({ update: (content) => interaction.editReply(buildAdminCard('진행 상태', content, [`session=${session.id}`], EMBED_INFO)) }, session.id, session.goal);
    return;
  }

  if (sub === '온보딩') {
    await interaction.deferReply({ ephemeral: true });
    const result = triggerGuildOnboardingSession({
      guildId: interaction.guildId,
      guildName: interaction.guild?.name,
      requestedBy: interaction.user.id,
      reason: 'slash-command-onboarding',
    });
    await interaction.editReply(buildSimpleEmbed(
      result.ok ? '온보딩 세션 시작' : '온보딩 실행 안됨',
      result.ok ? `세션: ${result.sessionId}` : result.message,
      result.ok ? EMBED_SUCCESS : EMBED_WARN,
    ));
    return;
  }

  if (sub === '학습') {
    await interaction.deferReply({ ephemeral: true });
    const customGoal = (interaction.options.getString('목표') || '').trim();
    if (customGoal) {
      try {
        const session = startAgentSession({
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
          goal: customGoal,
          skillId: 'incident-review',
          priority: 'balanced',
        });
        await interaction.editReply(buildSimpleEmbed('학습 세션 시작', `세션: ${session.id}`, EMBED_SUCCESS));
      } catch (error) {
        await interaction.editReply(buildSimpleEmbed('학습 실행 실패', getErrorMessage(error), EMBED_ERROR));
      }
      return;
    }

    const result = triggerDailyLearningRun(client, interaction.guildId);
    await interaction.editReply(buildSimpleEmbed(
      result.ok ? '학습 실행 결과' : '학습 실행 실패',
      result.message,
      result.ok ? EMBED_SUCCESS : EMBED_ERROR,
    ));
    return;
  }

  if (sub === '스킬목록') {
    await interaction.deferReply({ ephemeral: true });
    const skills = listAgentSkills();
    const lines = skills.map((skill) => `${skill.id} | ${skill.title} | ${skill.description}`);
    await interaction.editReply(buildSimpleEmbed('스킬 목록', `사용 가능한 스킬 ${skills.length}개\n${lines.join('\n')}`, EMBED_INFO));
    return;
  }

  if (sub === '정책') {
    await interaction.deferReply({ ephemeral: true });
    const policy = getAgentPolicy();
    const ops = getAgentOpsSnapshot();
    await interaction.editReply(buildAdminCard('정책 상태', [
      `동시 세션 한도: ${policy.maxConcurrentSessions}`,
      `목표 최대 길이: ${policy.maxGoalLength}`,
      `제한 스킬: ${policy.restrictedSkills.join(', ') || '없음'}`,
      `자동 온보딩: ${String(ops.autoOnboardingEnabled)}`,
      `일일 학습 루프: ${String(ops.dailyLearningEnabled)} (hour=${ops.dailyLearningHour})`,
    ].join('\n'), [`guild=${interaction.guildId}`], EMBED_INFO));
    return;
  }

  if (sub === '상태') {
    await interaction.deferReply({ ephemeral: true });
    const statusType = (interaction.options.getString('종류') || 'all').trim();
    const sessionId = (interaction.options.getString('세션아이디') || '').trim();

    const includeRuntime = statusType === 'all' || statusType === 'runtime';
    const includeSession = statusType === 'all' || statusType === 'session';

    if (!includeSession) {
      const runtimeLines = await getRuntimeStatusLines(interaction.guildId);
      await interaction.editReply(buildSimpleEmbed('상태', runtimeLines.join('\n'), EMBED_INFO));
      return;
    }

    if (sessionId) {
      const session = getAgentSession(sessionId);
      if (!session || session.guildId !== interaction.guildId) {
        await interaction.editReply(buildSimpleEmbed('조회 실패', '해당 세션을 찾을 수 없습니다.', EMBED_WARN));
        return;
      }

      const steps = session.steps
        .map((step, index) => `${index + 1}. ${step.role}(${step.status}) - ${step.title}`)
        .join('\n');
      const runtime = getMultiAgentRuntimeSnapshot();
      const runtimeLines = includeRuntime ? await getRuntimeStatusLines(interaction.guildId) : [];

      await interaction.editReply(buildSimpleEmbed('세션 상태', [
        ...runtimeLines,
        '[세션 상태]',
        `세션: ${session.id}`,
        `상태: ${session.status}`,
        `우선순위: ${session.priority}`,
        `생성: ${session.createdAt}`,
        `목표: ${session.goal}`,
        '',
        '[스텝]',
        `스텝:\n${steps}`,
        session.error ? `오류: ${session.error}` : '',
        '',
        '[결과]',
        session.result ? `결과 요약:\n${session.result.slice(0, 1200)}` : '결과: 아직 생성 중입니다.',
        '',
        '[런타임 요약]',
        `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`,
      ].filter(Boolean).join('\n\n'), EMBED_INFO));
      return;
    }

    const sessions = listGuildAgentSessions(interaction.guildId, 8);
    const runtime = getMultiAgentRuntimeSnapshot();
    const runtimeLines = includeRuntime ? await getRuntimeStatusLines(interaction.guildId) : [];
    if (sessions.length === 0) {
      await interaction.editReply(buildSimpleEmbed('세션 상태', [
        ...runtimeLines,
        '최근 에이전트 세션이 없습니다.',
        `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`,
      ].join('\n'), EMBED_INFO));
      return;
    }

    await interaction.editReply(buildSimpleEmbed('세션 상태', [
      ...runtimeLines,
      '[세션 상태: 최근 목록]',
      '최근 세션 목록:',
      sessions.map((session) => formatAgentSessionLine(session)).join('\n'),
      '',
      '[런타임 요약]',
      `런타임: running=${runtime.runningSessions}, completed=${runtime.completedSessions}, failed=${runtime.failedSessions}`,
      '상세 조회: /상태 세션아이디:<ID>',
    ].join('\n'), EMBED_INFO));
    return;
  }

  if (sub === '중지') {
    await interaction.deferReply({ ephemeral: true });
    const sessionId = interaction.options.getString('세션아이디', true).trim();
    const session = getAgentSession(sessionId);
    if (!session || session.guildId !== interaction.guildId) {
      await interaction.editReply(buildSimpleEmbed('중지 실패', '해당 세션을 찾을 수 없습니다.', EMBED_WARN));
      return;
    }

    const result = cancelAgentSession(sessionId);
    await interaction.editReply(buildSimpleEmbed(
      result.ok ? '중지 요청 수락' : '중지 실패',
      result.ok ? `세션: ${sessionId}` : result.message,
      result.ok ? EMBED_SUCCESS : EMBED_ERROR,
    ));
    return;
  }

  await interaction.reply({ ...buildSimpleEmbed('명령 오류', '지원되지 않는 명령입니다.', EMBED_WARN), ephemeral: true });
};

const attachCommandHandlers = () => {
  if (commandHandlersAttached) {
    return;
  }

  commandHandlersAttached = true;

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      switch (interaction.commandName) {
        case 'ping': {
          await interaction.reply({
            ...buildSimpleEmbed('Pong', `ws=${client.ws.status} latency=${client.ws.ping}ms`, EMBED_INFO),
            ephemeral: true,
          });
          return;
        }
        case '도움말': {
          await handleHelpCommand(interaction);
          return;
        }
        case '설정': {
          await handleSettingsCommand(interaction);
          return;
        }
        case '로그인': {
          await handleLoginCommand(interaction);
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
          await handleSessionCommand(interaction);
          return;
        }
        case '해줘': {
          await handleVibeCommand(interaction);
          return;
        }
        case '시작': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '시작');
          return;
        }
        case '상태': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '상태');
          return;
        }
        case '스킬목록': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '스킬목록');
          return;
        }
        case '정책': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '정책');
          return;
        }
        case '온보딩': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '온보딩');
          return;
        }
        case '학습': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '학습');
          return;
        }
        case '중지': {
          if (!LEGACY_SESSION_COMMANDS_ENABLED) {
            await replyLegacySessionRedirect(interaction);
            return;
          }
          await handleAgentCommand(interaction, '중지');
          return;
        }
        default: {
          await interaction.reply({ ...buildSimpleEmbed('Unknown command', '지원되지 않는 명령입니다.', EMBED_WARN), ephemeral: true });
        }
      }
    } catch (error) {
      logger.error('[BOT] interaction handler failed: %o', error);
      const message = 'Command failed. Check server logs.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(buildSimpleEmbed('실행 실패', message, EMBED_ERROR)).catch(() => undefined);
      } else {
        await interaction.reply({ ...buildSimpleEmbed('실행 실패', message, EMBED_ERROR), ephemeral: true }).catch(() => undefined);
      }
    }
  });
};

  client.on('messageCreate', async (message) => {
    if (!SIMPLE_COMMANDS_ENABLED) {
      return;
    }

    try {
      await handleVibeMessage(message);
    } catch (error) {
      logger.warn('[BOT] vibe message handling failed: %o', error);
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

  startAgentDailyLearningLoop(client);
  startLoginSessionCleanupLoop();
});

client.on('guildCreate', (guild) => {
  const result = onGuildJoined(guild);
  logger.info('[AGENT-OPS] guildCreate onboarding guild=%s ok=%s message=%s', guild.id, String(result.ok), result.message);
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

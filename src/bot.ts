import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type Guild,
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
  registerAutomationManualTrigger,
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
import { fetchStockChartImageUrl, fetchStockQuote, isStockFeatureEnabled } from './services/stockService';
import { generateInvestmentAnalysis, isInvestmentAnalysisEnabled } from './services/investmentAnalysisService';
import {
  isNewsSentimentMonitorEnabled,
  startNewsSentimentMonitor,
  triggerNewsSentimentMonitor,
} from './services/newsSentimentMonitor';
import {
  startYouTubeSubscriptionsMonitor,
  triggerYouTubeSubscriptionsMonitor,
} from './services/youtubeSubscriptionsMonitor';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';

export const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

export type ManualReconnectRequestResult = {
  ok: boolean;
  status: 'accepted' | 'rejected';
  reason: 'OK' | 'COOLDOWN' | 'IN_FLIGHT' | 'NO_TOKEN' | 'RECONNECT_FAILED';
  message: string;
};

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is responsive'),
  new SlashCommandBuilder()
    .setName('도움')
    .setDescription('사용 가능한 명령어 안내'),
  new SlashCommandBuilder()
    .setName('주가')
    .setDescription('주식 현재 가격 조회')
    .addStringOption((option) =>
      option
        .setName('symbol')
        .setDescription('예: AAPL, TSLA, MSFT')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('차트')
    .setDescription('주식 30일 차트 조회')
    .addStringOption((option) =>
      option
        .setName('symbol')
        .setDescription('예: AAPL, TSLA, MSFT')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('분석')
    .setDescription('AI 투자 관점 분석')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('기업/종목/테마 입력')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('뉴스채널')
    .setDescription('Google Finance 뉴스 자동 발송 채널 관리')
    .addSubcommand((sub) =>
      sub
        .setName('등록')
        .setDescription('현재 서버에 뉴스 자동 발송 채널 등록')
        .addChannelOption((option) =>
          option
            .setName('디스코드채널')
            .setDescription('뉴스를 받을 Discord 채널')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('목록')
        .setDescription('등록된 뉴스 발송 채널 목록 확인'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('해제')
        .setDescription('뉴스 자동 발송 채널 해제')
        .addChannelOption((option) =>
          option
            .setName('디스코드채널')
            .setDescription('해제할 Discord 채널')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('구독')
    .setDescription('YouTube 구독 관리')
    .addSubcommand((sub) =>
      sub
        .setName('영상')
        .setDescription('YouTube 영상 알림 구독 추가')
        .addStringOption((option) =>
          option
            .setName('유튜브채널')
            .setDescription('채널 URL 또는 UC... 채널 ID')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('디스코드채널')
            .setDescription('알림을 받을 Discord 채널')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('게시글')
        .setDescription('YouTube 커뮤니티 게시글 알림 구독 추가')
        .addStringOption((option) =>
          option
            .setName('유튜브채널')
            .setDescription('채널 URL 또는 UC... 채널 ID')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('디스코드채널')
            .setDescription('알림을 받을 Discord 채널')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('목록')
        .setDescription('현재 서버의 YouTube 구독 목록 확인'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('해제')
        .setDescription('YouTube 구독 제거')
        .addStringOption((option) =>
          option
            .setName('종류')
            .setDescription('해제할 구독 종류')
            .setRequired(true)
            .addChoices(
              { name: 'videos', value: 'videos' },
              { name: 'posts', value: 'posts' },
            ),
        )
        .addStringOption((option) =>
          option
            .setName('유튜브채널')
            .setDescription('채널 URL 또는 UC... 채널 ID')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('디스코드채널')
            .setDescription('구독 등록했던 Discord 채널')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            )
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('관리')
    .setDescription('관리자 전용 운영 명령')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('상태')
        .setDescription('봇/자동화 상태 확인'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('자동화실행')
        .setDescription('자동화 작업 즉시 실행')
        .addStringOption((option) =>
          option
            .setName('job')
            .setDescription('Automation job name')
            .setRequired(true)
            .addChoices({ name: 'youtube-monitor', value: 'youtube-monitor' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('재연결')
        .setDescription('Discord 클라이언트 재연결'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('채널아이디')
        .setDescription('선택한 채널 ID 확인')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Select a target channel')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('포럼아이디')
        .setDescription('선택한 포럼 채널 ID 확인')
        .addChannelOption((option) =>
          option
            .setName('forum')
            .setDescription('Select a forum channel')
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true),
        ),
        )
        .addSubcommand((sub) =>
          sub
          .setName('동기화')
          .setDescription('슬래시 명령 강제 재등록'),
    ),
].map((definition) => definition.toJSON());

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
    const message = error instanceof Error ? error.message : String(error);
    return `Usage: guilds=${guildCount} | source-stats unavailable (${message})`;
  }
};

const registerSlashCommands = async () => {
  if (!client.application) {
    logger.warn('[BOT] Discord application context unavailable, skipping slash command sync');
    return;
  }

  try {
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
        return;
      }

      logger.warn('[BOT] Falling back to global slash command sync because target guild is unavailable');
    }

    await client.application.commands.set(commandDefinitions);
    logger.info('[BOT] Slash commands synced globally (%d commands)', commandDefinitions.length);

    if (CLEAR_GUILD_SCOPED_COMMANDS_ON_GLOBAL_SYNC) {
      let cleared = 0;
      for (const guild of client.guilds.cache.values()) {
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

const handleStatusCommand = async (interaction: ChatInputCommandInteraction) => {
  const bot = getBotRuntimeSnapshot();
  const automation = getAutomationRuntimeSnapshot();
  const usage = await getUsageSummaryLine();
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

  await interaction.reply({
    content: [
      `Bot ready: ${String(bot.ready)} | wsStatus: ${bot.wsStatus}`,
      `Reconnect queued: ${String(bot.reconnectQueued)} | attempts: ${bot.reconnectAttempts}`,
      `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
      usage,
    ].join('\n'),
    ephemeral: true,
  });
};

const handleHelpCommand = async (interaction: ChatInputCommandInteraction) => {
  await interaction.reply({
    content: [
      '사용자 명령',
      '/도움, /구독, /뉴스채널, /주가, /차트, /분석, /ping',
      '',
      '관리자 명령',
      '/관리 상태 | 자동화실행 | 재연결 | 채널아이디 | 포럼아이디 | 동기화',
    ].join('\n'),
    ephemeral: true,
  });
};

const handleAdminSyncCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await forceRegisterSlashCommands();
  await interaction.editReply('슬래시 명령 재등록을 요청했습니다. 10~60초 후 다시 확인하세요.');
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
    botRuntimeState.lastLoginError = error instanceof Error ? error.message : String(error);
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
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  const jobName = interaction.options.getString('job', true);
  if (jobName !== 'youtube-monitor') {
    await interaction.reply({ content: 'Invalid job name.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await triggerAutomationJob(jobName);
  await interaction.editReply(result.ok ? `Accepted: ${result.message}` : `Failed: ${result.message}`);
};

const handleReconnectCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  const remaining = getManualReconnectCooldownRemainingSec();
  if (remaining > 0) {
    await interaction.reply({
      content: `Reconnect is on cooldown. Try again in ${remaining}s.`,
      ephemeral: true,
    });
    return;
  }

  if (!activeToken) {
    await interaction.reply({ content: 'DISCORD token is not loaded.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Reconnect requested. Restarting Discord client...', ephemeral: true });

  setTimeout(() => {
    void runManualReconnect(`slash-command:${interaction.user.id}`);
  }, 300);
};

const handleStockPriceCommand = async (interaction: ChatInputCommandInteraction) => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  await interaction.deferReply({ ephemeral: true });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply('ALPHA_VANTAGE_KEY가 없어 주가 기능을 사용할 수 없습니다.');
    return;
  }

  const quote = await fetchStockQuote(symbol);
  if (!quote) {
    await interaction.editReply(`주가 조회 실패: ${symbol}`);
    return;
  }

  await interaction.editReply([
    `📈 **${quote.symbol} 주가**`,
    `현재 가격: ${quote.price}`,
    `오늘 최고: ${quote.high}`,
    `오늘 최저: ${quote.low}`,
    `오늘 시가: ${quote.open}`,
    `전일 종가: ${quote.prevClose}`,
  ].join('\n'));
};

const handleStockChartCommand = async (interaction: ChatInputCommandInteraction) => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  await interaction.deferReply({ ephemeral: true });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply('ALPHA_VANTAGE_KEY가 없어 차트 기능을 사용할 수 없습니다.');
    return;
  }

  const imageUrl = await fetchStockChartImageUrl(symbol);
  if (!imageUrl) {
    await interaction.editReply(`차트 생성 실패: ${symbol}`);
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
  await interaction.deferReply({ ephemeral: true });

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
    content: `channel_id=${channel.id} | name=${channel.name} | type=${ChannelType[channel.type] ?? channel.type}`,
    ephemeral: true,
  });
};

const handleForumIdCommand = async (interaction: ChatInputCommandInteraction) => {
  const forum = interaction.options.getChannel('forum', true);
  if (forum.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: '선택한 채널이 포럼 채널이 아닙니다.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `forum_id=${forum.id} | name=${forum.name}`,
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
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const channelInput = interaction.options.getString('유튜브채널', true);
  const targetChannel = interaction.options.getChannel('디스코드채널', true);

  if (
    targetChannel.type !== ChannelType.GuildText
    && targetChannel.type !== ChannelType.GuildAnnouncement
    && targetChannel.type !== ChannelType.PublicThread
    && targetChannel.type !== ChannelType.PrivateThread
    && targetChannel.type !== ChannelType.AnnouncementThread
  ) {
    await interaction.reply({ content: '텍스트/공지/포럼 스레드 채널만 구독 대상으로 지정할 수 있습니다.', ephemeral: true });
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
    await interaction.editReply(
      `${state}: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`구독 등록 실패: ${message}`);
  }
};

const handleSubscriptionListCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId) {
    await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const rows = await listYouTubeSubscriptions({ guildId: interaction.guildId });
    if (rows.length === 0) {
      await interaction.editReply('등록된 YouTube 구독이 없습니다.');
      return;
    }

    const previewRows = rows.slice(0, 20);
    const linesWithMeta = await Promise.all(
      previewRows.map(async (row) => {
        const line = formatSubscriptionLine(row);
        const channelMeta = await resolveRowChannelMeta(interaction, row);
        return `${line} | channel=${channelMeta}`;
      }),
    );
    const suffix = rows.length > 20 ? `\n...(${rows.length - 20} more)` : '';
    await interaction.editReply(`총 ${rows.length}개\n${linesWithMeta.join('\n')}${suffix}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`구독 목록 조회 실패: ${message}`);
  }
};

const handleUnsubscribeCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const kind = interaction.options.getString('종류', true);
  if (kind !== 'videos' && kind !== 'posts') {
    await interaction.reply({ content: '종류는 videos 또는 posts만 가능합니다.', ephemeral: true });
    return;
  }

  const channelInput = interaction.options.getString('유튜브채널', true);
  const targetChannel = interaction.options.getChannel('디스코드채널', true);

  if (
    targetChannel.type !== ChannelType.GuildText
    && targetChannel.type !== ChannelType.GuildAnnouncement
    && targetChannel.type !== ChannelType.PublicThread
    && targetChannel.type !== ChannelType.PrivateThread
    && targetChannel.type !== ChannelType.AnnouncementThread
  ) {
    await interaction.reply({ content: '텍스트/공지/포럼 스레드 채널만 해제 대상으로 지정할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await deleteYouTubeSubscription({
      guildId: interaction.guildId,
      discordChannelId: targetChannel.id,
      channelInput,
      kind,
    });

    if (!result.deleted) {
      await interaction.editReply(`해제 대상이 없습니다: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`);
      return;
    }

    await interaction.editReply(`해제 완료: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`구독 해제 실패: ${message}`);
  }
};

const handleGroupedSubscribeCommand = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case '영상': {
      await handleSubscribeCommand(interaction, 'videos');
      return;
    }
    case '게시글': {
      await handleSubscribeCommand(interaction, 'posts');
      return;
    }
    case '목록': {
      await handleSubscriptionListCommand(interaction);
      return;
    }
    case '해제': {
      await handleUnsubscribeCommand(interaction);
      return;
    }
    default: {
      await interaction.reply({ content: '지원되지 않는 구독 서브명령입니다.', ephemeral: true });
    }
  }
};

const ensureNewsChannelType = (interaction: ChatInputCommandInteraction, channelType: number): boolean => {
  if (
    channelType !== ChannelType.GuildText
    && channelType !== ChannelType.GuildAnnouncement
    && channelType !== ChannelType.PublicThread
    && channelType !== ChannelType.PrivateThread
    && channelType !== ChannelType.AnnouncementThread
  ) {
    void interaction.reply({ content: '텍스트/공지/포럼 스레드 채널만 등록할 수 있습니다.', ephemeral: true });
    return false;
  }
  return true;
};

const handleNewsChannelCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!(await hasAdminPermission(interaction))) {
    await interaction.reply({ content: 'Admin permission is required.', ephemeral: true });
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: '서버 채널에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === '목록') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const rows = await listNewsChannelSubscriptions({ guildId: interaction.guildId });
      if (rows.length === 0) {
        await interaction.editReply('등록된 뉴스 채널이 없습니다.');
        return;
      }

      const lines = rows.slice(0, 20).map((row) => {
        const target = row.channel_id ? `<#${row.channel_id}>` : '-';
        return `#${row.id} -> ${target}`;
      });
      const suffix = rows.length > 20 ? `\n...(${rows.length - 20} more)` : '';
      await interaction.editReply(`총 ${rows.length}개\n${lines.join('\n')}${suffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply(`뉴스 채널 목록 조회 실패: ${message}`);
    }
    return;
  }

  const targetChannel = interaction.options.getChannel('디스코드채널', true);
  if (!ensureNewsChannelType(interaction, targetChannel.type)) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (sub === '등록') {
      const result = await createNewsChannelSubscription({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        discordChannelId: targetChannel.id,
      });

      const state = result.created ? '등록 완료' : '이미 등록됨';
      await interaction.editReply(`${state}: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`);
      return;
    }

    if (sub === '해제') {
      const result = await deleteNewsChannelSubscription({
        guildId: interaction.guildId,
        discordChannelId: targetChannel.id,
      });

      if (!result.deleted) {
        await interaction.editReply(`해제 대상이 없습니다: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`);
        return;
      }

      await interaction.editReply(`해제 완료: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`);
      return;
    }

    await interaction.editReply('지원되지 않는 뉴스채널 서브명령입니다.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`뉴스 채널 처리 실패: ${message}`);
  }
};

const handleAdminCommand = async (interaction: ChatInputCommandInteraction) => {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case '상태': {
      await handleStatusCommand(interaction);
      return;
    }
    case '자동화실행': {
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
      await interaction.reply({ content: '지원되지 않는 관리자 서브명령입니다.', ephemeral: true });
    }
  }
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
            content: `Pong! ws=${client.ws.status} latency=${client.ws.ping}ms`,
            ephemeral: true,
          });
          return;
        }
        case '도움': {
          await handleHelpCommand(interaction);
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
        case '구독영상': {
          await handleSubscribeCommand(interaction, 'videos');
          return;
        }
        case '구독게시글': {
          await handleSubscribeCommand(interaction, 'posts');
          return;
        }
        case '구독목록': {
          await handleSubscriptionListCommand(interaction);
          return;
        }
        case '구독해제': {
          await handleUnsubscribeCommand(interaction);
          return;
        }
        case '구독': {
          await handleGroupedSubscribeCommand(interaction);
          return;
        }
        case '뉴스채널': {
          await handleNewsChannelCommand(interaction);
          return;
        }
        case '관리': {
          await handleAdminCommand(interaction);
          return;
        }
        default: {
          await interaction.reply({ content: 'Unknown command.', ephemeral: true });
        }
      }
    } catch (error) {
      logger.error('[BOT] interaction handler failed: %o', error);
      const message = 'Command failed. Check server logs.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => undefined);
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      }
    }
  });
};

client.on('clientReady', () => {
  botRuntimeState.ready = true;
  botRuntimeState.started = true;
  botRuntimeState.lastReadyAt = new Date().toISOString();
  botRuntimeState.lastRecoveryAt = botRuntimeState.lastReadyAt;
  botRuntimeState.lastAlertAt = null;
  botRuntimeState.lastAlertReason = null;
  botRuntimeState.manualReconnectCooldownRemainingSec = getManualReconnectCooldownRemainingSec();

  registerAutomationManualTrigger('youtube-monitor', async () => triggerYouTubeSubscriptionsMonitor(client));
  registerAutomationManualTrigger('news-monitor', async () => triggerNewsSentimentMonitor(client));
  void registerSlashCommands();
  if (isAutomationEnabled()) {
    startYouTubeSubscriptionsMonitor(client);
    if (isNewsSentimentMonitorEnabled()) {
      startNewsSentimentMonitor(client);
    }
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

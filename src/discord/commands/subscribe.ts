/**
 * Subscribe / unsubscribe command handlers (YouTube & news).
 */
import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import {
  buildSimpleEmbed,
  getErrorMessage,
  EMBED_INFO,
  EMBED_WARN,
  EMBED_ERROR,
  EMBED_SUCCESS,
} from '../ui';
import { ensureFeatureAccess } from '../auth';
import {
  createYouTubeSubscription,
  deleteYouTubeSubscription,
  listYouTubeSubscriptions,
  type YouTubeSubscription,
} from '../../services/news/youtubeSubscriptionStore';
import {
  createNewsChannelSubscription,
  deleteNewsChannelSubscription,
  listNewsChannelSubscriptions,
} from '../../services/news/newsChannelStore';
import { isAutomationEnabled, triggerAutomationJob } from '../../services/automationBot';
import { isNewsSentimentMonitorEnabled } from '../../services/news/newsSentimentMonitor';
import { getNewsMonitorCandidateSourceStatus } from '../../services/news/newsMonitorWorkerClient';
import { DISCORD_MESSAGES } from '../messages';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getChannelTypeLabel = (channelType: number): string => {
  const mapped = ChannelType[channelType];
  return typeof mapped === 'string' ? mapped : String(channelType);
};

const formatSubscriptionLine = (row: YouTubeSubscription): string => {
  const kind = row.url.endsWith('#posts')
    ? 'posts'
    : row.url.endsWith('#videos')
      ? 'videos'
      : 'unknown';
  const channelId = row.url.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/)?.[1] || 'unknown';
  const discordTarget = row.channel_id ? `<#${row.channel_id}>` : '-';
  return `#${row.id} [${kind}] youtube=${channelId} -> discord=${discordTarget}`;
};

const resolveRowChannelMeta = async (
  interaction: ChatInputCommandInteraction,
  row: YouTubeSubscription,
): Promise<string> => {
  if (!interaction.guild || !row.channel_id) return 'unknown';
  try {
    const channel = await interaction.guild.channels.fetch(row.channel_id);
    if (!channel) return 'missing';
    return `${channel.name} (${getChannelTypeLabel(channel.type)})`;
  } catch {
    return 'missing';
  }
};

const isValidSubscribeChannelType = (t: number): boolean =>
  t === ChannelType.GuildText ||
  t === ChannelType.GuildAnnouncement ||
  t === ChannelType.PublicThread ||
  t === ChannelType.PrivateThread ||
  t === ChannelType.AnnouncementThread;

const parseAutomationMetric = (message: string, key: string): number => {
  const matched = message.match(new RegExp(`${key}=(\\d+)`));
  return matched ? Number(matched[1]) : 0;
};

const formatNewsCandidateSource = (): string => {
  const status = getNewsMonitorCandidateSourceStatus();
  if (status.mode === 'n8n') {
    return 'n8n 위임';
  }

  if (status.mode === 'mcp-worker') {
    return 'MCP 뉴스 워커';
  }

  if (status.mode === 'local-fallback') {
    return '내장 Google Finance fallback';
  }

  return '미설정';
};

const buildNewsAutomationWarnings = (): string[] => {
  const warnings: string[] = [];

  if (!isAutomationEnabled()) {
    warnings.push('상태: 자동화 런타임이 꺼져 있어 뉴스가 자동 게시되지 않습니다.');
    warnings.push('관리자 확인: START_AUTOMATION_JOBS=true 와 Discord 토큰 설정이 필요합니다.');
    return warnings;
  }

  if (!isNewsSentimentMonitorEnabled()) {
    warnings.push('상태: 뉴스 모니터가 꺼져 있어 뉴스가 자동 게시되지 않습니다.');
    warnings.push('관리자 확인: AUTOMATION_NEWS_ENABLED=true 가 필요합니다.');
  }

  if (!getNewsMonitorCandidateSourceStatus().configured) {
    warnings.push('상태: 뉴스 후보 공급원이 연결되지 않아 새 기사를 가져올 수 없습니다.');
    warnings.push('관리자 확인: NEWS_MONITOR_MCP_WORKER_URL 또는 N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES 설정이 필요합니다.');
  }

  return warnings;
};

const formatNewsTriggerSummary = (result: { ok: boolean; message: string }): string[] => {
  if (!result.ok) {
    return [
      '즉시 점검 실패: 뉴스 자동화를 바로 실행하지 못했습니다.',
      `세부: ${result.message}`,
    ];
  }

  const sent = parseAutomationMetric(result.message, 'sent');
  const failed = parseAutomationMetric(result.message, 'failed');
  const duplicate = parseAutomationMetric(result.message, 'duplicate');
  const noCandidate = parseAutomationMetric(result.message, 'noCandidate');

  if (sent > 0) {
    return ['즉시 점검 완료: 새 뉴스를 전송했습니다.'];
  }

  if (failed > 0) {
    return [
      '즉시 점검 완료: 일부 채널 전송에 실패했습니다.',
      `세부: ${result.message}`,
    ];
  }

  if (duplicate > 0) {
    return ['즉시 점검 완료: 이미 전송한 최신 뉴스라 중복 게시를 건너뛰었습니다.'];
  }

  if (noCandidate > 0) {
    return ['즉시 점검 완료: 아직 보낼 신규 뉴스가 없습니다.'];
  }

  return [
    '즉시 점검 완료: 뉴스 자동화 호출은 성공했습니다.',
    `세부: ${result.message}`,
  ];
};

// ─── Handlers ─────────────────────────────────────────────────────────────────
const handleSubscribeYouTubeCommand = async (
  interaction: ChatInputCommandInteraction,
  kind: 'videos' | 'posts',
): Promise<void> => {
  const access = await ensureFeatureAccess(interaction);
  if (!access.ok) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
      ephemeral: true,
    });
    return;
  }
  const accessNotice = access.autoLoggedIn ? `\n\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';
  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
    return;
  }
  const channelInput = (
    interaction.options.getString('링크') ||
    interaction.options.getString('유튜브채널') ||
    ''
  ).trim();
  const targetChannel = interaction.channel;

  if (!channelInput) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '영상/게시글 구독은 유튜브채널을 입력해주세요.', EMBED_WARN), ephemeral: true });
    return;
  }
  if (!targetChannel || !isValidSubscribeChannelType(targetChannel.type)) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleChannelTypeError, '텍스트/공지/포럼 스레드 채널만 구독 대상으로 지정할 수 있습니다.', EMBED_WARN), ephemeral: true });
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
      buildSimpleEmbed(
        DISCORD_MESSAGES.subscribe.titleSubscribeResult,
        `${state}: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})${accessNotice}`,
        EMBED_SUCCESS,
      ),
    );
  } catch (error) {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleSubscribeCreateFailed, getErrorMessage(error), EMBED_ERROR));
  }
};

const handleSubscribeNewsCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const access = await ensureFeatureAccess(interaction);
  if (!access.ok) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
      ephemeral: true,
    });
    return;
  }
  const accessNotice = access.autoLoggedIn ? `\n\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';
  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
    return;
  }
  const targetChannel = interaction.channel;
  if (!targetChannel || !isValidSubscribeChannelType(targetChannel.type)) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleChannelTypeError, '텍스트/공지/포럼 스레드 채널만 등록할 수 있습니다.', EMBED_WARN), ephemeral: true });
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
    const warnings = buildNewsAutomationWarnings();
    const lines = [`${state}: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})`];

    if (access.autoLoggedIn) {
      lines.push(DISCORD_MESSAGES.common.autoLoginActivated);
    }

    lines.push(`후보 공급원: ${formatNewsCandidateSource()}`);

    if (warnings.length > 0) {
      lines.push('', ...warnings);
    } else {
      const triggerResult = await triggerAutomationJob('news-monitor', { guildId: interaction.guildId });
      lines.push('', ...formatNewsTriggerSummary(triggerResult));
      if (!triggerResult.ok) {
        warnings.push(triggerResult.message);
      }
    }

    await interaction.editReply(
      buildSimpleEmbed(
        DISCORD_MESSAGES.subscribe.titleNewsSubscribe,
        lines.join('\n'),
        warnings.length > 0 ? EMBED_WARN : EMBED_SUCCESS,
      ),
    );
  } catch (error) {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleNewsSubscribeFailed, getErrorMessage(error), EMBED_ERROR));
  }
};

const handleSubscriptionListCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const [ytRows, newsRows] = await Promise.all([
      listYouTubeSubscriptions({ guildId: interaction.guildId }),
      listNewsChannelSubscriptions({ guildId: interaction.guildId }),
    ]);
    if (ytRows.length === 0 && newsRows.length === 0) {
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleList, DISCORD_MESSAGES.subscribe.noSubscriptions, EMBED_INFO));
      return;
    }

    const previewYtRows = ytRows.slice(0, 20);
    const ytLines = await Promise.all(
      previewYtRows.map(async (row) => {
        const line = formatSubscriptionLine(row);
        const meta = await resolveRowChannelMeta(interaction, row);
        return `${line} | channel=${meta}`;
      }),
    );
    const ytSuffix = ytRows.length > 20 ? `\n...(${ytRows.length - 20} more)` : '';
    const newsLines = newsRows
      .slice(0, 20)
      .map((row) => `#${row.id} [news] -> ${row.channel_id ? `<#${row.channel_id}>` : '-'}`);
    const newsSuffix = newsRows.length > 20 ? `\n...(${newsRows.length - 20} more)` : '';

    await interaction.editReply(
      buildSimpleEmbed(
        DISCORD_MESSAGES.subscribe.titleListMerged,
        [
          `[YouTube] ${ytRows.length}개`,
          ...(ytLines.length > 0 ? ytLines : ['- 없음']),
          ytSuffix,
          '',
          `[News] ${newsRows.length}개`,
          ...(newsLines.length > 0 ? newsLines : ['- 없음']),
          newsSuffix,
        ]
          .filter(Boolean)
          .join('\n'),
        EMBED_INFO,
      ),
    );
  } catch (error) {
    await interaction.editReply(
      buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleListFailed, getErrorMessage(error), EMBED_ERROR),
    );
  }
};

const handleUnsubscribeCommand = async (
  interaction: ChatInputCommandInteraction,
  forcedKind?: 'videos' | 'posts' | 'news',
): Promise<void> => {
  const access = await ensureFeatureAccess(interaction);
  if (!access.ok) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
      ephemeral: true,
    });
    return;
  }
  const accessNotice = access.autoLoggedIn ? `\n\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';
  if (!interaction.guildId) {
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
    return;
  }

  const kind = (forcedKind || interaction.options.getString('종류') || '').trim();
  if (kind !== 'videos' && kind !== 'posts' && kind !== 'news') {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '종류는 videos, posts, news만 가능합니다.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  const channelInput = (
    interaction.options.getString('링크') ||
    interaction.options.getString('유튜브채널') ||
    ''
  ).trim();
  const targetChannel = interaction.channel;
  if (!targetChannel || !isValidSubscribeChannelType(targetChannel.type)) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleChannelTypeError, '텍스트/공지/포럼 스레드 채널만 해제 대상으로 지정할 수 있습니다.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (kind === 'news') {
      const result = await deleteNewsChannelSubscription({
        guildId: interaction.guildId,
        discordChannelId: targetChannel.id,
      });
      await interaction.editReply(
        buildSimpleEmbed(
          result.deleted ? DISCORD_MESSAGES.subscribe.titleUnsubscribeDone : DISCORD_MESSAGES.subscribe.titleUnsubscribe,
          result.deleted
            ? `해제 완료: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})${accessNotice}`
            : `해제 대상이 없습니다: news -> <#${targetChannel.id}>${accessNotice}`,
          result.deleted ? EMBED_SUCCESS : EMBED_WARN,
        ),
      );
      return;
    }

    if (!channelInput) {
      await interaction.editReply(
        buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '영상/게시글 해제 시 유튜브채널을 입력해주세요.', EMBED_WARN),
      );
      return;
    }

    const result = await deleteYouTubeSubscription({
      guildId: interaction.guildId,
      discordChannelId: targetChannel.id,
      channelInput,
      kind,
    });
    await interaction.editReply(
      buildSimpleEmbed(
        result.deleted ? DISCORD_MESSAGES.subscribe.titleUnsubscribeDone : DISCORD_MESSAGES.subscribe.titleUnsubscribe,
        result.deleted
          ? `해제 완료: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}>${accessNotice}`
          : `해제 대상이 없습니다: [${kind}] youtube=${result.channelId} -> discord=<#${targetChannel.id}>${accessNotice}`,
        result.deleted ? EMBED_SUCCESS : EMBED_WARN,
      ),
    );
  } catch (error) {
    await interaction.editReply(
      buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleUnsubscribeFailed, getErrorMessage(error), EMBED_ERROR),
    );
  }
};

// ─── Grouped /구독 dispatcher ─────────────────────────────────────────────────
export const handleGroupedSubscribeCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const explicitAction = (interaction.options.getString('동작') || '').trim();
  const explicitKind = (interaction.options.getString('종류') || '').trim();
  const channelInput = (
    interaction.options.getString('링크') ||
    interaction.options.getString('유튜브채널') ||
    ''
  ).trim();

  const action =
    explicitAction ||
    (channelInput ? 'add' : 'list');

  const kind =
    explicitKind ||
    (channelInput ? 'videos' : '');

  if (action === 'list') { await handleSubscriptionListCommand(interaction); return; }

  if (action === 'add') {
    if (kind === 'news') { await handleSubscribeNewsCommand(interaction); return; }
    if (kind === 'videos' || kind === 'posts') { await handleSubscribeYouTubeCommand(interaction, kind); return; }
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '추가 동작에는 종류(영상/게시글/뉴스)가 필요합니다.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }

  if (action === 'remove') {
    const removeKind = (kind === 'videos' || kind === 'posts' || kind === 'news')
      ? kind
      : channelInput
        ? 'videos'
        : 'news';
    await handleUnsubscribeCommand(interaction, removeKind);
    return;
  }

  await interaction.reply({
    ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '동작은 추가/해제/목록 중 하나여야 합니다.', EMBED_WARN),
    ephemeral: true,
  });
};

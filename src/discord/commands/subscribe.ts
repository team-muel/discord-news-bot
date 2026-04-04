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
  const selectedChannel = interaction.options.getChannel('디스코드채널', false);
  const targetChannel = selectedChannel || interaction.channel;

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
  const selectedChannel = interaction.options.getChannel('디스코드채널', false);
  const targetChannel = selectedChannel || interaction.channel;
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
    await interaction.editReply(
      buildSimpleEmbed(
        DISCORD_MESSAGES.subscribe.titleNewsSubscribe,
        `${state}: news -> <#${targetChannel.id}> (${getChannelTypeLabel(targetChannel.type)})${accessNotice}`,
        EMBED_SUCCESS,
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
  const targetChannel = interaction.options.getChannel('디스코드채널');
  if (!targetChannel) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.subscribe.titleInputError, '해제 동작에는 디스코드채널이 필요합니다.', EMBED_WARN),
      ephemeral: true,
    });
    return;
  }
  if (!isValidSubscribeChannelType(targetChannel.type)) {
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
  const hasTargetChannel = Boolean(interaction.options.getChannel('디스코드채널'));

  const action =
    explicitAction ||
    (hasTargetChannel || channelInput ? 'add' : 'list');

  const kind =
    explicitKind ||
    (channelInput ? 'videos' : hasTargetChannel ? 'news' : '');

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

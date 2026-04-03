/**
 * Command handlers: stock price, chart, investment analysis, channel/forum ID.
 */
import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import {
  buildSimpleEmbed,
  getReplyVisibility,
  EMBED_INFO,
  EMBED_WARN,
  EMBED_ERROR,
  EMBED_SUCCESS,
} from '../ui';
import {
  fetchStockChartImageUrl,
  fetchStockQuote,
  isStockFeatureEnabled,
} from '../../services/trading/stockService';
import {
  generateInvestmentAnalysis,
  isInvestmentAnalysisEnabled,
} from '../../services/trading/investmentAnalysisService';
import { DISCORD_MESSAGES } from '../messages';
import { DISCORD_MARKET_ANALYSIS_LIMIT } from '../runtimePolicy';

export const handleStockPriceCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply(
      buildSimpleEmbed(DISCORD_MESSAGES.market.titlePriceUnavailable, 'ALPHA_VANTAGE_KEY가 없어 주가 기능을 사용할 수 없습니다.', EMBED_WARN),
    );
    return;
  }

  let quote: Awaited<ReturnType<typeof fetchStockQuote>>;
  try {
    quote = await fetchStockQuote(symbol);
  } catch {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.market.titlePriceFailed, `${symbol} 조회 중 오류가 발생했습니다.`, EMBED_ERROR));
    return;
  }
  if (!quote) {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.market.titlePriceFailed, symbol, EMBED_ERROR));
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

export const handleStockChartCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const symbol = interaction.options.getString('symbol', true).toUpperCase().trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  if (!isStockFeatureEnabled()) {
    await interaction.editReply(
      buildSimpleEmbed(DISCORD_MESSAGES.market.titleChartUnavailable, 'ALPHA_VANTAGE_KEY가 없어 차트 기능을 사용할 수 없습니다.', EMBED_WARN),
    );
    return;
  }

  let imageUrl: string | null;
  try {
    imageUrl = await fetchStockChartImageUrl(symbol);
  } catch {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.market.titleChartFailed, `${symbol} 차트 조회 중 오류가 발생했습니다.`, EMBED_ERROR));
    return;
  }
  if (!imageUrl) {
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.market.titleChartFailed, symbol, EMBED_ERROR));
    return;
  }

  await interaction.editReply({
    embeds: [{ title: `${symbol} 주가 차트`, color: 0x2ecc71, image: { url: imageUrl } }],
  });
};

export const handleAnalyzeCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const query = interaction.options.getString('query', true).trim();
  const shared = getReplyVisibility(interaction) === 'public';
  await interaction.deferReply({ ephemeral: !shared });

  let answer: string;
  try {
    answer = await generateInvestmentAnalysis(query);
  } catch {
    await interaction.editReply(buildSimpleEmbed('분석 실패', 'AI 분석 중 오류가 발생했습니다.', EMBED_ERROR));
    return;
  }
  const title = isInvestmentAnalysisEnabled() ? '📊 AI 투자 분석' : '📊 투자 분석 (제한 모드)';
  await interaction.editReply({
    embeds: [{ title, description: answer.slice(0, DISCORD_MARKET_ANALYSIS_LIMIT), color: 0x3498db }],
  });
};

export const handleChannelIdCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
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

export const handleForumIdCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const forum = interaction.options.getChannel('forum', true);
  if (forum.type !== ChannelType.GuildForum) {
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.market.titleInputError, DISCORD_MESSAGES.market.forumTypeRequired, EMBED_WARN),
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({
    ...buildSimpleEmbed(DISCORD_MESSAGES.market.titleForumInfo, `forum_id=${forum.id}\nname=${forum.name}`, EMBED_INFO),
    ephemeral: true,
  });
};

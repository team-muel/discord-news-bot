/**
 * Command handlers: channel/forum ID utilities.
 */
import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import {
  buildSimpleEmbed,
  EMBED_INFO,
  EMBED_WARN,
} from '../ui';
import { DISCORD_MESSAGES } from '../messages';

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

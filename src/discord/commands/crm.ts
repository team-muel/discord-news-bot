/**
 * /내정보 — Show the caller's CRM profile + activity stats.
 * /유저정보 <user> — Admin: show a target user's CRM profile.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { ensureFeatureAccess } from '../auth';
import { buildSimpleEmbed, EMBED_INFO, EMBED_WARN } from '../ui';
import {
  getUserCrmSnapshot,
  type UserCrmSnapshot,
} from '../../services/discord-support/userCrmService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ko-KR') : '-';
};

const fmtNumber = (n: number): string => n.toLocaleString('ko-KR');

const buildCrmEmbed = (
  snapshot: UserCrmSnapshot,
  displayName: string,
  avatarUrl: string | null,
): ReturnType<typeof buildSimpleEmbed> => {
  const { profile, membership, guilds } = snapshot;

  const lines: string[] = [];
  lines.push(`**유저** <@${profile.userId}>`);
  lines.push(`**첫 방문** ${fmtDate(profile.firstSeenAt)}`);
  lines.push(`**마지막 활동** ${fmtDate(profile.lastActiveAt)}`);

  if (profile.badges.length > 0) {
    lines.push(`**배지** ${profile.badges.join(', ')}`);
  }
  if (profile.tags.length > 0) {
    lines.push(`**태그** ${profile.tags.join(', ')}`);
  }

  lines.push('');

  if (membership) {
    lines.push('📊 **이 서버 활동**');
    lines.push(`메시지 ${fmtNumber(membership.messageCount)} | 커맨드 ${fmtNumber(membership.commandCount)}`);
    lines.push(`리액션(준) ${fmtNumber(membership.reactionGivenCount)} | 리액션(받은) ${fmtNumber(membership.reactionReceivedCount)}`);
    lines.push(`세션 ${fmtNumber(membership.sessionCount)}`);
    lines.push(`서버 첫 방문 ${fmtDate(membership.firstSeenAt)} | 마지막 ${fmtDate(membership.lastActiveAt)}`);
  } else {
    lines.push('_이 서버에서의 활동 기록이 없습니다._');
  }

  if (guilds.length > 1) {
    lines.push('');
    lines.push(`🌐 **참여 서버** ${guilds.length}개`);
    const totalMessages = guilds.reduce((sum, g) => sum + g.messageCount, 0);
    const totalCommands = guilds.reduce((sum, g) => sum + g.commandCount, 0);
    lines.push(`전체 메시지 ${fmtNumber(totalMessages)} | 전체 커맨드 ${fmtNumber(totalCommands)}`);
  }

  const description = lines.join('\n');

  return {
    embeds: [
      {
        title: `👤 ${displayName}`,
        description: description.slice(0, 4096),
        color: EMBED_INFO,
        ...(avatarUrl ? { thumbnail: { url: avatarUrl } } : {}),
      },
    ],
  };
};

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

type CrmCommandDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  hasAdminPermission: (interaction: ChatInputCommandInteraction) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const createCrmHandlers = (deps: CrmCommandDeps) => {
  /** /내정보 — self profile */
  const handleMyInfoCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildSimpleEmbed('내정보', '서버에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildSimpleEmbed('내정보', '로그인이 필요합니다. `/로그인` 후 다시 시도해주세요.', EMBED_WARN), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const snapshot = await getUserCrmSnapshot(interaction.user.id, interaction.guildId ?? undefined);

    if (!snapshot) {
      await interaction.editReply(buildSimpleEmbed('내정보', '아직 활동 기록이 없습니다. 메시지나 커맨드를 사용한 후 다시 확인해주세요.', EMBED_WARN));
      return;
    }

    const embed = buildCrmEmbed(
      snapshot,
      interaction.user.displayName ?? interaction.user.username,
      interaction.user.avatarURL({ size: 128 }),
    );
    await interaction.editReply(embed);
  };

  /** /유저정보 <user> — admin target profile */
  const handleUserInfoCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildSimpleEmbed('유저정보', '서버에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildSimpleEmbed('유저정보', '로그인이 필요합니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const isAdmin = await deps.hasAdminPermission(interaction);
    if (!isAdmin) {
      await interaction.reply({ ...buildSimpleEmbed('유저정보', '관리자만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('유저', true);
    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const snapshot = await getUserCrmSnapshot(target.id, interaction.guildId ?? undefined);

    if (!snapshot) {
      await interaction.editReply(buildSimpleEmbed('유저정보', `<@${target.id}>의 활동 기록이 없습니다.`, EMBED_WARN));
      return;
    }

    const embed = buildCrmEmbed(
      snapshot,
      target.displayName ?? target.username,
      target.avatarURL({ size: 128 }),
    );
    await interaction.editReply(embed);
  };

  return { handleMyInfoCommand, handleUserInfoCommand };
};

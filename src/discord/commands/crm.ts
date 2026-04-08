/**
 * /내정보 — 내 CRM 프로필 + 활동 통계 + 로그인 진단 + 학습 설정 통합.
 * /유저정보 <user> — Admin: show a target user's CRM profile.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { ensureFeatureAccess } from '../auth';
import { buildSimpleEmbed, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';
import {
  getUserCrmSnapshot,
  type UserCrmSnapshot,
} from '../../services/discord-support/userCrmService';
import { isUserLearningEnabled, setUserLearningEnabled } from '../../services/userLearningPrefsService';
import { isAnyLlmConfigured } from '../../services/llmClient';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { isStockFeatureEnabled } from '../../services/trading/stockService';

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
  markUserLoggedIn: (guildId: string, userId: string) => Promise<'persisted' | 'memory-only'>;
  simpleCommandsEnabled: boolean;
  loginSessionTtlMs: number;
  loginSessionRefreshWindowMs: number;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const createCrmHandlers = (deps: CrmCommandDeps) => {
  /** /내정보 — 활동 통계 + 로그인 진단 + 학습 설정 통합 */
  const handleMyInfoCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildSimpleEmbed('유저', '서버에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId ?? undefined;
    const userId = interaction.user.id;

    // 로그인 진단 수행
    const checks: string[] = [];
    const inGuild = Boolean(guildId);
    checks.push(`서버 채널 사용: ${inGuild ? 'OK' : 'FAIL'}`);
    const admin = await deps.hasAdminPermission(interaction);
    checks.push(`관리자 권한: ${admin ? 'OK' : 'LIMITED'}`);
    checks.push(`LLM: ${isAnyLlmConfigured() ? 'OK' : 'MISSING'}`);
    checks.push(`주가 키: ${isStockFeatureEnabled() ? 'OK' : 'MISSING'}`);
    checks.push(`DB: ${isSupabaseConfigured() ? 'OK' : 'LIMITED'}`);

    let loginMode: 'persisted' | 'memory-only' | null = null;
    if (inGuild && guildId) {
      loginMode = await deps.markUserLoggedIn(guildId, userId);
      checks.push(`로그인 세션: ACTIVE (${loginMode === 'persisted' ? '저장됨' : '메모리 전용'})`);
    }

    // 학습 설정 조회
    const learningEnabled = guildId ? await isUserLearningEnabled(userId, guildId) : null;

    // 버튼: 학습 ON/OFF
    const learningRow = guildId ? new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`learning_toggle:on:${userId}:${guildId}`)
        .setLabel('학습 켜기')
        .setStyle(learningEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(learningEnabled === true),
      new ButtonBuilder()
        .setCustomId(`learning_toggle:off:${userId}:${guildId}`)
        .setLabel('학습 끄기')
        .setStyle(learningEnabled === false ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setDisabled(learningEnabled === false),
    ) : null;

    // CRM 스냅샷 (없어도 진단은 보여줌)
    const snapshot = await getUserCrmSnapshot(userId, guildId);

    const diagLines = ['**진단**', ...checks].join('\n');
    const learningLine = learningEnabled !== null
      ? `\n\n**학습 메모리** ${learningEnabled ? '🟢 활성화' : '⚫ 비활성화'}`
      : '';

    let description = diagLines + learningLine;

    if (snapshot) {
      const { membership } = snapshot;
      const statsLines = membership
        ? [
            '',
            '**이 서버 활동**',
            `메시지 ${fmtNumber(membership.messageCount)} | 커맨드 ${fmtNumber(membership.commandCount)}`,
            `리액션(준) ${fmtNumber(membership.reactionGivenCount)} | 리액션(받은) ${fmtNumber(membership.reactionReceivedCount)}`,
          ].join('\n')
        : '\n_이 서버 활동 기록 없음_';
      description += statsLines;
    }

    const replyPayload: Parameters<typeof interaction.editReply>[0] = {
      embeds: [{
        title: `👤 ${interaction.user.displayName ?? interaction.user.username}`,
        description: description.slice(0, 4096),
        color: EMBED_SUCCESS,
        ...(interaction.user.avatarURL({ size: 128 }) ? { thumbnail: { url: interaction.user.avatarURL({ size: 128 })! } } : {}),
      }],
    };
    if (learningRow) {
      (replyPayload as Record<string, unknown>).components = [learningRow];
    }

    await interaction.editReply(replyPayload);
  };

  /** /통계 <user> — admin target profile */
  const handleUserInfoCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildSimpleEmbed('통계', '서버에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildSimpleEmbed('통계', '로그인이 필요합니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const isAdmin = await deps.hasAdminPermission(interaction);
    if (!isAdmin) {
      await interaction.reply({ ...buildSimpleEmbed('통계', '관리자만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('유저', true);
    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const snapshot = await getUserCrmSnapshot(target.id, interaction.guildId ?? undefined);

    if (!snapshot) {
      await interaction.editReply(buildSimpleEmbed('통계', `<@${target.id}>의 활동 기록이 없습니다.`, EMBED_WARN));
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

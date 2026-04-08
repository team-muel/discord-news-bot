import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import { ensureFeatureAccess } from '../auth';
import { buildUserCard, EMBED_ERROR, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';
import { createUserPersonalComment, getUserPersonaSnapshot } from '../../services/userPersonaService';

type PersonaDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  hasAdminPermission: (interaction: ChatInputCommandInteraction) => Promise<boolean>;
  hasValidLoginSession: (guildId: string, userId: string) => Promise<boolean>;
  getErrorMessage: (error: unknown) => string;
};

const USER_CONTEXT_PROFILE_COMMAND = '유저 프로필 보기';
const USER_CONTEXT_NOTE_COMMAND = '유저 메모 추가';
const USER_NOTE_MODAL_ID_PREFIX = 'persona_note_modal:';
const NOTE_CONTENT_FIELD_ID = 'persona_note_content';
const NOTE_VISIBILITY_FIELD_ID = 'persona_note_visibility';

const isAdminLike = async (
  interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction | ModalSubmitInteraction,
  hasAdminPermission: PersonaDeps['hasAdminPermission'],
): Promise<boolean> => {
  return hasAdminPermission(interaction as unknown as ChatInputCommandInteraction);
};

const ensureContextAccess = async (
  interaction: UserContextMenuCommandInteraction | ModalSubmitInteraction,
  deps: PersonaDeps,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (!interaction.guildId) {
    return { ok: false, message: '길드에서만 사용할 수 있습니다.' };
  }

  if (await isAdminLike(interaction, deps.hasAdminPermission)) {
    return { ok: true };
  }

  const loggedIn = await deps.hasValidLoginSession(interaction.guildId, interaction.user.id);
  if (!loggedIn) {
    return { ok: false, message: '로그인이 필요합니다. `/로그인` 후 다시 시도해주세요.' };
  }

  return { ok: true };
};

export const createPersonaHandlers = (deps: PersonaDeps) => {
  const handleUserProfileCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard('유저 프로필', '길드에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('유저 프로필', '로그인이 필요합니다. `/로그인` 후 다시 시도해주세요.', EMBED_WARN), ephemeral: true });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const target = interaction.options.getUser('유저', true);
    if (!interaction.guildId) {
      await interaction.editReply(buildUserCard('유저 프로필', '길드 정보가 없어 조회할 수 없습니다.', EMBED_WARN));
      return;
    }

    try {
      const snapshot = await getUserPersonaSnapshot({
        guildId: interaction.guildId,
        targetUserId: target.id,
        requesterUserId: interaction.user.id,
        isAdmin: await deps.hasAdminPermission(interaction),
        relationLimit: 4,
        noteLimit: 4,
      });

      const isAdmin = await deps.hasAdminPermission(interaction);
      if (!isAdmin && target.id !== interaction.user.id) {
        await interaction.editReply(buildUserCard('유저 프로필', '다른 유저 프로필 조회는 관리자만 가능합니다.', EMBED_WARN));
        return;
      }

      const profile = snapshot.profile;
      const outbound = snapshot.relations.outbound.slice(0, 3)
        .map((row, idx) => `${idx + 1}. <@${row.userId}> aff=${row.affinity.toFixed(2)} trust=${row.trust.toFixed(2)} (${row.interactions}회)`);
      const inbound = snapshot.relations.inbound.slice(0, 3)
        .map((row, idx) => `${idx + 1}. <@${row.userId}> aff=${row.affinity.toFixed(2)} trust=${row.trust.toFixed(2)} (${row.interactions}회)`);
      const notes = snapshot.notes.slice(0, 3)
        .map((row, idx) => `${idx + 1}. ${row.summary.slice(0, 100)} (conf=${row.confidence.toFixed(2)})`);

      const lines = [
        `대상: <@${target.id}>`,
        profile?.summary ? `요약: ${profile.summary}` : '요약: 아직 명시적 프로필 요약이 없습니다.',
        profile?.communicationStyle ? `커뮤니케이션 스타일: ${profile.communicationStyle}` : '',
        profile?.preferredTopics?.length ? `선호 토픽: ${profile.preferredTopics.slice(0, 4).join(', ')}` : '',
        profile?.roleTags?.length ? `역할 태그: ${profile.roleTags.slice(0, 4).join(', ')}` : '',
        '',
        '[관계(아웃바운드)]',
        outbound.length > 0 ? outbound.join('\n') : '기록 없음',
        '',
        '[관계(인바운드)]',
        inbound.length > 0 ? inbound.join('\n') : '기록 없음',
        '',
        '[개인화 코멘트]',
        notes.length > 0 ? notes.join('\n') : '저장된 코멘트 없음',
        snapshot.noteVisibility.hidden > 0 ? `숨김 코멘트: ${snapshot.noteVisibility.hidden}개` : '',
      ].filter(Boolean).join('\n');

      await interaction.editReply(buildUserCard('유저 프로필 스냅샷', lines, EMBED_INFO));
    } catch (error) {
      await interaction.editReply(buildUserCard('유저 프로필', deps.getErrorMessage(error), EMBED_ERROR));
    }
  };

  const handleUserMemoCommand = async (interaction: ChatInputCommandInteraction, sub: string) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard('유저 메모', '길드에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('유저 메모', '로그인이 필요합니다. `/로그인` 후 다시 시도해주세요.', EMBED_WARN), ephemeral: true });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    if (!interaction.guildId) {
      await interaction.editReply(buildUserCard('유저 메모', '길드 정보가 없어 처리할 수 없습니다.', EMBED_WARN));
      return;
    }

    if (sub === '메모추가') {
      const target = interaction.options.getUser('유저', true);
      const comment = String(interaction.options.getString('코멘트', true) || '').trim();
      const visibility = String(interaction.options.getString('공개범위') || 'private') === 'public' ? 'guild' : 'private';
      const isAdmin = await deps.hasAdminPermission(interaction);
      if (!isAdmin && target.id !== interaction.user.id) {
        await interaction.editReply(buildUserCard('유저 메모', '다른 유저 메모는 관리자만 작성할 수 있습니다.', EMBED_WARN));
        return;
      }

      try {
        const saved = await createUserPersonalComment({
          guildId: interaction.guildId,
          targetUserId: target.id,
          authorUserId: interaction.user.id,
          channelId: interaction.channelId,
          content: comment,
          visibility,
        });

        await interaction.editReply(
          buildUserCard(
            '유저 메모 저장 완료',
            [`대상: <@${target.id}>`, `메모 ID: ${saved.id || 'n/a'}`, `가시성: ${saved.visibility}`, `코멘트: ${comment.slice(0, 180)}`].join('\n'),
            EMBED_SUCCESS,
          ),
        );
      } catch (error) {
        await interaction.editReply(buildUserCard('유저 메모', deps.getErrorMessage(error), EMBED_ERROR));
      }
      return;
    }

    if (sub === '메모조회') {
      const target = interaction.options.getUser('유저', true);
      const limit = Number(interaction.options.getInteger('개수') || 4);
      const isAdmin = await deps.hasAdminPermission(interaction);
      if (!isAdmin && target.id !== interaction.user.id) {
        await interaction.editReply(buildUserCard('유저 메모', '다른 유저 메모 조회는 관리자만 가능합니다.', EMBED_WARN));
        return;
      }

      try {
        const snapshot = await getUserPersonaSnapshot({
          guildId: interaction.guildId,
          targetUserId: target.id,
          requesterUserId: interaction.user.id,
          isAdmin,
          noteLimit: Math.max(1, Math.min(8, Math.trunc(limit))),
          relationLimit: 2,
        });

        const lines = snapshot.notes.length > 0
          ? snapshot.notes.map((row, idx) => `${idx + 1}. ${row.summary.slice(0, 140)} (conf=${row.confidence.toFixed(2)}, ${row.updatedAt.slice(0, 10)}, visibility=${row.visibility})`)
          : ['저장된 코멘트가 없습니다.'];

        if (snapshot.noteVisibility.hidden > 0) {
          lines.push(`(권한으로 숨겨진 코멘트 ${snapshot.noteVisibility.hidden}개)`);
        }

        await interaction.editReply(buildUserCard('유저 메모 조회', [`대상: <@${target.id}>`, '', ...lines].join('\n'), EMBED_INFO));
      } catch (error) {
        await interaction.editReply(buildUserCard('유저 메모', deps.getErrorMessage(error), EMBED_ERROR));
      }
      return;
    }

    await interaction.editReply(buildUserCard('유저 메모', '알 수 없는 서브커맨드입니다.', EMBED_WARN));
  };

  const handleUserContextCommand = async (interaction: UserContextMenuCommandInteraction) => {
    const access = await ensureContextAccess(interaction, deps);
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('유저', access.message, EMBED_WARN), ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ ...buildUserCard('유저', '길드 정보가 없어 처리할 수 없습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    if (interaction.commandName === USER_CONTEXT_PROFILE_COMMAND) {
      const isAdmin = await isAdminLike(interaction, deps.hasAdminPermission);
      const targetUserId = interaction.targetUser.id;
      if (!isAdmin && targetUserId !== interaction.user.id) {
        await interaction.reply({ ...buildUserCard('유저 프로필', '다른 유저 프로필 조회는 관리자만 가능합니다.', EMBED_WARN), ephemeral: true });
        return;
      }

      try {
        const snapshot = await getUserPersonaSnapshot({
          guildId: interaction.guildId,
          targetUserId,
          requesterUserId: interaction.user.id,
          isAdmin,
          relationLimit: 4,
          noteLimit: 4,
        });

        const profile = snapshot.profile;
        const noteLines = snapshot.notes.length > 0
          ? snapshot.notes.slice(0, 3).map((row, idx) => `${idx + 1}. ${row.summary.slice(0, 100)} (conf=${row.confidence.toFixed(2)})`)
          : ['저장된 코멘트 없음'];

        const lines = [
          `대상: <@${targetUserId}>`,
          profile?.summary ? `요약: ${profile.summary}` : '요약: 아직 명시적 프로필 요약이 없습니다.',
          profile?.communicationStyle ? `커뮤니케이션 스타일: ${profile.communicationStyle}` : '',
          '',
          '[개인화 코멘트]',
          ...noteLines,
          snapshot.noteVisibility.hidden > 0 ? `숨김 코멘트: ${snapshot.noteVisibility.hidden}개` : '',
        ].filter(Boolean).join('\n');

        await interaction.reply({ ...buildUserCard('유저 프로필 스냅샷', lines, EMBED_INFO), ephemeral: true });
      } catch (error) {
        await interaction.reply({ ...buildUserCard('유저 프로필', deps.getErrorMessage(error), EMBED_ERROR), ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === USER_CONTEXT_NOTE_COMMAND) {
      const targetUserId = interaction.targetUser.id;
      const isAdmin = await isAdminLike(interaction, deps.hasAdminPermission);
      if (!isAdmin && targetUserId !== interaction.user.id) {
        await interaction.reply({ ...buildUserCard('유저 메모', '다른 유저 메모 작성은 관리자만 가능합니다.', EMBED_WARN), ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`${USER_NOTE_MODAL_ID_PREFIX}${targetUserId}`)
        .setTitle('유저 개인화 메모 추가');

      const contentInput = new TextInputBuilder()
        .setCustomId(NOTE_CONTENT_FIELD_ID)
        .setLabel('코멘트')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1200)
        .setPlaceholder('예: 응답은 짧고 핵심 위주 선호, 오전 시간대 반응이 빠름');

      const visibilityInput = new TextInputBuilder()
        .setCustomId(NOTE_VISIBILITY_FIELD_ID)
        .setLabel('가시성 (private 또는 guild)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(12)
        .setPlaceholder('private');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(visibilityInput),
      );

      await interaction.showModal(modal);
      return;
    }

    await interaction.reply({ ...buildUserCard('유저', '알 수 없는 컨텍스트 메뉴 명령입니다.', EMBED_WARN), ephemeral: true });
  };

  const handleUserNoteModal = async (interaction: ModalSubmitInteraction) => {
    if (!interaction.customId.startsWith(USER_NOTE_MODAL_ID_PREFIX)) {
      return;
    }

    const access = await ensureContextAccess(interaction, deps);
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('유저 메모', access.message, EMBED_WARN), ephemeral: true });
      return;
    }

    const targetUserId = interaction.customId.slice(USER_NOTE_MODAL_ID_PREFIX.length).trim();
    const isAdmin = await isAdminLike(interaction, deps.hasAdminPermission);
    if (!isAdmin && targetUserId !== interaction.user.id) {
      await interaction.reply({ ...buildUserCard('유저 메모', '다른 유저 메모 작성은 관리자만 가능합니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const content = String(interaction.fields.getTextInputValue(NOTE_CONTENT_FIELD_ID) || '').trim();
    const rawVisibility = String(interaction.fields.getTextInputValue(NOTE_VISIBILITY_FIELD_ID) || 'private').trim().toLowerCase();
    const visibility = rawVisibility === 'guild' ? 'guild' : 'private';

    if (!interaction.guildId) {
      await interaction.reply({ ...buildUserCard('유저 메모', '길드 정보가 없어 처리할 수 없습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    try {
      const saved = await createUserPersonalComment({
        guildId: interaction.guildId,
        targetUserId,
        authorUserId: interaction.user.id,
        channelId: interaction.channelId || undefined,
        content,
        visibility,
      });

      await interaction.reply({
        ...buildUserCard('유저 메모 저장 완료', [`대상: <@${targetUserId}>`, `메모 ID: ${saved.id || 'n/a'}`, `가시성: ${saved.visibility}`, `코멘트: ${content.slice(0, 180)}`].join('\n'), EMBED_SUCCESS),
        ephemeral: true,
      });
    } catch (error) {
      const msg = deps.getErrorMessage(error);
      const friendly = msg.includes('SENSITIVE_COMMENT_BLOCKED')
        ? '민감 정보(연락처/비밀번호/토큰/식별정보)로 보이는 내용은 저장할 수 없습니다.'
        : msg;
      await interaction.reply({ ...buildUserCard('유저 메모', friendly, EMBED_ERROR), ephemeral: true });
    }
  };

  const handleUserCommand = async (interaction: ChatInputCommandInteraction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === '프로필') {
      await handleUserProfileCommand(interaction);
      return;
    }

    if (sub === '메모추가' || sub === '메모조회') {
      await handleUserMemoCommand(interaction, sub);
      return;
    }

    await interaction.reply({ ...buildUserCard('유저', '알 수 없는 서브커맨드입니다.', EMBED_WARN), ephemeral: true });
  };

  /** /프로필 [@유저] — 유저 생략 시 자신 */
  const handleProfileCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard('프로필', '길드에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('프로필', '먼저 `/유저`로 진단을 실행해주세요.', EMBED_WARN), ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('유저', false) ?? interaction.user;
    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    if (!interaction.guildId) {
      await interaction.editReply(buildUserCard('프로필', '길드 정보가 없어 조회할 수 없습니다.', EMBED_WARN));
      return;
    }

    const isAdmin = await deps.hasAdminPermission(interaction);
    if (!isAdmin && target.id !== interaction.user.id) {
      await interaction.editReply(buildUserCard('프로필', '다른 유저 프로필 조회는 관리자만 가능합니다.', EMBED_WARN));
      return;
    }

    try {
      const snapshot = await getUserPersonaSnapshot({
        guildId: interaction.guildId,
        targetUserId: target.id,
        requesterUserId: interaction.user.id,
        isAdmin,
        relationLimit: 4,
        noteLimit: 4,
      });

      const profile = snapshot.profile;
      const outbound = snapshot.relations.outbound.slice(0, 3)
        .map((row, idx) => `${idx + 1}. <@${row.userId}> aff=${row.affinity.toFixed(2)} trust=${row.trust.toFixed(2)} (${row.interactions}회)`);
      const inbound = snapshot.relations.inbound.slice(0, 3)
        .map((row, idx) => `${idx + 1}. <@${row.userId}> aff=${row.affinity.toFixed(2)} trust=${row.trust.toFixed(2)} (${row.interactions}회)`);
      const notes = snapshot.notes.slice(0, 3)
        .map((row, idx) => `${idx + 1}. ${row.summary.slice(0, 100)} (conf=${row.confidence.toFixed(2)})`);

      const lines = [
        `대상: <@${target.id}>`,
        profile?.summary ? `요약: ${profile.summary}` : '요약: 기록 없음',
        profile?.communicationStyle ? `스타일: ${profile.communicationStyle}` : '',
        profile?.preferredTopics?.length ? `선호 토픽: ${profile.preferredTopics.slice(0, 4).join(', ')}` : '',
        profile?.roleTags?.length ? `역할 태그: ${profile.roleTags.slice(0, 4).join(', ')}` : '',
        '',
        '[관계(아웃바운드)]',
        outbound.length > 0 ? outbound.join('\n') : '기록 없음',
        '',
        '[관계(인바운드)]',
        inbound.length > 0 ? inbound.join('\n') : '기록 없음',
        '',
        '[메모]',
        notes.length > 0 ? notes.join('\n') : '저장된 메모 없음',
        snapshot.noteVisibility.hidden > 0 ? `숨김 메모: ${snapshot.noteVisibility.hidden}개` : '',
      ].filter(Boolean).join('\n');

      await interaction.editReply(buildUserCard('프로필', lines, EMBED_INFO));
    } catch (error) {
      await interaction.editReply(buildUserCard('프로필', deps.getErrorMessage(error), EMBED_ERROR));
    }
  };

  /** /메모 <@유저> [내용] — 내용 있으면 추가, 없으면 조회 */
  const handleMemoCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard('메모', '길드에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard('메모', '먼저 `/유저`로 진단을 실행해주세요.', EMBED_WARN), ephemeral: true });
      return;
    }

    const target = interaction.options.getUser('유저', true);
    const content = (interaction.options.getString('내용', false) || '').trim();
    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    if (!interaction.guildId) {
      await interaction.editReply(buildUserCard('메모', '길드 정보가 없어 처리할 수 없습니다.', EMBED_WARN));
      return;
    }

    const isAdmin = await deps.hasAdminPermission(interaction);

    // 조회 모드
    if (!content) {
      if (!isAdmin && target.id !== interaction.user.id) {
        await interaction.editReply(buildUserCard('메모', '다른 유저 메모 조회는 관리자만 가능합니다.', EMBED_WARN));
        return;
      }
      try {
        const snapshot = await getUserPersonaSnapshot({
          guildId: interaction.guildId,
          targetUserId: target.id,
          requesterUserId: interaction.user.id,
          isAdmin,
          noteLimit: 6,
          relationLimit: 0,
        });
        const lines = snapshot.notes.length > 0
          ? snapshot.notes.map((row, idx) => `${idx + 1}. ${row.summary.slice(0, 140)}`)
          : ['저장된 메모가 없습니다.'];
        await interaction.editReply(buildUserCard('메모 조회', [`대상: <@${target.id}>`, '', ...lines].join('\n'), EMBED_INFO));
      } catch (error) {
        await interaction.editReply(buildUserCard('메모', deps.getErrorMessage(error), EMBED_ERROR));
      }
      return;
    }

    // 추가 모드
    if (!isAdmin && target.id !== interaction.user.id) {
      await interaction.editReply(buildUserCard('메모', '다른 유저 메모는 관리자만 작성할 수 있습니다.', EMBED_WARN));
      return;
    }
    const visibility = String(interaction.options.getString('공개범위') || 'private') === 'public' ? 'guild' : 'private';
    try {
      const saved = await createUserPersonalComment({
        guildId: interaction.guildId,
        targetUserId: target.id,
        authorUserId: interaction.user.id,
        channelId: interaction.channelId,
        content,
        visibility,
      });
      await interaction.editReply(buildUserCard('메모 저장', [`대상: <@${target.id}>`, `ID: ${saved.id || 'n/a'}`, `내용: ${content.slice(0, 180)}`].join('\n'), EMBED_SUCCESS));
    } catch (error) {
      const msg = deps.getErrorMessage(error);
      const friendly = msg.includes('SENSITIVE_COMMENT_BLOCKED')
        ? '민감 정보로 보이는 내용은 저장할 수 없습니다.'
        : msg;
      await interaction.editReply(buildUserCard('메모', friendly, EMBED_ERROR));
    }
  };

  return {
    handleUserCommand,
    handleUserContextCommand,
    handleUserNoteModal,
    handleProfileCommand,
    handleMemoCommand,
  };
};

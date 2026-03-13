import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { AgentSession } from '../../services/multiAgentService';
import { getAgentSession } from '../../services/multiAgentService';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';

type VibeDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  startVibeSession: (guildId: string, userId: string, request: string) => AgentSession;
  streamSessionProgress: (sink: { update: (content: string) => Promise<unknown> }, sessionId: string, goal: string, options: { showDebugBlocks: boolean; maxLinks: number }) => Promise<void>;
  tryPostCodeThread: (sourceMessage: Message, session: AgentSession, guildId: string) => Promise<void>;
  codeThreadEnabled: boolean;
  codingIntentPattern: RegExp;
  automationIntentPattern: RegExp;
  getErrorMessage: (error: unknown) => string;
};

const UTILITY_TASK_HINT_PATTERN = /(찾아|검색|분석|요약|정리|작성|만들|추천|조회|계획|실행|해줘|해 줘|please|search|find|analyze|summarize|build|create|plan|check)/i;
const fallbackRequestCache = new Map<string, string>();

const inferAiModeFromLabel = (value: string): 'ai_chat' | 'ai_utility' | 'off' | null => {
  const label = String(value || '').toLowerCase();
  if (!label) return null;
  if (/(^|[-_\s])ai[-_\s]?off($|[-_\s])|ai끔|ai-off/.test(label)) return 'off';
  if (/(^|[-_\s])ai[-_\s]?chat($|[-_\s])|ai채팅|ai-채팅/.test(label)) return 'ai_chat';
  if (/(^|[-_\s])ai[-_\s]?utility($|[-_\s])|ai유틸|ai-유틸/.test(label)) return 'ai_utility';
  return null;
};

const inferChannelModeFromName = (message: Message): 'ai_chat' | 'ai_utility' | 'off' | null => {
  const channelAny = message.channel as any;
  const channelName = String(channelAny?.name || '');
  const parentName = String(channelAny?.parent?.name || '');
  const categoryName = String(channelAny?.parent?.parent?.name || '');
  for (const probe of [categoryName, parentName, channelName]) {
    const mode = inferAiModeFromLabel(probe);
    if (mode) return mode;
  }
  return null;
};

const parseVibeRequestFromMessage = (message: Message): string => {
  let text = String(message.content || '').trim();
  if (!text) return '';
  if (message.client.user) {
    const mentionPattern = new RegExp(`^<@!?${message.client.user.id}>\\s*`, 'i');
    text = text.replace(mentionPattern, '').trim();
  }
  if (text.startsWith('해줘')) text = text.slice('해줘'.length).trim();
  if (text.startsWith(':')) text = text.slice(1).trim();
  return text;
};

export const createVibeHandlers = (deps: VibeDeps) => {
  const handleVibeCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({ ...buildUserCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const request = (interaction.options.getString('요청', true) || '').trim();
    if (!request) {
      await interaction.editReply(buildUserCard('입력 오류', '요청을 입력해주세요. 예: 고양이 영상 찾아줘', EMBED_WARN));
      return;
    }

    const cacheKey = `${interaction.guildId}:${interaction.user.id}`;
    let runtimeGoal = request;
    if (deps.codingIntentPattern.test(request)) {
      fallbackRequestCache.set(cacheKey, request);
      runtimeGoal = `코드로 구현해줘: ${request}`;
      await interaction.editReply(buildUserCard('💡 팁', [
        '코드·스크립트 작성 요청이시군요!',
        '`/해줘`에서 실행이 어렵거나 미구현된 요청은 `/만들어줘` 세션으로 자동 이관합니다.',
        '요청을 캐시하고 코드 세션을 바로 시작할게요.',
        '',
        '이번엔 그냥 진행할게요 👇',
      ].join('\n'), EMBED_INFO));
    }

    let session: AgentSession;
    try {
      session = deps.startVibeSession(interaction.guildId, interaction.user.id, runtimeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard('작업 시작 실패', deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard('요청 수락', [
      '요청을 이해했어요. 바로 진행할게요.',
      `세션: ${session.id}`,
      `요청: ${request}`,
      '완료 즉시 결과물만 전달합니다.',
    ].join('\n'), EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard('진행 상태', content, EMBED_INFO)) }, session.id, runtimeGoal, { showDebugBlocks: false, maxLinks: 2 });

    if (deps.codeThreadEnabled && shared) {
      const completed = getAgentSession(session.id);
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, interaction.guildId).catch(() => undefined);
          }
        } catch { /* best-effort */ }
      }
    }
  };

  const handleMakeCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({ ...buildUserCard('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const request = (interaction.options.getString('요청', true) || '').trim();
    if (!request) {
      await interaction.editReply(buildUserCard('입력 오류', '만들 내용을 입력해주세요. 예: Express 라우터 만들어줘', EMBED_WARN));
      return;
    }

    const codeGoal = deps.codingIntentPattern.test(request) ? request : `코드로 구현해줘: ${request}`;

    let session: AgentSession;
    try {
      session = deps.startVibeSession(interaction.guildId, interaction.user.id, codeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard('작업 시작 실패', deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard('💻 코드 작업 시작', [
      '요청을 이해했어요. 코드를 생성할게요.',
      `세션: ${session.id}`,
      `요청: ${request}`,
      shared ? '완료되면 이 채널에 코드 스레드를 만들어드릴게요 🧵' : '완료되면 결과를 알려드릴게요.',
    ].join('\n'), EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard('코드 생성 중', content, EMBED_INFO)) }, session.id, codeGoal, { showDebugBlocks: false, maxLinks: 2 });

    if (deps.codeThreadEnabled) {
      const completed = getAgentSession(session.id);
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, interaction.guildId).catch(() => undefined);
          }
        } catch { /* best-effort */ }
      }
    }

    if (deps.automationIntentPattern.test(request)) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`worker_propose:${session.id}:${encodeURIComponent(request.slice(0, 200))}`).setLabel('🚀 자동화 워커로 등록').setStyle(ButtonStyle.Secondary),
      );
      await interaction.followUp({
        content: '💡 이 코드를 자동화 워커로 서버에 등록할 수 있습니다. 관리자 검토 후 승인되면 즉시 활성화됩니다.',
        components: [row],
        ephemeral: true,
      });
    }
  };

  const handleVibeMessage = async (message: Message) => {
    if (!message.guildId || message.author.bot || !message.client.user) return;

    const raw = String(message.content || '').trim();
    const channelMode = inferChannelModeFromName(message);
    if (channelMode === 'off') return;

    const isAiChatChannel = channelMode === 'ai_chat';
    const isMentioned = message.mentions.has(message.client.user.id);
    const isReplyToBot = message.reference?.messageId && message.mentions.repliedUser?.id === message.client.user.id;
    const isPrefixed = raw.toLowerCase().startsWith('해줘');
    if (!isAiChatChannel && !isMentioned && !isReplyToBot && !isPrefixed) return;

    const request = parseVibeRequestFromMessage(message);
    if (!request) {
      await message.reply('원하는 작업을 함께 적어주세요. 예: `@봇이름 고양이 영상 찾아줘`');
      return;
    }

    if (channelMode === 'ai_utility' && !UTILITY_TASK_HINT_PATTERN.test(request)) {
      await message.reply('이 채널은 AI 유틸리티 채널입니다. 작업형 요청으로 입력해주세요. 예: `뉴스 요약해줘`, `고양이 영상 찾아줘`');
      return;
    }

    const progressMessage = await message.reply(['요청을 이해했어요. 바로 진행할게요.', `요청: ${request}`, '완료 즉시 결과물만 전달합니다.'].join('\n'));

    let session: AgentSession;
    try {
      session = deps.startVibeSession(message.guildId, message.author.id, request);
    } catch (error) {
      await progressMessage.edit(`작업 시작 실패: ${deps.getErrorMessage(error)}`);
      return;
    }

    await progressMessage.edit(['요청을 이해했어요. 바로 진행할게요.', `세션: ${session.id}`, `요청: ${request}`, '완료 즉시 결과물만 전달합니다.'].join('\n'));

    await deps.streamSessionProgress({ update: (content) => progressMessage.edit(content) }, session.id, request, { showDebugBlocks: false, maxLinks: 2 });

    if (deps.codeThreadEnabled) {
      const completed = getAgentSession(session.id);
      if (completed?.status === 'completed') {
        await deps.tryPostCodeThread(progressMessage, completed, message.guildId).catch(() => undefined);
      }
    }
  };

  return { handleVibeCommand, handleMakeCommand, handleVibeMessage };
};

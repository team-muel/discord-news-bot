import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { AgentSession } from '../../services/multiAgentService';
import { getAgentSession } from '../../services/multiAgentService';
import { DISCORD_MESSAGES } from '../messages';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';
import { ensureFeatureAccess } from '../auth';

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
const MISSING_TOOL_SIGNAL_PATTERN = /(ACTION_NOT_IMPLEMENTED|DYNAMIC_WORKER_NOT_FOUND|unsupported job type|missing_action=([1-9]\d*))/i;
const fallbackRequestCache = new Map<string, string>();
const PROCESSED_MESSAGE_TTL_MS = Math.max(30_000, Number(process.env.VIBE_MESSAGE_DEDUP_TTL_MS || 5 * 60_000));
const processedMessageUntilMs = new Map<string, number>();

const shouldProcessMessage = (messageId: string): boolean => {
  const now = Date.now();
  const expiresAt = processedMessageUntilMs.get(messageId) || 0;
  if (expiresAt > now) {
    return false;
  }

  // Opportunistic cleanup to keep the map bounded.
  if (processedMessageUntilMs.size > 500) {
    for (const [id, until] of processedMessageUntilMs.entries()) {
      if (until <= now) {
        processedMessageUntilMs.delete(id);
      }
    }
  }

  processedMessageUntilMs.set(messageId, now + PROCESSED_MESSAGE_TTL_MS);
  return true;
};

const extractDiagnosticCount = (resultText: string, key: string): number => {
  const regex = new RegExp(`${key}=([0-9]+)`, 'i');
  const match = String(resultText || '').match(regex);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
};

const shouldSuggestWorkerProposal = (request: string, resultText: string): boolean => {
  const missingAction = extractDiagnosticCount(resultText, 'missing_action');
  const policyBlocked = extractDiagnosticCount(resultText, 'policy_blocked');

  if (policyBlocked > 0 && missingAction === 0) {
    return false;
  }

  if (UTILITY_TASK_HINT_PATTERN.test(request) && /(자동화|integration|ping|status|monitor|체크|확인|연동|api|worker|툴|tool)/i.test(request)) {
    return true;
  }

  return MISSING_TOOL_SIGNAL_PATTERN.test(resultText);
};

const shouldSuggestPolicyGuidance = (resultText: string): boolean => {
  const missingAction = extractDiagnosticCount(resultText, 'missing_action');
  const policyBlocked = extractDiagnosticCount(resultText, 'policy_blocked');
  return policyBlocked > 0 && missingAction === 0;
};

const buildWorkerProposalRow = (sessionId: string, request: string) => {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`worker_propose:${sessionId}:${encodeURIComponent(request.slice(0, 200))}`)
      .setLabel('🚀 자동화 워커로 등록')
      .setStyle(ButtonStyle.Secondary),
  );
};

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
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN), ephemeral: true });
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }
    const accessNotice = access.autoLoggedIn ? `\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const request = (interaction.options.getString('요청', true) || '').trim();
    if (!request) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleInputError, DISCORD_MESSAGES.vibe.inputExampleAsk, EMBED_WARN));
      return;
    }

    const cacheKey = `${interaction.guildId}:${interaction.user.id}`;
    let runtimeGoal = request;
    if (deps.codingIntentPattern.test(request)) {
      fallbackRequestCache.set(cacheKey, request);
      runtimeGoal = `코드로 구현해줘: ${request}`;
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.tipTitle, DISCORD_MESSAGES.vibe.tipLines.join('\n'), EMBED_INFO));
    }

    let session: AgentSession;
    try {
      session = deps.startVibeSession(guildId, interaction.user.id, runtimeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleStartFailed, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleAccepted, `${DISCORD_MESSAGES.vibe.acceptedLines(session.id, request).join('\n')}${accessNotice}`, EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleProgress, content, EMBED_INFO)) }, session.id, runtimeGoal, { showDebugBlocks: false, maxLinks: 2 });

    const completed = getAgentSession(session.id);
    const resultText = String(completed?.result || '');
    if (shouldSuggestPolicyGuidance(resultText)) {
      await interaction.followUp({
        content: `⚠️ ${DISCORD_MESSAGES.vibe.policyBlockedHint}`,
        ephemeral: true,
      }).catch(() => undefined);
    }
    if (shouldSuggestWorkerProposal(request, resultText)) {
      await interaction.followUp({
        content: `💡 ${DISCORD_MESSAGES.vibe.workerHint}`,
        components: [buildWorkerProposalRow(session.id, request)],
        ephemeral: true,
      }).catch(() => undefined);
    }

    if (deps.codeThreadEnabled && shared) {
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, guildId).catch(() => undefined);
          }
        } catch { /* best-effort */ }
      }
    }
  };

  const handleMakeCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }
    if (!access.ok) {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN), ephemeral: true });
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ ...buildUserCard(DISCORD_MESSAGES.vibe.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }
    const accessNotice = access.autoLoggedIn ? `\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const request = (interaction.options.getString('요청', true) || '').trim();
    if (!request) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleInputError, DISCORD_MESSAGES.vibe.inputExampleMake, EMBED_WARN));
      return;
    }

    const codeGoal = deps.codingIntentPattern.test(request) ? request : `코드로 구현해줘: ${request}`;

    let session: AgentSession;
    try {
      session = deps.startVibeSession(guildId, interaction.user.id, codeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleStartFailed, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleCodeStart, `${DISCORD_MESSAGES.vibe.codeStartLines(session.id, request, shared).join('\n')}${accessNotice}`, EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleCodeProgress, content, EMBED_INFO)) }, session.id, codeGoal, { showDebugBlocks: false, maxLinks: 2 });

    if (deps.codeThreadEnabled) {
      const completed = getAgentSession(session.id);
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, guildId).catch(() => undefined);
          }
        } catch { /* best-effort */ }
      }
    }

    if (deps.automationIntentPattern.test(request)) {
      await interaction.followUp({
        content: `💡 ${DISCORD_MESSAGES.vibe.workerHint}`,
        components: [buildWorkerProposalRow(session.id, request)],
        ephemeral: true,
      });
    }
  };

  const handleVibeMessage = async (message: Message) => {
    if (!message.guildId || message.author.bot || !message.client.user) return;

    if (!shouldProcessMessage(message.id)) {
      return;
    }

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
      await message.reply(DISCORD_MESSAGES.vibe.mentionPrompt);
      return;
    }

    if (channelMode === 'ai_utility' && !UTILITY_TASK_HINT_PATTERN.test(request)) {
      await message.reply(DISCORD_MESSAGES.vibe.utilityOnlyPrompt);
      return;
    }

    const progressMessage = await message.reply(DISCORD_MESSAGES.vibe.acceptedNoSessionLines(request).join('\n'));

    let session: AgentSession;
    try {
      session = deps.startVibeSession(message.guildId, message.author.id, request);
    } catch (error) {
      await progressMessage.edit(DISCORD_MESSAGES.vibe.startFailedInline(deps.getErrorMessage(error)));
      return;
    }

    await progressMessage.edit(DISCORD_MESSAGES.vibe.acceptedLines(session.id, request).join('\n'));

    await deps.streamSessionProgress({ update: (content) => progressMessage.edit(content) }, session.id, request, { showDebugBlocks: false, maxLinks: 2 });

    const completed = getAgentSession(session.id);
    const resultText = String(completed?.result || '');
    if (shouldSuggestPolicyGuidance(resultText)) {
      await message.reply(`⚠️ ${DISCORD_MESSAGES.vibe.policyBlockedHint}`).catch(() => undefined);
    }
    if (shouldSuggestWorkerProposal(request, resultText)) {
      await message.reply({
        content: `💡 ${DISCORD_MESSAGES.vibe.workerHint}`,
        components: [buildWorkerProposalRow(session.id, request)],
      }).catch(() => undefined);
    }

    if (deps.codeThreadEnabled) {
      if (completed?.status === 'completed') {
        await deps.tryPostCodeThread(progressMessage, completed, message.guildId).catch(() => undefined);
      }
    }
  };

  return { handleVibeCommand, handleMakeCommand, handleVibeMessage };
};

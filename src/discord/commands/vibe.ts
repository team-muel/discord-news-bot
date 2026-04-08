import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { type AgentSession, getAgentSession } from '../../services/multiAgentService';
import { DISCORD_MESSAGES } from '../messages';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';
import { ensureFeatureAccess } from '../auth';
import { DISCORD_VIBE_DEDUP_MAX_ENTRIES, DISCORD_VIBE_WORKER_REQUEST_CLIP, DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES } from '../runtimePolicy';
import { seedFeedbackReactions } from '../session';
import logger from '../../logger';
import { acquireDistributedLease } from '../../services/infra/distributedLockService';
import {
  VIBE_MESSAGE_DEDUP_TTL_MS,
  VIBE_AUTO_WORKER_PROPOSAL_ENABLED,
  VIBE_AUTO_WORKER_PROPOSAL_COOLDOWN_MS,
} from '../../config';

// ── Quick-intent patterns: intercept simple conversational queries before Sprint ──
// These bypass the full Sprint pipeline and go directly to generateText().
const QUICK_INTENT_PATTERN = /^(안녕|하이|ㅎㅇ|반가|뭐해|뭐하고|오늘.*날씨|날씨.*어때|지금.*몇시|몇 시|시간.*알려|오늘.*뭐|봇.*살아|살아.*있어|테스트|ping|hello|hi\b)/i;
// Short messages (≤30 chars) that are clearly just casual chat also qualify
const isQuickConversation = (text: string): boolean =>
  QUICK_INTENT_PATTERN.test(text) || (text.length <= 30 && /[?!？！]$/.test(text) && !/스프린트|분석|구현|만들|작성|검색|정리|요약/.test(text));

type VibeDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  startVibeSession: (guildId: string, userId: string, request: string) => Promise<AgentSession>;
  streamSessionProgress: (sink: { update: (content: string) => Promise<unknown> }, sessionId: string, goal: string, options: { showDebugBlocks: boolean; maxLinks: number }) => Promise<void>;
  tryPostCodeThread: (sourceMessage: Message, session: AgentSession, guildId: string) => Promise<void>;
  codeThreadEnabled: boolean;
  codingIntentPattern: RegExp;
  automationIntentPattern: RegExp;
  getErrorMessage: (error: unknown) => string;
  autoProposeWorker?: (params: {
    guildId: string;
    requestedBy: string;
    request: string;
    sessionId: string;
  }) => Promise<{ ok: boolean; approvalId?: string; error?: string }>;
};

const UTILITY_TASK_HINT_PATTERN = /(찾아|검색|분석|요약|정리|작성|만들|추천|조회|계획|실행|해줘|해 줘|please|search|find|analyze|summarize|build|create|plan|check)/i;
const MISSING_TOOL_SIGNAL_PATTERN = /(ACTION_NOT_IMPLEMENTED|DYNAMIC_WORKER_NOT_FOUND|unsupported job type|missing_action=([1-9]\d*))/i;
const VIBE_MESSAGE_PREFIX_PATTERN = /^뮤엘(?:아)?(?:(?:\s*:\s*)|\s+|$)/;
const PROCESSED_MESSAGE_TTL_MS = VIBE_MESSAGE_DEDUP_TTL_MS;
const processedMessageUntilMs = new Map<string, number>();
const VIBE_INSTANCE_ID = Math.random().toString(36).slice(2);
const AUTO_WORKER_PROPOSAL_ENABLED = VIBE_AUTO_WORKER_PROPOSAL_ENABLED;
const AUTO_WORKER_PROPOSAL_COOLDOWN_MS = VIBE_AUTO_WORKER_PROPOSAL_COOLDOWN_MS;
const autoWorkerProposalUntilMs = new Map<string, number>();

const logVibeNonCritical = (scope: string, error: unknown, getErrorMessage: (error: unknown) => string): void => {
  logger.debug('[VIBE] %s: %s', scope, getErrorMessage(error));
};

const shouldProcessMessage = (messageId: string): boolean => {
  const now = Date.now();
  const expiresAt = processedMessageUntilMs.get(messageId) || 0;
  if (expiresAt > now) {
    return false;
  }

  // Opportunistic cleanup to keep the map bounded.
  if (processedMessageUntilMs.size > DISCORD_VIBE_DEDUP_MAX_ENTRIES) {
    for (const [id, until] of processedMessageUntilMs.entries()) {
      if (until <= now) {
        processedMessageUntilMs.delete(id);
      }
    }
    // Hard cap: evict oldest if still over limit
    if (processedMessageUntilMs.size > DISCORD_VIBE_DEDUP_MAX_ENTRIES) {
      const excess = processedMessageUntilMs.size - DISCORD_VIBE_DEDUP_MAX_ENTRIES;
      let removed = 0;
      for (const key of processedMessageUntilMs.keys()) {
        if (removed >= excess) break;
        processedMessageUntilMs.delete(key);
        removed++;
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

const shouldAutoProposeWorker = (request: string, resultText: string): boolean => {
  if (!AUTO_WORKER_PROPOSAL_ENABLED) {
    return false;
  }

  const missingAction = extractDiagnosticCount(resultText, 'missing_action');
  if (missingAction > 0) {
    return true;
  }

  return MISSING_TOOL_SIGNAL_PATTERN.test(resultText)
    && /(자동화|integration|worker|툴|tool|api|연동|monitor|status|체크|확인)/i.test(request);
};

const acquireAutoProposalSlot = (key: string): boolean => {
  const now = Date.now();
  const expiresAt = autoWorkerProposalUntilMs.get(key) || 0;
  if (expiresAt > now) {
    return false;
  }
  autoWorkerProposalUntilMs.set(key, now + AUTO_WORKER_PROPOSAL_COOLDOWN_MS);

  // Opportunistic cleanup to keep the map bounded
  if (autoWorkerProposalUntilMs.size > DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES) {
    for (const [id, until] of autoWorkerProposalUntilMs.entries()) {
      if (until <= now) autoWorkerProposalUntilMs.delete(id);
    }
  }

  return true;
};

const formatAutoProposalError = (error: string): string => {
  const text = String(error || '').trim();
  if (!text) {
    return '알 수 없는 오류';
  }
  if (text.startsWith('AUTO_PROPOSAL_DAILY_CAP_REACHED')) {
    return '오늘 자동 제안 상한에 도달했습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (text === 'AUTO_PROPOSAL_DUPLICATE_RECENT') {
    return '동일한 요청에 대한 최근 자동 제안이 이미 존재합니다.';
  }
  if (text.startsWith('AUTO_PROPOSAL_PROMOTION_THRESHOLD')) {
    return '자동 승격 기준(요청 빈도/요청자 다양성/품질/정책 차단률)을 아직 충족하지 않아 이번에는 일회성 처리로 유지합니다.';
  }
  if (text.startsWith('AUTO_PROPOSAL_QUALITY_GUARD')) {
    return '최근 자동 생성 품질이 낮아 자동 제안을 잠시 보류합니다.';
  }
  return text;
};

const shouldSuggestPolicyGuidance = (resultText: string): boolean => {
  const missingAction = extractDiagnosticCount(resultText, 'missing_action');
  const policyBlocked = extractDiagnosticCount(resultText, 'policy_blocked');
  return policyBlocked > 0 && missingAction === 0;
};

const buildWorkerProposalRow = (sessionId: string, request: string) => {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`worker_propose:${sessionId}:${encodeURIComponent(request.slice(0, DISCORD_VIBE_WORKER_REQUEST_CLIP))}`)
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
  const ch = message.channel as unknown as Record<string, unknown>;
  const channelName = String(ch?.name || '');
  const parent = ch?.parent as Record<string, unknown> | null;
  const parentName = String(parent?.name || '');
  const grandparent = parent?.parent as Record<string, unknown> | null;
  const categoryName = String(grandparent?.name || '');
  for (const probe of [categoryName, parentName, channelName]) {
    const mode = inferAiModeFromLabel(probe);
    if (mode) return mode;
  }
  return null;
};

export const hasVibeMessagePrefix = (text: string): boolean => VIBE_MESSAGE_PREFIX_PATTERN.test(String(text || '').trim());

export const stripVibeMessagePrefix = (text: string): string => {
  let normalized = String(text || '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(VIBE_MESSAGE_PREFIX_PATTERN, '').trim();
  if (normalized.startsWith(':')) normalized = normalized.slice(1).trim();
  return normalized;
};

export const parseVibeRequestFromMessage = (message: Message): string => {
  let text = String(message.content || '').trim();
  if (!text) return '';
  if (message.client.user) {
    const mentionPattern = new RegExp(`^<@!?${message.client.user.id}>\\s*`, 'i');
    text = text.replace(mentionPattern, '').trim();
  }
  return stripVibeMessagePrefix(text);
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

    let runtimeGoal = request;
    if (deps.codingIntentPattern.test(request)) {
      runtimeGoal = `코드로 구현해줘: ${request}`;
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.tipTitle, DISCORD_MESSAGES.vibe.tipLines.join('\n'), EMBED_INFO));
    }

    let session: AgentSession;
    try {
      session = await deps.startVibeSession(guildId, interaction.user.id, runtimeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleStartFailed, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleAccepted, `${DISCORD_MESSAGES.vibe.acceptedLines(session.id, request).join('\n')}${accessNotice}`, EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleProgress, content, EMBED_INFO)) }, session.id, runtimeGoal, { showDebugBlocks: false, maxLinks: 2 });

    const completed = getAgentSession(session.id);
    if (completed?.status === 'completed' || completed?.status === 'failed') {
      const replyForSeed = await interaction.fetchReply().catch(() => null);
      await seedFeedbackReactions(replyForSeed);
    }
    const resultText = String(completed?.result || '');
    if (shouldSuggestPolicyGuidance(resultText)) {
      await interaction.followUp({
        content: `⚠️ ${DISCORD_MESSAGES.vibe.policyBlockedHint}`,
        ephemeral: true,
      }).catch((error) => logVibeNonCritical('followUp(policy hint) failed', error, deps.getErrorMessage));
    }
    if (shouldSuggestWorkerProposal(request, resultText)) {
      let autoProposalLine = '';
      if (deps.autoProposeWorker && shouldAutoProposeWorker(request, resultText)) {
        const autoKey = `${guildId}:${interaction.user.id}:${request.slice(0, 80).toLowerCase()}`;
        if (acquireAutoProposalSlot(autoKey)) {
          const autoResult = await deps.autoProposeWorker({
            guildId,
            requestedBy: interaction.user.id,
            request,
            sessionId: session.id,
          }).catch((error) => ({ ok: false, error: deps.getErrorMessage(error) }));
          autoProposalLine = autoResult.ok
            ? `\n자동 제안 생성 완료 (승인 ID: \`${('approvalId' in autoResult && autoResult.approvalId) ? autoResult.approvalId : 'n/a'}\`)`
            : `\n자동 제안 생성 실패: ${formatAutoProposalError(String(autoResult.error || 'unknown'))}`;
        }
      }

      await interaction.followUp({
        content: `💡 ${DISCORD_MESSAGES.vibe.workerHint}${autoProposalLine}`,
        components: [buildWorkerProposalRow(session.id, request)],
        ephemeral: true,
      }).catch((error) => logVibeNonCritical('followUp(worker hint) failed', error, deps.getErrorMessage));
    }

    if (deps.codeThreadEnabled && shared) {
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, guildId).catch((error) => {
              logger.debug('[VIBE] code thread posting failed (ask command): %s', deps.getErrorMessage(error));
            });
          }
        } catch (error) {
          logger.debug('[VIBE] fetchReply/startThread failed (ask command): %s', deps.getErrorMessage(error));
        }
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
      session = await deps.startVibeSession(guildId, interaction.user.id, codeGoal);
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleStartFailed, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    await interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleCodeStart, `${DISCORD_MESSAGES.vibe.codeStartLines(session.id, request, shared).join('\n')}${accessNotice}`, EMBED_INFO));

    await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildUserCard(DISCORD_MESSAGES.vibe.titleCodeProgress, content, EMBED_INFO)) }, session.id, codeGoal, { showDebugBlocks: false, maxLinks: 2 });

    {
      const makeCompleted = getAgentSession(session.id);
      if (makeCompleted?.status === 'completed' || makeCompleted?.status === 'failed') {
        const replyForSeed = await interaction.fetchReply().catch(() => null);
        await seedFeedbackReactions(replyForSeed);
      }
    }

    if (deps.codeThreadEnabled) {
      const completed = getAgentSession(session.id);
      if (completed?.status === 'completed') {
        try {
          const replyMsg = await interaction.fetchReply();
          if (replyMsg && 'startThread' in replyMsg) {
            await deps.tryPostCodeThread(replyMsg as Message, completed, guildId).catch((error) => {
              logger.debug('[VIBE] code thread posting failed (make command): %s', deps.getErrorMessage(error));
            });
          }
        } catch (error) {
          logger.debug('[VIBE] fetchReply/startThread failed (make command): %s', deps.getErrorMessage(error));
        }
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

    // Distributed dedup: prevents multiple Render instances from handling the same message.
    // Falls back to in-memory dedup gracefully if Supabase is unavailable.
    const distLock = await acquireDistributedLease({
      name: `vibe:msg:${message.id}`,
      owner: VIBE_INSTANCE_ID,
      leaseMs: PROCESSED_MESSAGE_TTL_MS,
    });
    if (!distLock.ok && distLock.reason === 'LOCK_HELD') {
      processedMessageUntilMs.delete(message.id);
      return;
    }

    const raw = String(message.content || '').trim();
    const channelMode = inferChannelModeFromName(message);
    if (channelMode === 'off') return;

    const isAiChatChannel = channelMode === 'ai_chat';
    const isMentioned = message.mentions.has(message.client.user.id);
    const isReplyToBot = message.reference?.messageId && message.mentions.repliedUser?.id === message.client.user.id;
    const isPrefixed = hasVibeMessagePrefix(raw);
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

    // ── Quick-intent router: simple conversation handled directly via LLM ──
    // Bypasses the full Sprint pipeline for casual chat to reduce latency.
    if (isQuickConversation(request)) {
      try {
        const { generateText, isAnyLlmConfigured } = await import('../../services/llm/client');
        if (isAnyLlmConfigured()) {
          const reply = await generateText({
            system: '당신은 디스코드 커뮤니티의 Muel 봇입니다. 짧고 자연스럽게 한국어로 대답하세요(2문장 이하).',
            user: request,
            maxTokens: 150,
            temperature: 0.8,
          });
          const replyText = String(reply || '').trim();
          if (replyText) {
            await message.reply(replyText);
            return;
          }
        }
      } catch (err) {
        logger.debug('[VIBE] quick-intent LLM failed, falling through to Sprint: %s', deps.getErrorMessage(err));
      }
    }

    const progressMessage = await message.reply(DISCORD_MESSAGES.vibe.acceptedNoSessionLines(request).join('\n'));

    let session: AgentSession;
    try {
      session = await deps.startVibeSession(message.guildId, message.author.id, request);
    } catch (error) {
      await progressMessage.edit(DISCORD_MESSAGES.vibe.startFailedInline(deps.getErrorMessage(error)));
      return;
    }

    await progressMessage.edit(DISCORD_MESSAGES.vibe.acceptedLines(session.id, request).join('\n'));

    await deps.streamSessionProgress({ update: (content) => progressMessage.edit(content) }, session.id, request, { showDebugBlocks: false, maxLinks: 2 });

    const completed = getAgentSession(session.id);
    if (completed?.status === 'completed' || completed?.status === 'failed') {
      await seedFeedbackReactions(progressMessage);
    }
    const resultText = String(completed?.result || '');
    if (shouldSuggestPolicyGuidance(resultText)) {
      await message.reply(`⚠️ ${DISCORD_MESSAGES.vibe.policyBlockedHint}`).catch((error) => {
        logVibeNonCritical('message.reply(policy hint) failed', error, deps.getErrorMessage);
      });
    }
    if (shouldSuggestWorkerProposal(request, resultText)) {
      let autoProposalLine = '';
      if (deps.autoProposeWorker && shouldAutoProposeWorker(request, resultText)) {
        const autoKey = `${message.guildId}:${message.author.id}:${request.slice(0, 80).toLowerCase()}`;
        if (acquireAutoProposalSlot(autoKey)) {
          const autoResult = await deps.autoProposeWorker({
            guildId: message.guildId,
            requestedBy: message.author.id,
            request,
            sessionId: session.id,
          }).catch((error) => ({ ok: false, error: deps.getErrorMessage(error) }));
          autoProposalLine = autoResult.ok
            ? `\n자동 제안 생성 완료 (승인 ID: \`${('approvalId' in autoResult && autoResult.approvalId) ? autoResult.approvalId : 'n/a'}\`)`
            : `\n자동 제안 생성 실패: ${formatAutoProposalError(String(autoResult.error || 'unknown'))}`;
        }
      }

      await message.reply({
        content: `💡 ${DISCORD_MESSAGES.vibe.workerHint}${autoProposalLine}`,
        components: [buildWorkerProposalRow(session.id, request)],
      }).catch((error) => {
        logVibeNonCritical('message.reply(worker hint) failed', error, deps.getErrorMessage);
      });
    }

    if (deps.codeThreadEnabled) {
      if (completed?.status === 'completed') {
        await deps.tryPostCodeThread(progressMessage, completed, message.guildId).catch((error) => {
          logVibeNonCritical('code thread posting failed (message mode)', error, deps.getErrorMessage);
        });
      }
    }
  };

  return { handleVibeCommand, handleMakeCommand, handleVibeMessage };
};

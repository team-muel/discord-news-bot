import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { type AgentSession, getAgentSession } from '../../services/multiAgentService';
import { DISCORD_MESSAGES } from '../messages';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';
import { ensureFeatureAccess } from '../auth';
import { DISCORD_VIBE_DEDUP_MAX_ENTRIES, DISCORD_VIBE_WORKER_REQUEST_CLIP, DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES } from '../runtimePolicy';
import { seedFeedbackReactions } from '../session';
import {
  isLowSignalPrompt,
  isQuickConversation,
  UTILITY_TASK_HINT_PATTERN,
} from '../muelEntryPolicy';
import { sanitizeDiscordUserFacingText } from '../userFacingSanitizer';
import logger from '../../logger';
import { acquireDistributedLease } from '../../services/infra/distributedLockService';
import type { DiscordIngressExecutionHandler } from '../runtime/discordIngressAdapter';
import { tryHandleDiscordChatSdkPrefixedMessage } from '../runtime/chatSdkRuntime';
import {
  VIBE_MESSAGE_DEDUP_TTL_MS,
  VIBE_AUTO_WORKER_PROPOSAL_ENABLED,
  VIBE_AUTO_WORKER_PROPOSAL_COOLDOWN_MS,
} from '../../config';

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
  executePrefixedMessageIngress?: DiscordIngressExecutionHandler;
};

type PrefixedMessageIngressRequestV1 = {
  request: string;
  guildId: string;
  userId: string;
  channel: Message['channel'];
  messageId: string;
  correlationId: string;
  entryLabel: string;
};

type MessageIngressResponsePayload = {
  content: string;
  seedFeedback?: boolean;
};

type VibeResponseTone = 'info' | 'warn' | 'error';

type VibeResponsePayload = {
  title?: string;
  body: string;
  tone?: VibeResponseTone;
  seedFeedback?: boolean;
  components?: ActionRowBuilder<ButtonBuilder>[];
  ephemeral?: boolean;
};

type MessageIngressResponseSinkV1 = {
  ack: () => Promise<void>;
  updateProgress: (payload: MessageIngressResponsePayload) => Promise<void>;
  final: (payload: MessageIngressResponsePayload) => Promise<void>;
  followUp: (payload: MessageIngressResponsePayload) => Promise<void>;
};

type VibeResponseSink = {
  ack: (payload?: VibeResponsePayload) => Promise<void>;
  updateProgress: (payload: VibeResponsePayload) => Promise<Message | null>;
  final: (payload: VibeResponsePayload) => Promise<Message | null>;
  followUp: (payload: VibeResponsePayload) => Promise<void>;
  getPrimaryReply: () => Promise<Message | null>;
};

const MISSING_TOOL_SIGNAL_PATTERN = /(ACTION_NOT_IMPLEMENTED|DYNAMIC_WORKER_NOT_FOUND|unsupported job type|missing_action=([1-9]\d*))/i;
const VIBE_MESSAGE_PREFIX_PATTERN = /^뮤엘(?:아)?(?:(?:\s*:\s*)|\s+|$)/;
const MESSAGE_INGRESS_REPLY_LIMIT = 1_800;
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

const resolveVibeCommandRequest = (interaction: ChatInputCommandInteraction): string => {
  return String(
    interaction.options.getString('요청', false)
    || interaction.options.getString('질문', false)
    || '',
  ).trim();
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

const clipMessageIngressContent = (value: string): string => {
  return String(value || '').trim().slice(0, MESSAGE_INGRESS_REPLY_LIMIT);
};

const VIBE_EMBED_BY_TONE = {
  info: EMBED_INFO,
  warn: EMBED_WARN,
  error: EMBED_ERROR,
} as const;

const resolveVibeRuntimeGoal = (
  request: string,
  codingIntentPattern: RegExp,
): { runtimeGoal: string; showCodingTip: boolean } => {
  const normalized = String(request || '').trim();
  if (!normalized) {
    return {
      runtimeGoal: '',
      showCodingTip: false,
    };
  }

  if (codingIntentPattern.test(normalized)) {
    return {
      runtimeGoal: `코드로 구현해줘: ${normalized}`,
      showCodingTip: true,
    };
  }

  return {
    runtimeGoal: normalized,
    showCodingTip: false,
  };
};

const createInteractionVibeResponseSink = (
  interaction: ChatInputCommandInteraction,
  shared: boolean,
): VibeResponseSink => {
  let acked = false;
  let primaryReply: Message | null = null;

  const ensureAcked = async () => {
    if (acked) {
      return;
    }

    await interaction.deferReply({ ephemeral: !shared });
    acked = true;
  };

  const editPrimaryReply = async (payload: VibeResponsePayload): Promise<Message | null> => {
    await ensureAcked();

    if (payload.title) {
      await interaction.editReply(buildUserCard(payload.title, payload.body, VIBE_EMBED_BY_TONE[payload.tone || 'info']));
    } else {
      await interaction.editReply({
        content: payload.body,
        components: payload.components,
      });
    }

    primaryReply = await interaction.fetchReply().catch(() => null);
    if (payload.seedFeedback && primaryReply) {
      await seedFeedbackReactions(primaryReply).catch(() => {});
    }

    return primaryReply;
  };

  return {
    ack: async (payload) => {
      await ensureAcked();
      if (payload) {
        await editPrimaryReply(payload);
      }
    },
    updateProgress: editPrimaryReply,
    final: editPrimaryReply,
    followUp: async (payload) => {
      await ensureAcked();
      if (payload.title) {
        await interaction.followUp({
          ...buildUserCard(payload.title, payload.body, VIBE_EMBED_BY_TONE[payload.tone || 'info']),
          components: payload.components,
          ephemeral: payload.ephemeral ?? !shared,
        });
        return;
      }

      await interaction.followUp({
        content: payload.body,
        components: payload.components,
        ephemeral: payload.ephemeral ?? !shared,
      });
    },
    getPrimaryReply: async () => {
      if (primaryReply) {
        return primaryReply;
      }
      primaryReply = await interaction.fetchReply().catch(() => null);
      return primaryReply;
    },
  };
};

const createMessageVibeResponseSink = (message: Message): VibeResponseSink => {
  let primaryReply: Message | null = null;

  const sendPrimaryReply = async (payload: VibeResponsePayload): Promise<Message | null> => {
    const clipped = clipMessageIngressContent(payload.body);
    if (!clipped) {
      return primaryReply;
    }

    if (!primaryReply) {
      primaryReply = await message.reply(clipped);
    } else {
      await primaryReply.edit(clipped);
    }

    if (payload.seedFeedback && primaryReply) {
      await seedFeedbackReactions(primaryReply).catch(() => {});
    }

    return primaryReply;
  };

  return {
    ack: async (payload) => {
      if (payload) {
        await sendPrimaryReply(payload);
      }
    },
    updateProgress: sendPrimaryReply,
    final: sendPrimaryReply,
    followUp: async (payload) => {
      const clipped = clipMessageIngressContent(payload.body);
      if (!clipped) {
        return;
      }
      await message.reply({
        content: clipped,
        components: payload.components,
      });
    },
    getPrimaryReply: async () => primaryReply,
  };
};

const createMessageIngressResponseSink = (
  message: Message,
  getErrorMessage: (error: unknown) => string,
): MessageIngressResponseSinkV1 => {
  let primaryReply: Message | null = null;

  const sendPrimaryReply = async (content: string): Promise<Message | null> => {
    const clipped = clipMessageIngressContent(content);
    if (!clipped) {
      return primaryReply;
    }

    if (!primaryReply) {
      primaryReply = await message.reply(clipped);
      return primaryReply;
    }

    await primaryReply.edit(clipped);
    return primaryReply;
  };

  return {
    ack: async () => {},
    updateProgress: async (payload) => {
      await sendPrimaryReply(payload.content);
    },
    final: async (payload) => {
      const reply = await sendPrimaryReply(payload.content);
      if (!payload.seedFeedback || !reply) {
        return;
      }
      await seedFeedbackReactions(reply).catch((error) => {
        logVibeNonCritical('seedFeedbackReactions(discord ingress) failed', error, getErrorMessage);
      });
    },
    followUp: async (payload) => {
      const clipped = clipMessageIngressContent(payload.content);
      if (!clipped) {
        return;
      }
      await message.reply(clipped);
    },
  };
};

const runVibeSessionFlow = async (
  sink: VibeResponseSink,
  params: {
    guildId: string;
    userId: string;
    request: string;
    runtimeGoal: string;
    accessNotice?: string;
    showCodingTip?: boolean;
    shared: boolean;
    codeThreadEnabled: boolean;
    startVibeSession: VibeDeps['startVibeSession'];
    streamSessionProgress: VibeDeps['streamSessionProgress'];
    tryPostCodeThread: VibeDeps['tryPostCodeThread'];
    getErrorMessage: VibeDeps['getErrorMessage'];
    autoProposeWorker?: VibeDeps['autoProposeWorker'];
  },
): Promise<void> => {
  if (params.showCodingTip) {
    await sink.updateProgress({
      title: DISCORD_MESSAGES.vibe.tipTitle,
      body: DISCORD_MESSAGES.vibe.tipLines.join('\n'),
      tone: 'info',
    });
  }

  let session: AgentSession;
  try {
    session = await params.startVibeSession(params.guildId, params.userId, params.runtimeGoal);
  } catch (error) {
    await sink.final({
      title: DISCORD_MESSAGES.vibe.titleStartFailed,
      body: params.getErrorMessage(error),
      tone: 'error',
    });
    return;
  }

  let lastPayload: VibeResponsePayload = {
    title: DISCORD_MESSAGES.vibe.titleAccepted,
    body: `${DISCORD_MESSAGES.vibe.acceptedLines(session.id, params.request).join('\n')}${params.accessNotice || ''}`,
    tone: 'info',
  };
  await sink.updateProgress(lastPayload);

  await params.streamSessionProgress({
    update: async (content) => {
      lastPayload = {
        title: DISCORD_MESSAGES.vibe.titleProgress,
        body: content,
        tone: 'info',
      };
      await sink.updateProgress(lastPayload);
    },
  }, session.id, params.runtimeGoal, { showDebugBlocks: false, maxLinks: 2 });

  const completed = getAgentSession(session.id);
  if (completed?.status === 'completed' || completed?.status === 'failed') {
    await sink.final({
      ...lastPayload,
      seedFeedback: true,
    });
  }

  const resultText = String(completed?.result || '');
  if (shouldSuggestPolicyGuidance(resultText)) {
    await sink.followUp({
      body: `⚠️ ${DISCORD_MESSAGES.vibe.policyBlockedHint}`,
      ephemeral: true,
    }).catch((error) => logVibeNonCritical('followUp(policy hint) failed', error, params.getErrorMessage));
  }

  if (shouldSuggestWorkerProposal(params.request, resultText)) {
    let autoProposalLine = '';
    if (params.autoProposeWorker && shouldAutoProposeWorker(params.request, resultText)) {
      const autoKey = `${params.guildId}:${params.userId}:${params.request.slice(0, 80).toLowerCase()}`;
      if (acquireAutoProposalSlot(autoKey)) {
        const autoResult = await params.autoProposeWorker({
          guildId: params.guildId,
          requestedBy: params.userId,
          request: params.request,
          sessionId: session.id,
        }).catch((error) => ({ ok: false, error: params.getErrorMessage(error) }));
        autoProposalLine = autoResult.ok
          ? `\n자동 제안 생성 완료 (승인 ID: \`${('approvalId' in autoResult && autoResult.approvalId) ? autoResult.approvalId : 'n/a'}\`)`
          : `\n자동 제안 생성 실패: ${formatAutoProposalError(String(autoResult.error || 'unknown'))}`;
      }
    }

    await sink.followUp({
      body: `💡 ${DISCORD_MESSAGES.vibe.workerHint}${autoProposalLine}`,
      components: [buildWorkerProposalRow(session.id, params.request)],
      ephemeral: true,
    }).catch((error) => logVibeNonCritical('followUp(worker hint) failed', error, params.getErrorMessage));
  }

  if (params.codeThreadEnabled && completed?.status === 'completed') {
    const primaryReply = await sink.getPrimaryReply();
    if (primaryReply) {
      await params.tryPostCodeThread(primaryReply, completed, params.guildId).catch((error) => {
        logVibeNonCritical('code thread posting failed', error, params.getErrorMessage);
      });
    }
  }
};

export const createVibeHandlers = (deps: VibeDeps) => {
  const handlePrefixedMessageIngressRequest = async (
    request: PrefixedMessageIngressRequestV1,
    sink: MessageIngressResponseSinkV1,
  ): Promise<boolean> => {
    const ingressExecution = deps.executePrefixedMessageIngress
      ? await deps.executePrefixedMessageIngress({
        request: request.request,
        guildId: request.guildId,
        userId: request.userId,
        channel: request.channel,
        messageId: request.messageId,
        correlationId: request.correlationId,
        entryLabel: request.entryLabel,
        surface: 'muel-message',
        replyMode: 'channel',
        tenantLane: 'operator-personal',
      }).catch((error) => {
        logger.debug('[VIBE] Discord ingress adapter failed: %s', deps.getErrorMessage(error));
        return null;
      })
      : null;

    if (!ingressExecution?.result?.answer) {
      return false;
    }

    await sink.final({
      content: ingressExecution.result.answer,
      seedFeedback: true,
    });
    return true;
  };

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
    const sink = createInteractionVibeResponseSink(interaction, shared);
    await sink.ack();

    const request = resolveVibeCommandRequest(interaction);
    if (!request) {
      await sink.final({
        title: DISCORD_MESSAGES.vibe.titleInputError,
        body: DISCORD_MESSAGES.vibe.inputExampleAsk,
        tone: 'warn',
      });
      return;
    }

    if (isLowSignalPrompt(request, deps)) {
      await sink.final({
        title: DISCORD_MESSAGES.vibe.titleInputError,
        body: DISCORD_MESSAGES.vibe.mentionPrompt,
        tone: 'warn',
      });
      return;
    }

    const { runtimeGoal, showCodingTip } = resolveVibeRuntimeGoal(request, deps.codingIntentPattern);

    await runVibeSessionFlow(sink, {
      guildId,
      userId: interaction.user.id,
      request,
      runtimeGoal,
      accessNotice,
      showCodingTip,
      shared,
      codeThreadEnabled: deps.codeThreadEnabled && shared,
      startVibeSession: deps.startVibeSession,
      streamSessionProgress: deps.streamSessionProgress,
      tryPostCodeThread: deps.tryPostCodeThread,
      getErrorMessage: deps.getErrorMessage,
      autoProposeWorker: deps.autoProposeWorker,
    });
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

    if (isPrefixed) {
      if (await tryHandleDiscordChatSdkPrefixedMessage(message)) {
        return;
      }

      const ingressHandled = await handlePrefixedMessageIngressRequest({
        request,
        guildId: message.guildId,
        userId: message.author.id,
        channel: message.channel,
        messageId: message.id,
        correlationId: message.id,
        entryLabel: '뮤엘 메시지',
      }, createMessageIngressResponseSink(message, deps.getErrorMessage));
      if (ingressHandled) {
        return;
      }
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
          const replyText = clipMessageIngressContent(sanitizeDiscordUserFacingText(String(reply || '')));
          if (replyText) {
            await message.reply(replyText);
            return;
          }
        }
      } catch (err) {
        logger.debug('[VIBE] quick-intent LLM failed, falling through to Sprint: %s', deps.getErrorMessage(err));
      }
    }

    if (isLowSignalPrompt(request, deps)) {
      await message.reply(DISCORD_MESSAGES.vibe.mentionPrompt);
      return;
    }

    const sink = createMessageVibeResponseSink(message);
    await sink.ack({
      body: DISCORD_MESSAGES.vibe.acceptedNoSessionLines(request).join('\n'),
    });

    const { runtimeGoal } = resolveVibeRuntimeGoal(request, deps.codingIntentPattern);
    await runVibeSessionFlow(sink, {
      guildId: message.guildId,
      userId: message.author.id,
      request,
      runtimeGoal,
      shared: true,
      codeThreadEnabled: deps.codeThreadEnabled,
      startVibeSession: deps.startVibeSession,
      streamSessionProgress: deps.streamSessionProgress,
      tryPostCodeThread: deps.tryPostCodeThread,
      getErrorMessage: deps.getErrorMessage,
      autoProposeWorker: deps.autoProposeWorker,
    });
  };

  return { handleVibeCommand, handleVibeMessage };
};

import type { ChatInputCommandInteraction } from 'discord.js';
import type { RAGQueryResult } from '../../services/obsidian/obsidianRagService';
import type { LlmTextRequest } from '../../services/llmClient';
import { getSemanticAnswerCache, putSemanticAnswerCache } from '../../services/semanticAnswerCacheService';
import { buildRagQueryPlanForGuild } from '../../services/taskRoutingService';
import { recordTaskRoutingMetric } from '../../services/taskRoutingMetricsService';
import { DISCORD_MESSAGES } from '../messages';
import type { DiscordIngressExecutionHandler, DiscordIngressTelemetry } from '../runtime/discordIngressAdapter';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';
import { ensureFeatureAccess } from '../auth';
import { seedFeedbackReactions } from '../session';
import {
  DISCORD_DOCS_ANSWER_LIMIT,
  DISCORD_DOCS_ANSWER_TARGET_CHARS,
  DISCORD_DOCS_CONTEXT_LIMIT,
  DISCORD_DOCS_LLM_MAX_TOKENS,
  DISCORD_DOCS_MESSAGE_LIMIT,
  clipDocsFallbackContext,
} from '../runtimePolicy';

type DocsDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  queryObsidianRAG: (question: string, options?: { maxDocs?: number; contextMode?: 'full' | 'metadata_first'; guildId?: string }) => Promise<RAGQueryResult>;
  generateText: (params: LlmTextRequest) => Promise<string>;
  isAnyLlmConfigured: () => boolean;
  getErrorMessage: (error: unknown) => string;
  executeDocsCommandIngress?: DiscordIngressExecutionHandler;
};

type IngressResponseTone = 'info' | 'warn' | 'error';

type IngressResponsePayload = {
  title: string;
  body: string;
  tone: IngressResponseTone;
  seedFeedback?: boolean;
};

type IngressFollowUpPayload = IngressResponsePayload & {
  ephemeral?: boolean;
};

type IngressResponseSinkV1 = {
  ack: () => Promise<void>;
  updateProgress: (payload: IngressResponsePayload) => Promise<void>;
  final: (payload: IngressResponsePayload) => Promise<void>;
  followUp: (payload: IngressFollowUpPayload) => Promise<void>;
};

type DocsAskRequestV1 = {
  question: string;
  guildId: string | null;
  userId: string;
  channel: ChatInputCommandInteraction['channel'];
  entryLabel: string;
  replyMode: 'private' | 'public';
  correlationId: string;
  accessNotice: string;
};

const EMBED_BY_TONE = {
  info: EMBED_INFO,
  warn: EMBED_WARN,
  error: EMBED_ERROR,
} as const;

const formatMetadataSignalsLine = (signals?: RAGQueryResult['metadataSignals']): string => {
  if (!signals) {
    return '';
  }

  return `메타데이터 판단: active ${signals.activeDocs}, invalid ${signals.invalidDocs}, superseded ${signals.supersededDocs}, sourced ${signals.sourcedDocs}`;
};

const toIngressMetricExtra = (
  telemetry: DiscordIngressTelemetry | null | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  if (!telemetry) {
    return extra;
  }

  return {
    ...extra,
    ingress: {
      correlationId: telemetry.correlationId,
      selectedAdapterId: telemetry.selectedAdapterId,
      adapterId: telemetry.adapterId,
      routeDecision: telemetry.routeDecision,
      fallbackReason: telemetry.fallbackReason,
      shadowMode: telemetry.shadowMode,
      surface: telemetry.surface,
    },
  };
};

const createDocsAskResponseSink = (
  interaction: ChatInputCommandInteraction,
  shared: boolean,
): IngressResponseSinkV1 => {
  let acked = false;

  const ensureAcked = async () => {
    if (acked) {
      return;
    }
    await interaction.deferReply({ ephemeral: !shared });
    acked = true;
  };

  const renderCard = (payload: IngressResponsePayload | IngressFollowUpPayload) => {
    return buildUserCard(payload.title, payload.body, EMBED_BY_TONE[payload.tone]);
  };

  return {
    ack: ensureAcked,
    updateProgress: async (payload) => {
      await ensureAcked();
      await interaction.editReply(renderCard(payload));
    },
    final: async (payload) => {
      await ensureAcked();
      await interaction.editReply(renderCard(payload));
      if (!payload.seedFeedback) {
        return;
      }
      const reply = await interaction.fetchReply().catch(() => null);
      await seedFeedbackReactions(reply).catch(() => {});
    },
    followUp: async (payload) => {
      await ensureAcked();
      await interaction.followUp({
        ...renderCard(payload),
        ephemeral: payload.ephemeral ?? !shared,
      });
    },
  };
};

export const createDocsHandlers = (deps: DocsDeps) => {
  /**
   * /물어봐 <질문> — RAG 검색 후 LLM이 문서 기반으로 답변
   */
  const handleDocsAskRequest = async (
    request: DocsAskRequestV1,
    sink: IngressResponseSinkV1,
  ) => {
    const ingressExecution = deps.executeDocsCommandIngress
      ? await deps.executeDocsCommandIngress({
        request: request.question,
        guildId: request.guildId,
        userId: request.userId,
        channel: request.channel,
        correlationId: request.correlationId,
        entryLabel: request.entryLabel,
        surface: 'docs-command',
        replyMode: request.replyMode,
        tenantLane: 'operator-personal',
      }).catch(() => {
        return null;
      })
      : null;
    const ingressTelemetry = ingressExecution?.telemetry ?? null;
    if (ingressExecution?.result?.answer) {
      if (request.guildId) {
        void recordTaskRoutingMetric({
          guildId: request.guildId,
          requestedBy: request.userId,
          goal: request.question,
          channel: 'docs',
          route: 'knowledge',
          confidence: 1,
          reasons: ['discord_ingress_adapter_accept'],
          status: 'success',
          durationMs: 0,
          extra: toIngressMetricExtra(ingressTelemetry, {
            continuityQueued: ingressExecution.result.continuityQueued,
          }),
        });
      }

      const body = [
        ingressExecution.result.answer.slice(0, DISCORD_DOCS_ANSWER_LIMIT),
        request.accessNotice,
      ].filter(Boolean).join('\n');
      await sink.final({
        title: DISCORD_MESSAGES.docs.askTitle(request.question.slice(0, 40)),
        body: body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT),
        tone: 'info',
        seedFeedback: true,
      });
      return;
    }

    const ragPlan = await buildRagQueryPlanForGuild(request.question, request.guildId || undefined);

    await sink.updateProgress({
      title: DISCORD_MESSAGES.docs.titleSearching,
      body: DISCORD_MESSAGES.docs.searchingFor(request.question.slice(0, 60)),
      tone: 'info',
    });

    if (request.guildId) {
      const cacheHit = await getSemanticAnswerCache({ guildId: request.guildId, question: request.question });
      if (cacheHit) {
        void recordTaskRoutingMetric({
          guildId: request.guildId,
          requestedBy: request.userId,
          goal: request.question,
          channel: 'docs',
          route: ragPlan.route,
          confidence: ragPlan.confidence,
          reasons: ragPlan.reasons,
          overrideUsed: ragPlan.overrideUsed,
          status: 'success',
          durationMs: 0,
          extra: toIngressMetricExtra(ingressTelemetry, {
            cacheHit: true,
            sourceCount: cacheHit.sourceFiles.length,
          }),
        });
        const body = [
          cacheHit.answer.slice(0, DISCORD_DOCS_ANSWER_LIMIT),
          '',
          `캐시 응답 (semantic=${cacheHit.similarity})`,
          cacheHit.intent ? `intent: ${cacheHit.intent}` : '',
          cacheHit.sourceFiles.length > 0 ? `소스: ${cacheHit.sourceFiles.slice(0, 6).join(', ')}` : '',
          request.accessNotice,
        ].filter(Boolean).join('\n');
        await sink.final({
          title: DISCORD_MESSAGES.docs.askTitle(request.question.slice(0, 40)),
          body: body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT),
          tone: 'info',
          seedFeedback: true,
        });
        return;
      }
    }

    let ragResult: RAGQueryResult;
    try {
      ragResult = await deps.queryObsidianRAG(request.question, {
        maxDocs: ragPlan.maxDocs,
        contextMode: ragPlan.contextMode,
        guildId: request.guildId || undefined,
      });
    } catch (error) {
      await sink.final({
        title: DISCORD_MESSAGES.docs.titleSearchError,
        body: deps.getErrorMessage(error),
        tone: 'error',
      });
      return;
    }

    if (ragResult.documentCount === 0) {
      if (request.guildId) {
        void recordTaskRoutingMetric({
          guildId: request.guildId,
          requestedBy: request.userId,
          goal: request.question,
          channel: 'docs',
          route: ragPlan.route,
          confidence: ragPlan.confidence,
          reasons: ragPlan.reasons,
          overrideUsed: ragPlan.overrideUsed,
          status: 'failed',
          durationMs: ragResult.executionTimeMs,
          extra: toIngressMetricExtra(ingressTelemetry, {
            cacheHit: false,
            documentCount: 0,
            ragIntent: ragResult.intent,
          }),
        });
      }
      await sink.final({
        title: DISCORD_MESSAGES.docs.titleNoDocument,
        body: DISCORD_MESSAGES.docs.noDocumentLines(request.question.slice(0, 60), ragResult.intent).join('\n'),
        tone: 'warn',
      });
      return;
    }

    let answer: string = DISCORD_MESSAGES.docs.llmNotConfigured;
    if (deps.isAnyLlmConfigured() && ragResult.documentContext) {
      try {
        const toolHintBlock = ragPlan.toolHints && ragPlan.toolHints.length > 0
          ? [
              '',
              '=== 사용 가능한 도구 목록 ===',
              ragPlan.toolHints.map((t) => `- ${t.id}: ${t.description} (capabilities: ${t.capabilities.slice(0, 4).join(', ')})`).join('\n'),
            ].join('\n')
          : '';

        const system = [
          '당신은 한국어로 답변하는 전문 AI 어시스턴트입니다.',
          '아래 제공된 문서 컨텍스트를 기반으로 사용자의 질문에 정확하고 명확하게 답변하세요.',
          '컨텍스트에 없는 정보는 추론하지 마세요. 없으면 "관련 정보가 문서에 없습니다"라고 솔직하게 답하세요.',
          toolHintBlock ? '도구 목록이 제공된 경우, 실행 관련 요청에 어떤 도구를 활용할 수 있는지 언급할 수 있습니다.' : '',
          `답변은 ${DISCORD_DOCS_ANSWER_TARGET_CHARS}자 내외로 간결하게 작성하세요.`,
        ].filter(Boolean).join('\n');

        const user = [
          `질문: ${request.question}`,
          '',
          '=== 참고 문서 컨텍스트 ===',
          ragResult.documentContext.slice(0, DISCORD_DOCS_CONTEXT_LIMIT),
          toolHintBlock,
        ].filter(Boolean).join('\n');

        answer = await deps.generateText({ system, user, maxTokens: DISCORD_DOCS_LLM_MAX_TOKENS, actionName: 'docs.qa' });
      } catch {
        answer = clipDocsFallbackContext(ragResult.documentContext) + DISCORD_MESSAGES.docs.llmFallbackSuffix;
      }
    }

    const truncatedAnswer = answer.length > DISCORD_DOCS_ANSWER_LIMIT
      ? `${answer.slice(0, Math.max(0, DISCORD_DOCS_ANSWER_LIMIT - 3))}...`
      : answer;
    const sources = ragResult.sourceFiles
      .slice(0, 8)
      .map((f) => `• \`${f.split('/').pop() || f}\``)
      .join('\n');

    const body = [
      truncatedAnswer,
      '',
      DISCORD_MESSAGES.docs.sourceHeader(ragResult.documentCount),
      sources || DISCORD_MESSAGES.docs.noSource,
      '',
      `라우팅: ${ragPlan.route}`,
      DISCORD_MESSAGES.docs.summaryLine(ragResult.intent, ragResult.executionTimeMs, ragResult.cacheStatus.hits),
      formatMetadataSignalsLine(ragResult.metadataSignals),
      ragResult.graphDensity
        ? DISCORD_MESSAGES.docs.graphDensityLine(ragResult.graphDensity.avgBacklinks, ragResult.graphDensity.maxBacklinks, ragResult.graphDensity.connectedRatio)
        : '',
      request.accessNotice,
    ].filter(Boolean).join('\n');

    if (request.guildId) {
      void recordTaskRoutingMetric({
        guildId: request.guildId,
        requestedBy: request.userId,
        goal: request.question,
        channel: 'docs',
        route: ragPlan.route,
        confidence: ragPlan.confidence,
        reasons: ragPlan.reasons,
        overrideUsed: ragPlan.overrideUsed,
        status: 'success',
        durationMs: ragResult.executionTimeMs,
        extra: toIngressMetricExtra(ingressTelemetry, {
          cacheHit: false,
          documentCount: ragResult.documentCount,
          ragIntent: ragResult.intent,
          contextMode: ragResult.contextMode,
        }),
      });
    }

    if (request.guildId && truncatedAnswer && ragResult.documentCount > 0) {
      void putSemanticAnswerCache({
        guildId: request.guildId,
        question: request.question,
        answer: truncatedAnswer,
        intent: ragResult.intent,
        sourceFiles: ragResult.sourceFiles,
        meta: {
          contextMode: ragResult.contextMode,
          executionTimeMs: ragResult.executionTimeMs,
        },
      });
    }

    await sink.final({
      title: DISCORD_MESSAGES.docs.askTitle(request.question.slice(0, 40)),
      body: body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT),
      tone: 'info',
      seedFeedback: true,
    });
  };

  const handleAskCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }
    if (!access.ok) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }
    const accessNotice = access.autoLoggedIn ? `\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';

    const shared = deps.getReplyVisibility(interaction) === 'public';
    const sink = createDocsAskResponseSink(interaction, shared);
    await sink.ack();

    const question = (interaction.options.getString('질문', true) || '').trim();
    if (!question) {
      await sink.final({
        title: DISCORD_MESSAGES.docs.titleInputError,
        body: DISCORD_MESSAGES.docs.askInputRequired,
        tone: 'warn',
      });
      return;
    }

    await handleDocsAskRequest({
      question,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      channel: interaction.channel,
      entryLabel: `/${interaction.commandName}`,
      replyMode: shared ? 'public' : 'private',
      correlationId: interaction.id,
      accessNotice,
    }, sink);
  };

  /**
   * /문서 <검색어> — RAG 문서 목록 조회 (LLM 없이 빠른 참조)
   */
  const handleDocsCommand = async (interaction: ChatInputCommandInteraction) => {
    const access = await ensureFeatureAccess(interaction);
    if (!access.ok && access.reason === 'guild_only') {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }
    if (!access.ok) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titlePermissionError, DISCORD_MESSAGES.subscribe.loginRequired, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }
    const accessNotice = access.autoLoggedIn ? `\n${DISCORD_MESSAGES.common.autoLoginActivated}` : '';

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const keyword = (interaction.options.getString('검색어', true) || '').trim();
    if (!keyword) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleInputError, DISCORD_MESSAGES.docs.searchInputRequired, EMBED_WARN));
      return;
    }

    const ragPlan = await buildRagQueryPlanForGuild(keyword, interaction.guildId || undefined);

    let ragResult: RAGQueryResult;
    try {
      ragResult = await deps.queryObsidianRAG(keyword, {
        maxDocs: Math.max(8, ragPlan.maxDocs),
        contextMode: ragPlan.contextMode,
        guildId: interaction.guildId || undefined,
      });
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleSearchError, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    if (ragResult.documentCount === 0) {
      if (interaction.guildId) {
        void recordTaskRoutingMetric({
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
          goal: keyword,
          channel: 'docs',
          route: ragPlan.route,
          confidence: ragPlan.confidence,
          reasons: ragPlan.reasons,
          overrideUsed: ragPlan.overrideUsed,
          status: 'failed',
          durationMs: ragResult.executionTimeMs,
          extra: {
            cacheHit: false,
            documentCount: 0,
            ragIntent: ragResult.intent,
          },
        });
      }
      await interaction.editReply(
        buildUserCard(DISCORD_MESSAGES.docs.titleNoSearchResult, DISCORD_MESSAGES.docs.noSearchResult(keyword.slice(0, 60)), EMBED_WARN),
      );
      return;
    }

    if (interaction.guildId) {
      void recordTaskRoutingMetric({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        goal: keyword,
        channel: 'docs',
        route: ragPlan.route,
        confidence: ragPlan.confidence,
        reasons: ragPlan.reasons,
        overrideUsed: ragPlan.overrideUsed,
        status: 'success',
        durationMs: ragResult.executionTimeMs,
        extra: {
          cacheHit: false,
          documentCount: ragResult.documentCount,
          ragIntent: ragResult.intent,
          contextMode: ragResult.contextMode,
        },
      });
    }

    const lines: string[] = [
      DISCORD_MESSAGES.docs.listHeader(ragResult.intent, ragResult.documentCount, ragResult.executionTimeMs),
      '',
    ];

    ragResult.sourceFiles.forEach((filePath, i) => {
      const name = filePath.split('/').pop() || filePath;
      lines.push(`**${i + 1}.** \`${name}\``);
      lines.push(`   ${filePath}`);
    });

    lines.push('');
    lines.push(DISCORD_MESSAGES.docs.cacheLine(ragResult.cacheStatus.hits, ragResult.cacheStatus.misses));
    const metadataLine = formatMetadataSignalsLine(ragResult.metadataSignals);
    if (metadataLine) {
      lines.push(metadataLine);
    }
    if (ragResult.graphDensity) {
      lines.push(DISCORD_MESSAGES.docs.graphDensityLine(ragResult.graphDensity.avgBacklinks, ragResult.graphDensity.maxBacklinks, ragResult.graphDensity.connectedRatio));
    }
    if (accessNotice) {
      lines.push(accessNotice);
    }

    const body = lines.join('\n');
    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.docsTitle(keyword.slice(0, 30)), body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT), EMBED_INFO),
    );
  };

  /**
   * /변경사항 [개수] — Obsidian vault에서 #changelog/#릴리즈 태그 노트를 검색해 표시
   */
  const handleChangelogCommand = async (interaction: ChatInputCommandInteraction) => {
    const count = Math.min(interaction.options.getInteger('개수') ?? 3, 5);
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId ?? undefined;

    // Obsidian vault에서 #changelog 또는 #릴리즈 태그 노트 검색
    const result = await deps.queryObsidianRAG('#changelog #릴리즈', {
      maxDocs: count + 2,
      contextMode: 'metadata_first',
      guildId,
    });

    if (result.documentCount === 0 || result.sourceFiles.length === 0) {
      await interaction.editReply(
        buildUserCard(
          '📋 변경사항',
          'Obsidian vault에 `#changelog` 또는 `#릴리즈` 태그가 달린 노트가 없습니다.\n\n노트에 태그를 추가하면 여기서 확인할 수 있습니다.',
          EMBED_INFO,
        ),
      );
      return;
    }

    // sourceFiles → 파일명만 표시, documentContext에서 내용 발췌
    const fileNames = result.sourceFiles.slice(0, count).map((f) => {
      const name = f.split('/').pop()?.replace(/\.md$/, '') ?? f;
      return `• **${name}**`;
    });

    // documentContext에서 사용자에게 보여줄 요약 추출 (첫 1500자)
    const contextPreview = result.documentContext
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('---') && !l.startsWith('vaultPath') && !l.startsWith('filePath'))
      .slice(0, 20)
      .join('\n')
      .slice(0, 1500);

    const body = [
      `**조회된 노트 (${result.sourceFiles.length}개)**`,
      fileNames.join('\n'),
      '',
      contextPreview || '(내용 없음)',
    ].join('\n').slice(0, 3800);

    await interaction.editReply(buildUserCard('📋 변경사항', body, EMBED_INFO));
  };

  return { handleAskCommand, handleDocsCommand, handleChangelogCommand };
};

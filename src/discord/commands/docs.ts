import type { ChatInputCommandInteraction } from 'discord.js';
import type { RAGQueryResult } from '../../services/obsidian/obsidianRagService';
import type { LlmTextRequest } from '../../services/llmClient';
import { getSemanticAnswerCache, putSemanticAnswerCache } from '../../services/semanticAnswerCacheService';
import { buildRagQueryPlanForGuild } from '../../services/taskRoutingService';
import { recordTaskRoutingMetric } from '../../services/taskRoutingMetricsService';
import { DISCORD_MESSAGES } from '../messages';
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
};

const formatMetadataSignalsLine = (signals?: RAGQueryResult['metadataSignals']): string => {
  if (!signals) {
    return '';
  }

  return `메타데이터 판단: active ${signals.activeDocs}, invalid ${signals.invalidDocs}, superseded ${signals.supersededDocs}, sourced ${signals.sourcedDocs}`;
};

export const createDocsHandlers = (deps: DocsDeps) => {
  /**
   * /물어봐 <질문> — RAG 검색 후 LLM이 문서 기반으로 답변
   */
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
    await interaction.deferReply({ ephemeral: !shared });

    const question = (interaction.options.getString('질문', true) || '').trim();
    if (!question) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleInputError, DISCORD_MESSAGES.docs.askInputRequired, EMBED_WARN));
      return;
    }

    const ragPlan = await buildRagQueryPlanForGuild(question, interaction.guildId || undefined);

    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.titleSearching, DISCORD_MESSAGES.docs.searchingFor(question.slice(0, 60)), EMBED_INFO),
    );

    if (interaction.guildId) {
      const cacheHit = await getSemanticAnswerCache({ guildId: interaction.guildId, question });
      if (cacheHit) {
        void recordTaskRoutingMetric({
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
          goal: question,
          channel: 'docs',
          route: ragPlan.route,
          confidence: ragPlan.confidence,
          reasons: ragPlan.reasons,
          overrideUsed: ragPlan.overrideUsed,
          status: 'success',
          durationMs: 0,
          extra: {
            cacheHit: true,
            sourceCount: cacheHit.sourceFiles.length,
          },
        });
        const body = [
          cacheHit.answer.slice(0, DISCORD_DOCS_ANSWER_LIMIT),
          '',
          `캐시 응답 (semantic=${cacheHit.similarity})`,
          cacheHit.intent ? `intent: ${cacheHit.intent}` : '',
          cacheHit.sourceFiles.length > 0 ? `소스: ${cacheHit.sourceFiles.slice(0, 6).join(', ')}` : '',
          accessNotice,
        ].filter(Boolean).join('\n');
        await interaction.editReply(
          buildUserCard(DISCORD_MESSAGES.docs.askTitle(question.slice(0, 40)), body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT), EMBED_INFO),
        );
        const cachedReply = await interaction.fetchReply().catch(() => null);
        await seedFeedbackReactions(cachedReply);
        return;
      }
    }

    let ragResult: RAGQueryResult;
    try {
      ragResult = await deps.queryObsidianRAG(question, {
        maxDocs: ragPlan.maxDocs,
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
          goal: question,
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
        buildUserCard(
          DISCORD_MESSAGES.docs.titleNoDocument,
          DISCORD_MESSAGES.docs.noDocumentLines(question.slice(0, 60), ragResult.intent).join('\n'),
          EMBED_WARN,
        ),
      );
      return;
    }

    // LLM이 구성된 경우 문서 컨텍스트를 기반으로 답변 생성
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
          `질문: ${question}`,
          '',
          '=== 참고 문서 컨텍스트 ===',
          ragResult.documentContext.slice(0, DISCORD_DOCS_CONTEXT_LIMIT),
          toolHintBlock,
        ].filter(Boolean).join('\n');

        answer = await deps.generateText({ system, user, maxTokens: DISCORD_DOCS_LLM_MAX_TOKENS, actionName: 'docs.qa' });
      } catch {
        // LLM 실패 시 원본 컨텍스트 일부를 그대로 표시
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
      accessNotice,
    ].filter(Boolean).join('\n');

    if (interaction.guildId) {
      void recordTaskRoutingMetric({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        goal: question,
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

    if (interaction.guildId && truncatedAnswer && ragResult.documentCount > 0) {
      void putSemanticAnswerCache({
        guildId: interaction.guildId,
        question,
        answer: truncatedAnswer,
        intent: ragResult.intent,
        sourceFiles: ragResult.sourceFiles,
        meta: {
          contextMode: ragResult.contextMode,
          executionTimeMs: ragResult.executionTimeMs,
        },
      });
    }

    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.askTitle(question.slice(0, 40)), body.slice(0, DISCORD_DOCS_MESSAGE_LIMIT), EMBED_INFO),
    );
    const askReply = await interaction.fetchReply().catch(() => null);
    await seedFeedbackReactions(askReply);
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

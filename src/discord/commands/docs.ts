import type { ChatInputCommandInteraction } from 'discord.js';
import type { RAGQueryResult } from '../../services/obsidianRagService';
import type { LlmTextRequest } from '../../services/llmClient';
import { DISCORD_MESSAGES } from '../messages';
import { buildUserCard, EMBED_INFO, EMBED_WARN, EMBED_ERROR } from '../ui';

const DISCORD_MSG_LIMIT = 1900;

type DocsDeps = {
  getReplyVisibility: (interaction: ChatInputCommandInteraction) => 'private' | 'public';
  queryObsidianRAG: (question: string, options?: { maxDocs?: number }) => Promise<RAGQueryResult>;
  generateText: (params: LlmTextRequest) => Promise<string>;
  isAnyLlmConfigured: () => boolean;
  getErrorMessage: (error: unknown) => string;
};

export const createDocsHandlers = (deps: DocsDeps) => {
  /**
   * /물어봐 <질문> — RAG 검색 후 LLM이 문서 기반으로 답변
   */
  const handleAskCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const question = (interaction.options.getString('질문', true) || '').trim();
    if (!question) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleInputError, DISCORD_MESSAGES.docs.askInputRequired, EMBED_WARN));
      return;
    }

    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.titleSearching, DISCORD_MESSAGES.docs.searchingFor(question.slice(0, 60)), EMBED_INFO),
    );

    let ragResult: RAGQueryResult;
    try {
      ragResult = await deps.queryObsidianRAG(question, { maxDocs: 8 });
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleSearchError, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    if (ragResult.documentCount === 0) {
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
        const system = [
          '당신은 한국어로 답변하는 전문 AI 어시스턴트입니다.',
          '아래 제공된 문서 컨텍스트를 기반으로 사용자의 질문에 정확하고 명확하게 답변하세요.',
          '컨텍스트에 없는 정보는 추론하지 마세요. 없으면 "관련 정보가 문서에 없습니다"라고 솔직하게 답하세요.',
          '답변은 400자 내외로 간결하게 작성하세요.',
        ].join('\n');

        const user = [
          `질문: ${question}`,
          '',
          '=== 참고 문서 컨텍스트 ===',
          ragResult.documentContext.slice(0, 4000),
        ].join('\n');

        answer = await deps.generateText({ system, user, maxTokens: 700 });
      } catch {
        // LLM 실패 시 원본 컨텍스트 일부를 그대로 표시
        answer = ragResult.documentContext.slice(0, 600) + DISCORD_MESSAGES.docs.llmFallbackSuffix;
      }
    }

    const truncatedAnswer = answer.length > 1400 ? `${answer.slice(0, 1397)}...` : answer;
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
      DISCORD_MESSAGES.docs.summaryLine(ragResult.intent, ragResult.executionTimeMs, ragResult.cacheStatus.hits),
    ].join('\n');

    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.askTitle(question.slice(0, 40)), body.slice(0, DISCORD_MSG_LIMIT), EMBED_INFO),
    );
  };

  /**
   * /문서 <검색어> — RAG 문서 목록 조회 (LLM 없이 빠른 참조)
   */
  const handleDocsCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        ...buildUserCard(DISCORD_MESSAGES.docs.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN),
        ephemeral: true,
      });
      return;
    }

    const shared = deps.getReplyVisibility(interaction) === 'public';
    await interaction.deferReply({ ephemeral: !shared });

    const keyword = (interaction.options.getString('검색어', true) || '').trim();
    if (!keyword) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleInputError, DISCORD_MESSAGES.docs.searchInputRequired, EMBED_WARN));
      return;
    }

    let ragResult: RAGQueryResult;
    try {
      ragResult = await deps.queryObsidianRAG(keyword, { maxDocs: 12 });
    } catch (error) {
      await interaction.editReply(buildUserCard(DISCORD_MESSAGES.docs.titleSearchError, deps.getErrorMessage(error), EMBED_ERROR));
      return;
    }

    if (ragResult.documentCount === 0) {
      await interaction.editReply(
        buildUserCard(DISCORD_MESSAGES.docs.titleNoSearchResult, DISCORD_MESSAGES.docs.noSearchResult(keyword.slice(0, 60)), EMBED_WARN),
      );
      return;
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

    const body = lines.join('\n');
    await interaction.editReply(
      buildUserCard(DISCORD_MESSAGES.docs.docsTitle(keyword.slice(0, 30)), body.slice(0, DISCORD_MSG_LIMIT), EMBED_INFO),
    );
  };

  return { handleAskCommand, handleDocsCommand };
};

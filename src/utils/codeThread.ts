import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message } from 'discord.js';
import type { AgentSession } from '../services/multiAgentService';
import { saveArtifact, setArtifactThreadId } from './sessionArtifactStore';

export const DISCORD_MSG_LIMIT = 1960;

export const extractCodeBlocks = (text: string): string[] => {
  const matches = String(text || '').match(/```[\s\S]+?```/g) || [];
  const out: string[] = [];
  for (const raw of matches) {
    const block = raw.trim();
    if (block.length > 6) {
      out.push(block);
    }
  }
  return out.slice(0, 6);
};

export const hasCodeBlocksInText = (text: string): boolean => /```[\s\S]+?```/.test(String(text || ''));

export const buildCodeActionRow = (sessionId: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId(`code_regen:${sessionId}`)
    .setLabel('🔄 재생성')
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId(`code_refactor:${sessionId}`)
    .setLabel('🔧 리팩터')
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId(`code_test:${sessionId}`)
    .setLabel('🧪 테스트 추가')
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId(`code_history:${sessionId}`)
    .setLabel('📋 이력')
    .setStyle(ButtonStyle.Secondary),
);

export const tryPostCodeThread = async (
  sourceMessage: Message,
  session: AgentSession,
  guildId: string,
): Promise<void> => {
  const rawResult = String(session.result || '').trim();
  if (!rawResult || !hasCodeBlocksInText(rawResult)) {
    return;
  }

  const blocks = extractCodeBlocks(rawResult);
  if (blocks.length === 0) {
    return;
  }

  const goalSummary = session.goal.replace(/\s+/g, ' ').slice(0, 40);

  let thread: Awaited<ReturnType<Message['startThread']>> | undefined;
  try {
    thread = await sourceMessage.startThread({
      name: `💻 ${goalSummary}`,
      autoArchiveDuration: 60,
      reason: 'AI 코드 작업 스레드',
    });
  } catch {
    return;
  }

  saveArtifact({
    sessionId: session.id,
    guildId,
    goalSummary,
    fullGoal: session.goal,
    codeBlocks: blocks,
    rawResult,
    threadId: thread.id,
    createdAt: new Date().toISOString(),
  });
  setArtifactThreadId(session.id, thread.id);

  await thread.send([
    '**💻 코드 작업 세션**',
    `요청: ${session.goal.slice(0, 200)}`,
    `세션: \`${session.id}\``,
    `파일 ${blocks.length}개 생성됨.`,
    '아래 버튼으로 재생성·리팩터·테스트 추가를 이어서 할 수 있습니다.',
  ].join('\n'));

  for (const [i, block] of blocks.entries()) {
    const safe = block.length > DISCORD_MSG_LIMIT
      ? `${block.slice(0, DISCORD_MSG_LIMIT)}\n... (truncated)`
      : block;
    const isLast = i === blocks.length - 1;
    try {
      if (isLast) {
        await thread.send({ content: safe, components: [buildCodeActionRow(session.id)] });
      } else {
        await thread.send(safe);
      }
    } catch {
      try {
        await thread.send(safe);
      } catch {
        // ignore
      }
    }
  }
};

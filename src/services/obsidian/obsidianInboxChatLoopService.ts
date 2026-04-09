import path from 'node:path';

import logger from '../../logger';
import { BackgroundLoop } from '../../utils/backgroundLoop';
import { parseBooleanEnv, parseMinIntEnv } from '../../utils/env';
import { getErrorMessage } from '../../utils/errorMessage';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { processInboxChatNote, readFrontmatterProperty } from '../../routes/chat';

import { listObsidianFilesWithAdapter, readObsidianFileWithAdapter, searchObsidianVaultWithAdapter } from './router';

const OBSIDIAN_INBOX_CHAT_LOOP_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_INBOX_CHAT_LOOP_ENABLED, true);
const OBSIDIAN_INBOX_CHAT_LOOP_INTERVAL_SEC = parseMinIntEnv(process.env.OBSIDIAN_INBOX_CHAT_LOOP_INTERVAL_SEC, 30, 5);
const OBSIDIAN_INBOX_CHAT_LOOP_RUN_ON_START = parseBooleanEnv(process.env.OBSIDIAN_INBOX_CHAT_LOOP_RUN_ON_START, true);
const OBSIDIAN_INBOX_CHAT_LOOP_MAX_NOTES_PER_RUN = parseMinIntEnv(process.env.OBSIDIAN_INBOX_CHAT_LOOP_MAX_NOTES_PER_RUN, 2, 1);
const OBSIDIAN_INBOX_CHAT_LOOP_SEARCH_LIMIT = parseMinIntEnv(process.env.OBSIDIAN_INBOX_CHAT_LOOP_SEARCH_LIMIT, 25, 5);

type InboxProcessorCycleSummary = {
  candidateCount: number;
  processedCount: number;
  processedPaths: string[];
};

const state = {
  processedTotal: 0,
  lastFinishedAt: null as string | null,
  lastCandidateCount: 0,
  lastProcessedPaths: [] as string[],
};

let loop: BackgroundLoop | null = null;

const normalizePath = (value: string): string => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');

const stripFrontmatter = (markdown: string): string => markdown.replace(/^---\n[\s\S]*?\n---\n?/m, '');

const stripResponseSection = (markdown: string): string => markdown.replace(/\n## Response\n[\s\S]*$/m, '').trim();

const extractTitle = (markdown: string, filePath: string): string => {
  const frontmatterTitle = readFrontmatterProperty(markdown, 'title');
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = stripFrontmatter(markdown).split('\n').find((line) => line.trim().startsWith('#'));
  if (heading) {
    return heading.replace(/^#+\s*/, '').trim();
  }

  return path.basename(filePath, '.md');
};

const extractMessage = (markdown: string, fallbackTitle: string): string => {
  const withoutFrontmatter = stripFrontmatter(markdown);
  const requestSection = withoutFrontmatter.match(/(?:^|\n)## Request\n([\s\S]*?)(?:\n## |$)/m)?.[1]?.trim();
  const withoutResponse = stripResponseSection(withoutFrontmatter)
    .replace(/(?:^|\n)## Handling\n[\s\S]*$/m, '')
    .replace(/^#.+$/m, '')
    .trim();

  return (requestSection || withoutResponse || fallbackTitle).slice(0, 4000).trim();
};

const deriveGuildId = (filePath: string, markdown: string): string => {
  const frontmatterGuildId = readFrontmatterProperty(markdown, 'guild_id');
  if (/^\d{6,30}$/.test(frontmatterGuildId)) {
    return frontmatterGuildId;
  }

  const match = normalizePath(filePath).match(/^guilds\/(\d{6,30})\//);
  return match?.[1] || '';
};

const isAnsweredNote = (markdown: string): boolean => {
  const status = readFrontmatterProperty(markdown, 'status').toLowerCase();
  return status === 'answered'
    || Boolean(readFrontmatterProperty(markdown, 'answered_at'))
    || Boolean(readFrontmatterProperty(markdown, 'answer_note'))
    || /(?:^|\n)## Response\n/m.test(markdown);
};

const isBootstrapNote = (filePath: string, markdown: string): boolean => {
  const source = readFrontmatterProperty(markdown, 'source');
  const title = readFrontmatterProperty(markdown, 'title');
  const normalizedPath = normalizePath(filePath).toLowerCase();
  return source === 'local-chat-bootstrap'
    || normalizedPath.endsWith('/00 inbox.md')
    || normalizedPath === 'chat/inbox/00 inbox.md'
    || title.toLowerCase() === 'inbox';
};

const isInboxCandidatePath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith('chat/inbox/') || normalized.includes('/chat/inbox/');
};

const listCandidatePaths = async (vaultPath: string): Promise<string[]> => {
  const [rootFiles, taggedResults] = await Promise.all([
    listObsidianFilesWithAdapter(vaultPath, 'chat/inbox', 'md'),
    searchObsidianVaultWithAdapter({ vaultPath, query: 'tag:inbox', limit: OBSIDIAN_INBOX_CHAT_LOOP_SEARCH_LIMIT }),
  ]);

  const candidates = new Set<string>();
  for (const file of rootFiles) {
    const normalized = normalizePath(file.filePath);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  for (const result of taggedResults) {
    const normalized = normalizePath(result.filePath);
    if (normalized && isInboxCandidatePath(normalized)) {
      candidates.add(normalized);
    }
  }

  return [...candidates].sort().reverse();
};

export const runObsidianInboxChatProcessorCycle = async (): Promise<InboxProcessorCycleSummary> => {
  const vaultPath = getObsidianVaultRoot() || '';
  const candidatePaths = await listCandidatePaths(vaultPath);
  const processedPaths: string[] = [];

  for (const filePath of candidatePaths) {
    if (processedPaths.length >= OBSIDIAN_INBOX_CHAT_LOOP_MAX_NOTES_PER_RUN) {
      break;
    }

    try {
      const markdown = await readObsidianFileWithAdapter({ vaultPath, filePath });
      if (!markdown) {
        continue;
      }
      if (isBootstrapNote(filePath, markdown) || isAnsweredNote(markdown)) {
        continue;
      }

      const title = extractTitle(markdown, filePath);
      const message = extractMessage(markdown, title);
      if (!message) {
        continue;
      }

      await processInboxChatNote({
        message,
        title,
        guildId: deriveGuildId(filePath, markdown),
        requesterId: readFrontmatterProperty(markdown, 'requester_id') || 'obsidian-inbox-processor',
        requesterKind: 'bearer',
        noteContent: markdown,
        notePath: filePath,
        persist: true,
        maxDocs: 6,
        contextMode: 'metadata_first',
        replyToPath: normalizePath(readFrontmatterProperty(markdown, 'in_reply_to')) || null,
        threadRootPath: normalizePath(readFrontmatterProperty(markdown, 'thread_root')) || filePath,
      });

      processedPaths.push(filePath);
    } catch (error) {
      logger.warn('[OBSIDIAN-INBOX-CHAT] failed file=%s error=%s', filePath, getErrorMessage(error));
    }
  }

  state.processedTotal += processedPaths.length;
  state.lastFinishedAt = new Date().toISOString();
  state.lastCandidateCount = candidatePaths.length;
  state.lastProcessedPaths = processedPaths;

  return {
    candidateCount: candidatePaths.length,
    processedCount: processedPaths.length,
    processedPaths,
  };
};

export const startObsidianInboxChatLoop = (): void => {
  if (!OBSIDIAN_INBOX_CHAT_LOOP_ENABLED || loop) {
    return;
  }

  loop = new BackgroundLoop(
    async () => {
      const summary = await runObsidianInboxChatProcessorCycle();
      return `candidates=${summary.candidateCount} processed=${summary.processedCount}`;
    },
    {
      name: '[OBSIDIAN-INBOX-CHAT]',
      intervalMs: OBSIDIAN_INBOX_CHAT_LOOP_INTERVAL_SEC * 1000,
      runOnStart: OBSIDIAN_INBOX_CHAT_LOOP_RUN_ON_START,
      errorLevel: 'warn',
    },
  );

  loop.start();
};

export const stopObsidianInboxChatLoop = (): void => {
  loop?.stop();
  loop = null;
};

export const getObsidianInboxChatLoopStats = () => ({
  enabled: OBSIDIAN_INBOX_CHAT_LOOP_ENABLED,
  running: loop?.isRunning ?? false,
  started: loop?.isStarted ?? false,
  intervalSec: OBSIDIAN_INBOX_CHAT_LOOP_INTERVAL_SEC,
  runOnStart: OBSIDIAN_INBOX_CHAT_LOOP_RUN_ON_START,
  processedTotal: state.processedTotal,
  lastFinishedAt: state.lastFinishedAt,
  lastCandidateCount: state.lastCandidateCount,
  lastProcessedPaths: [...state.lastProcessedPaths],
  lastSummary: loop?.getStats().lastSummary ?? null,
});
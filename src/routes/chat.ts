import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { MCP_WORKER_AUTH_TOKEN } from '../config';
import { generateText, isAnyLlmConfigured, resolveLlmProvider } from '../services/llmClient';
import { doc } from '../services/obsidian/obsidianDocBuilder';
import { queryObsidianRAG, type RAGQueryResult } from '../services/obsidian/obsidianRagService';
import { getObsidianAdapterRuntimeStatus, readObsidianFileWithAdapter, writeObsidianNoteWithAdapter } from '../services/obsidian/router';
import { getErrorMessage } from '../utils/errorMessage';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { isOneOf, toBoundedInt, toStringParam } from '../utils/validation';

const MAX_MESSAGE_CHARS = 4_000;
const MAX_TITLE_CHARS = 120;
const DEFAULT_MAX_DOCS = 6;
const MAX_DOCS = 12;
const RAG_CONTEXT_LIMIT = 6_000;
const PARENT_NOTE_CONTEXT_LIMIT = 3_000;
const ANSWER_SUMMARY_LIMIT = 240;
const MAX_TOKENS = 700;
const LOCAL_ADAPTERS = new Set(['local-fs', 'native-cli']);

type ChatContextMode = 'metadata_first' | 'full';
type ChatStatusMode = 'unavailable' | 'local-first' | 'hybrid' | 'remote-first';

export type InboxChatStatus = {
  reachable: boolean;
  localFirstReady: boolean;
  mode: ChatStatusMode;
  reasons: string[];
};

type InboxNoteParams = {
  message: string;
  title: string;
  guildId: string;
  requesterId: string;
  requesterKind: 'session' | 'bearer';
  now: Date;
  replyToPath?: string | null;
  threadRootPath?: string | null;
};

type AnswerNoteParams = {
  question: string;
  title: string;
  answer: string;
  guildId: string;
  requesterId: string;
  requesterKind: 'session' | 'bearer';
  now: Date;
  requestNotePath: string | null;
  replyToPath?: string | null;
  threadRootPath?: string | null;
  ragResult: RAGQueryResult | null;
};

const validateBearer = (req: Request): boolean => {
  const token = MCP_WORKER_AUTH_TOKEN.trim();
  if (!token) return false;

  const authHeader = String(req.headers.authorization || '').trim();
  if (!/^Bearer\s+/i.test(authHeader)) return false;

  const incoming = authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = Buffer.from(token);
  const received = Buffer.from(incoming);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
};

const requireRouteAuth = (req: Request, res: Response): boolean => {
  if (req.user || validateBearer(req)) return true;
  res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  return false;
};

const sanitizeGuildId = (value: unknown): string => {
  const candidate = String(value || '').trim();
  return /^\d{6,30}$/.test(candidate) ? candidate : '';
};

const sanitizeSlug = (value: string, fallback: string): string => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
};

const sanitizeNotePath = (value: unknown): string => {
  const candidate = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!candidate || candidate.includes('..') || /[<>:"|?*]/.test(candidate)) return '';
  return candidate.endsWith('.md') ? candidate : `${candidate}.md`;
};

const stripMarkdownExtension = (value: string): string => String(value || '').trim().replace(/\.md$/i, '');

const toObsidianWikilink = (value: string, alias?: string): string => {
  const target = stripMarkdownExtension(value);
  if (!target) return alias || '';
  return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
};

const readFrontmatterProperty = (markdown: string | null, key: string): string => {
  const source = String(markdown || '');
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return '';
  const property = key.replace(/[^a-zA-Z0-9_]/g, '_');
  const line = match[1].split('\n').find((entry) => entry.startsWith(`${property}:`));
  return line ? line.slice(property.length + 1).trim() : '';
};

const updateFrontmatterProperty = (markdown: string, key: string, value: string): string => {
  const source = String(markdown || '');
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return source;

  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return source;

  const property = key.replace(/[^a-zA-Z0-9_]/g, '_');
  const lines = match[1].split('\n');
  const index = lines.findIndex((entry) => entry.startsWith(`${property}:`));
  if (index >= 0) lines[index] = `${property}: ${normalizedValue}`;
  else lines.push(`${property}: ${normalizedValue}`);

  const rest = source.slice(match[0].length).replace(/^\n+/, '');
  return ['---', ...lines, '---', '', rest].join('\n').trimEnd() + '\n';
};

const summarizeAnswer = (answer: string): string => String(answer || '').replace(/\s+/g, ' ').trim().slice(0, ANSWER_SUMMARY_LIMIT);

const annotateInboxNoteWithAnswer = (params: {
  markdown: string;
  answeredAt: Date;
  answerSummary: string;
  answerNotePath: string | null;
  replyToPath: string | null;
  threadRootPath: string | null;
}): string => {
  let next = updateFrontmatterProperty(params.markdown, 'status', 'answered');
  next = updateFrontmatterProperty(next, 'answered_at', params.answeredAt.toISOString());
  if (params.threadRootPath) next = updateFrontmatterProperty(next, 'thread_root', params.threadRootPath);
  if (params.replyToPath) next = updateFrontmatterProperty(next, 'in_reply_to', params.replyToPath);
  if (params.answerNotePath) next = updateFrontmatterProperty(next, 'answer_note', params.answerNotePath);

  const responseLines = [
    '## Response',
    '',
    `- answered_at: ${params.answeredAt.toISOString()}`,
    params.answerNotePath
      ? `- answer_note: ${toObsidianWikilink(params.answerNotePath)}`
      : '- answer_note: (write failed)',
    params.replyToPath ? `- in_reply_to: ${toObsidianWikilink(params.replyToPath)}` : '',
    params.threadRootPath ? `- thread_root: ${toObsidianWikilink(params.threadRootPath)}` : '',
    '',
    params.answerSummary,
    '',
  ].filter(Boolean);
  const responseBlock = responseLines.join('\n');

  if (/\n## Response\n/.test(next)) {
    return next.replace(/\n## Response\n[\s\S]*$/m, `\n${responseBlock}`.trimEnd() + '\n');
  }

  return `${next.trimEnd()}\n\n${responseBlock}\n`;
};

const buildInboxNotePath = (params: { guildId: string; requesterId: string; title: string; now: Date }): string => {
  const date = params.now.toISOString().slice(0, 10);
  const time = params.now.toISOString().slice(11, 19).replace(/:/g, '');
  const slug = sanitizeSlug(params.title, sanitizeSlug(params.requesterId, 'external'));
  const root = params.guildId ? `guilds/${params.guildId}/chat/inbox` : 'chat/inbox';
  return `${root}/${date}/${time}_${slug}.md`;
};

const buildAnswerNotePath = (params: { guildId: string; requesterId: string; title: string; now: Date }): string => {
  const date = params.now.toISOString().slice(0, 10);
  const time = params.now.toISOString().slice(11, 19).replace(/:/g, '');
  const slug = sanitizeSlug(params.title, sanitizeSlug(params.requesterId, 'assistant'));
  const root = params.guildId ? `guilds/${params.guildId}/chat/answers` : 'chat/answers';
  return `${root}/${date}/${time}_${slug}.md`;
};

export const buildInboxChatNote = (params: InboxNoteParams): {
  fileName: string;
  content: string;
  tags: string[];
  properties: Record<string, string | number | boolean>;
} => {
  const safeTitle = toStringParam(params.title).slice(0, MAX_TITLE_CHARS) || 'Inbox Chat';
  const fileName = buildInboxNotePath({
    guildId: params.guildId,
    requesterId: params.requesterId,
    title: safeTitle,
    now: params.now,
  });
  const threadRootPath = params.threadRootPath || fileName;

  const builder = doc()
    .title(safeTitle)
    .tag('chat', 'inbox', 'external-query')
    .property('title', safeTitle)
    .property('schema', 'chat-inbox/v1')
    .property('created', params.now.toISOString())
    .property('source', 'api-chat')
    .property('guild_id', params.guildId || 'system')
    .property('requester_id', params.requesterId)
    .property('requester_kind', params.requesterKind)
    .property('thread_root', threadRootPath)
    .property('status', 'open')
    .section('Request')
    .line(params.message)
    .section('Handling')
    .line('This note was created by the external inbox chat route before retrieval and response generation.');

  if (params.replyToPath) {
    builder
      .property('in_reply_to', params.replyToPath)
      .section('Thread')
      .line(`Replying to: ${toObsidianWikilink(params.replyToPath)}`)
      .line(`Thread root: ${toObsidianWikilink(threadRootPath)}`)
      .follows(params.replyToPath);

    if (threadRootPath !== params.replyToPath) {
      builder.references(threadRootPath, 'Thread Root');
    }
  }

  const { markdown: content, tags, properties } = builder.buildWithFrontmatter();
  return { fileName, content, tags, properties };
};

export const buildAnswerChatNote = (params: AnswerNoteParams): {
  fileName: string;
  content: string;
  tags: string[];
  properties: Record<string, string | number | boolean>;
} => {
  const safeTitle = toStringParam(params.title).slice(0, MAX_TITLE_CHARS) || 'Inbox Chat';
  const fileName = buildAnswerNotePath({
    guildId: params.guildId,
    requesterId: params.requesterId,
    title: safeTitle,
    now: params.now,
  });
  const threadRootPath = params.threadRootPath || params.requestNotePath || params.replyToPath || fileName;
  const sourceFiles = dedupeStrings([params.requestNotePath, params.replyToPath, ...(params.ragResult?.sourceFiles || [])]).slice(0, 8);

  const builder = doc()
    .title(`${safeTitle} Answer`)
    .tag('chat', 'answer', 'external-query')
    .property('title', `${safeTitle} Answer`)
    .property('schema', 'chat-answer/v1')
    .property('created', params.now.toISOString())
    .property('source', 'api-chat')
    .property('guild_id', params.guildId || 'system')
    .property('requester_id', params.requesterId)
    .property('requester_kind', params.requesterKind)
    .property('thread_root', threadRootPath)
    .property('status', 'answered')
    .section('Question')
    .line(params.question)
    .section('Answer')
    .line(params.answer);

  if (params.requestNotePath) {
    builder.property('request_note', params.requestNotePath).derivedFrom(params.requestNotePath, 'Request Note');
  }

  if (params.replyToPath) {
    builder.property('in_reply_to', params.replyToPath).follows(params.replyToPath);
  }

  if (threadRootPath && threadRootPath !== params.requestNotePath && threadRootPath !== params.replyToPath) {
    builder.references(threadRootPath, 'Thread Root');
  }

  if (sourceFiles.length > 0) {
    builder.section('Sources').lines(sourceFiles.map((filePath) => `- ${toObsidianWikilink(filePath)}`));
  }

  const { markdown: content, tags, properties } = builder.buildWithFrontmatter();
  return { fileName, content, tags, properties };
};

export const evaluateInboxChatStatus = (params: {
  vaultConfigured: boolean;
  llmConfigured: boolean;
  searchAdapter: string | null;
  writeAdapter: string | null;
}): InboxChatStatus => {
  const reasons: string[] = [];
  if (!params.vaultConfigured) reasons.push('vault_not_ready');
  if (!params.llmConfigured) reasons.push('llm_not_configured');
  if (!params.searchAdapter) reasons.push('search_adapter_missing');
  if (!params.writeAdapter) reasons.push('write_adapter_missing');

  const searchLocal = params.searchAdapter ? LOCAL_ADAPTERS.has(params.searchAdapter) : false;
  const writeLocal = params.writeAdapter ? LOCAL_ADAPTERS.has(params.writeAdapter) : false;

  let mode: ChatStatusMode = 'unavailable';
  if (params.searchAdapter || params.writeAdapter) {
    if (searchLocal && writeLocal) mode = 'local-first';
    else if (searchLocal || writeLocal) mode = 'hybrid';
    else mode = 'remote-first';
  }

  const reachable = params.vaultConfigured && params.llmConfigured;
  return {
    reachable,
    localFirstReady: reachable && mode === 'local-first',
    mode,
    reasons,
  };
};

const buildLlmPrompt = (params: {
  message: string;
  noteContent: string;
  notePath: string | null;
  replyToPath: string | null;
  replyToContent: string | null;
  threadRootPath: string | null;
  ragResult: RAGQueryResult | null;
  contextMode: ChatContextMode;
}): { system: string; user: string } => {
  const ragContext = params.ragResult?.documentContext
    ? params.ragResult.documentContext.slice(0, RAG_CONTEXT_LIMIT)
    : '(No additional vault context found)';
  const parentNote = params.replyToContent
    ? params.replyToContent.slice(0, PARENT_NOTE_CONTEXT_LIMIT)
    : '(No parent thread note provided)';
  const sourceList = params.ragResult?.sourceFiles?.length
    ? params.ragResult.sourceFiles.slice(0, 8).join(', ')
    : '(No related source files)';

  return {
    system: [
      'You are a precise assistant answering in Korean.',
      'Obsidian here means the note-taking vault used by the app, not volcanic glass.',
      'Treat the inbox note as the freshest user-authored source.',
      'If a parent thread note is provided, continue that conversation naturally instead of restarting from scratch.',
      'Use only the provided inbox note and vault context. If the context is insufficient, say so explicitly.',
      'Keep the reply concise and actionable.',
    ].join('\n'),
    user: [
      `Question: ${params.message}`,
      '',
      '=== Inbox Note ===',
      params.notePath ? `Path: ${params.notePath}` : 'Path: (write failed)',
      params.noteContent,
      '',
      '=== Parent Thread Note ===',
      params.replyToPath ? `Path: ${params.replyToPath}` : 'Path: (none)',
      parentNote,
      '',
      '=== Thread Root ===',
      params.threadRootPath || '(none)',
      '',
      `=== Vault Context (${params.contextMode}) ===`,
      ragContext,
      '',
      `Sources: ${sourceList}`,
    ].join('\n'),
  };
};

const buildFallbackAnswer = (params: { message: string; notePath: string | null; ragResult: RAGQueryResult | null }): string => {
  const contextSnippet = params.ragResult?.documentContext
    ? params.ragResult.documentContext.replace(/\s+/g, ' ').trim().slice(0, 500)
    : 'No additional vault context was available.';
  const noteLine = params.notePath ? `Inbox note: ${params.notePath}` : 'Inbox note write failed.';
  return [
    'The local-first LLM reply failed, but the request reached the app.',
    noteLine,
    `Question: ${params.message}`,
    `Context preview: ${contextSnippet}`,
  ].join(' ');
};

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

export const createChatRouter = (): Router => {
  const router = Router();

  router.get('/status', (req, res) => {
    if (!requireRouteAuth(req, res)) return;

    const adapterStatus = getObsidianAdapterRuntimeStatus();
    const vaultPath = getObsidianVaultRoot();
    const vaultConfigured = Boolean(vaultPath) && existsSync(vaultPath);
    const llmConfigured = isAnyLlmConfigured();
    const readiness = evaluateInboxChatStatus({
      vaultConfigured,
      llmConfigured,
      searchAdapter: adapterStatus.selectedByCapability.search_vault,
      writeAdapter: adapterStatus.selectedByCapability.write_note,
    });

    res.json({
      ok: true,
      readiness,
      auth: {
        session: true,
        bearerTokenConfigured: Boolean(MCP_WORKER_AUTH_TOKEN.trim()),
      },
      llm: {
        configured: llmConfigured,
        configuredProviderHint: resolveLlmProvider(),
        routeProviderProfile: 'cost-optimized',
      },
      obsidian: {
        vaultConfigured,
        selectedSearchAdapter: adapterStatus.selectedByCapability.search_vault,
        selectedWriteAdapter: adapterStatus.selectedByCapability.write_note,
        configuredOrder: adapterStatus.configuredOrder,
      },
    });
  });

  router.post('/inbox', async (req, res) => {
    if (!requireRouteAuth(req, res)) return;

    const message = toStringParam(req.body?.message).slice(0, MAX_MESSAGE_CHARS);
    if (!message) {
      return res.status(422).json({ ok: false, error: 'INVALID_MESSAGE', message: 'message is required' });
    }

    const requestedTitle = toStringParam(req.body?.title).slice(0, MAX_TITLE_CHARS);
    const title = requestedTitle || message.slice(0, 72);
    const guildId = sanitizeGuildId(req.body?.guildId);
    const maxDocs = toBoundedInt(req.body?.maxDocs, DEFAULT_MAX_DOCS, { min: 1, max: MAX_DOCS });
    const persist = req.body?.persist !== false;
    const contextModeRaw = toStringParam(req.body?.contextMode).toLowerCase();
    const contextMode: ChatContextMode = isOneOf(contextModeRaw, ['metadata_first', 'full']) ? contextModeRaw : 'metadata_first';
    const replyToPath = sanitizeNotePath(req.body?.replyToPath) || null;
    const explicitThreadRootPath = sanitizeNotePath(req.body?.threadRootPath) || null;

    const vaultPath = getObsidianVaultRoot();
    const adapterStatus = getObsidianAdapterRuntimeStatus();
    const readiness = evaluateInboxChatStatus({
      vaultConfigured: Boolean(vaultPath) && existsSync(vaultPath),
      llmConfigured: isAnyLlmConfigured(),
      searchAdapter: adapterStatus.selectedByCapability.search_vault,
      writeAdapter: adapterStatus.selectedByCapability.write_note,
    });

    if (!readiness.reachable || !vaultPath) {
      return res.status(503).json({
        ok: false,
        error: 'LOCAL_FIRST_CHAT_NOT_READY',
        readiness,
      });
    }

    const warnings: string[] = [];
    let replyToContent: string | null = null;
    if (replyToPath) {
      try {
        replyToContent = await readObsidianFileWithAdapter({
          vaultPath,
          filePath: replyToPath,
        });
        if (!replyToContent) warnings.push('reply_to_note_missing');
      } catch (error) {
        warnings.push(`reply_to_read_failed:${getErrorMessage(error)}`);
      }
    }

    const derivedThreadRootPath = explicitThreadRootPath
      || readFrontmatterProperty(replyToContent, 'thread_root')
      || replyToPath;

    const requesterId = req.user?.id || 'external';
    const requesterKind: 'session' | 'bearer' = req.user ? 'session' : 'bearer';
    const note = buildInboxChatNote({
      message,
      title,
      guildId,
      requesterId,
      requesterKind,
      now: new Date(),
      replyToPath,
      threadRootPath: derivedThreadRootPath,
    });
    let inboxNotePath: string | null = null;

    if (persist) {
      try {
        const result = await writeObsidianNoteWithAdapter({
          guildId,
          vaultPath,
          fileName: note.fileName,
          content: note.content,
          tags: note.tags,
          properties: note.properties,
        });
        inboxNotePath = result?.path || null;
        if (!inboxNotePath) warnings.push('vault_write_failed');
      } catch (error) {
        warnings.push(`vault_write_failed:${getErrorMessage(error)}`);
      }
    }

    let ragResult: RAGQueryResult | null = null;
    try {
      ragResult = await queryObsidianRAG(message, {
        maxDocs,
        contextMode,
        guildId: guildId || undefined,
      });
    } catch (error) {
      warnings.push(`rag_query_failed:${getErrorMessage(error)}`);
    }

    const prompt = buildLlmPrompt({
      message,
      noteContent: note.content,
      notePath: inboxNotePath,
      replyToPath,
      replyToContent,
      threadRootPath: derivedThreadRootPath || inboxNotePath || note.fileName,
      ragResult,
      contextMode,
    });

    let answer = '';
    try {
      answer = await generateText({
        system: prompt.system,
        user: prompt.user,
        maxTokens: MAX_TOKENS,
        guildId: guildId || undefined,
        requestedBy: req.user?.id || requesterId,
        actionName: 'chat.inbox',
        providerProfile: 'cost-optimized',
      });
    } catch (error) {
      warnings.push(`llm_generation_failed:${getErrorMessage(error)}`);
      answer = buildFallbackAnswer({ message, notePath: inboxNotePath, ragResult });
    }

    const answeredAt = new Date();
    const effectiveThreadRootPath = derivedThreadRootPath || inboxNotePath || note.fileName;
    let answerNotePath: string | null = null;

    if (persist) {
      const answerNote = buildAnswerChatNote({
        question: message,
        title,
        answer,
        guildId,
        requesterId,
        requesterKind,
        now: answeredAt,
        requestNotePath: inboxNotePath,
        replyToPath,
        threadRootPath: effectiveThreadRootPath,
        ragResult,
      });

      try {
        const result = await writeObsidianNoteWithAdapter({
          guildId,
          vaultPath,
          fileName: answerNote.fileName,
          content: answerNote.content,
          tags: answerNote.tags,
          properties: answerNote.properties,
        });
        answerNotePath = result?.path || null;
        if (!answerNotePath) warnings.push('answer_note_write_failed');
      } catch (error) {
        warnings.push(`answer_note_write_failed:${getErrorMessage(error)}`);
      }

      if (inboxNotePath) {
        try {
          const currentInboxNote = await readObsidianFileWithAdapter({
            vaultPath,
            filePath: inboxNotePath,
          });
          if (!currentInboxNote) {
            warnings.push('inbox_note_read_failed');
          } else {
            const updatedInboxNote = annotateInboxNoteWithAnswer({
              markdown: currentInboxNote,
              answeredAt,
              answerSummary: summarizeAnswer(answer),
              answerNotePath,
              replyToPath,
              threadRootPath: effectiveThreadRootPath,
            });
            const rewrite = await writeObsidianNoteWithAdapter({
              guildId,
              vaultPath,
              fileName: inboxNotePath,
              content: updatedInboxNote,
              tags: note.tags,
              properties: {
                ...note.properties,
                status: 'answered',
                answered_at: answeredAt.toISOString(),
                thread_root: effectiveThreadRootPath,
                ...(replyToPath ? { in_reply_to: replyToPath } : {}),
                ...(answerNotePath ? { answer_note: answerNotePath } : {}),
              },
            });
            if (!rewrite?.path) warnings.push('inbox_note_update_failed');
          }
        } catch (error) {
          warnings.push(`inbox_note_update_failed:${getErrorMessage(error)}`);
        }
      }
    }

    return res.json({
      ok: true,
      answer,
      inbox: {
        persisted: Boolean(inboxNotePath),
        path: inboxNotePath,
      },
      answerNote: {
        persisted: Boolean(answerNotePath),
        path: answerNotePath,
      },
      thread: {
        replyToPath,
        threadRootPath: effectiveThreadRootPath,
      },
      retrieval: {
        intent: ragResult?.intent ?? null,
        documentCount: ragResult?.documentCount ?? 0,
        executionTimeMs: ragResult?.executionTimeMs ?? 0,
        sourceFiles: dedupeStrings([replyToPath, inboxNotePath, ...(ragResult?.sourceFiles || [])]),
      },
      localFirst: readiness,
      warnings,
    });
  });

  return router;
};
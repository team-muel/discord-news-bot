import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { MCP_WORKER_AUTH_TOKEN } from '../config';
import { generateText, isAnyLlmConfigured, resolveLlmProvider } from '../services/llmClient';
import { doc } from '../services/obsidian/obsidianDocBuilder';
import { queryObsidianRAG, type RAGQueryResult } from '../services/obsidian/obsidianRagService';
import { getObsidianAdapterRuntimeStatus, getObsidianVaultLiveHealthStatus, readObsidianFileWithAdapter, writeObsidianNoteWithAdapter } from '../services/obsidian/router';
import type { ObsidianFrontmatterValue } from '../services/obsidian/types';
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
const NON_FILESYSTEM_ADAPTERS = new Set(['remote-mcp', 'native-cli', 'script-cli']);

export type ChatContextMode = 'metadata_first' | 'full';
type ChatStatusMode = 'unavailable' | 'local-first' | 'hybrid' | 'remote-first';
export type InboxChatRequesterKind = 'session' | 'bearer';

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
  requesterKind: InboxChatRequesterKind;
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
  requesterKind: InboxChatRequesterKind;
  now: Date;
  requestNotePath: string | null;
  replyToPath?: string | null;
  threadRootPath?: string | null;
  ragResult: RAGQueryResult | null;
};

export type ProcessInboxChatNoteParams = {
  message: string;
  title: string;
  guildId: string;
  requesterId: string;
  requesterKind: InboxChatRequesterKind;
  noteContent: string;
  notePath: string | null;
  persist: boolean;
  maxDocs: number;
  contextMode: ChatContextMode;
  replyToPath?: string | null;
  threadRootPath?: string | null;
  noteTags?: string[];
  noteProperties?: Record<string, ObsidianFrontmatterValue>;
};

export type ProcessInboxChatNoteResult = {
  answer: string;
  answerNote: {
    persisted: boolean;
    path: string | null;
  };
  thread: {
    replyToPath: string | null;
    threadRootPath: string;
  };
  retrieval: {
    intent: string | null;
    documentCount: number;
    executionTimeMs: number;
    sourceFiles: string[];
  };
  localFirst: InboxChatStatus;
  warnings: string[];
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

export const readFrontmatterProperty = (markdown: string | null, key: string): string => {
  const source = String(markdown || '');
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return '';
  const property = key.replace(/[^a-zA-Z0-9_]/g, '_');
  const line = match[1].split('\n').find((entry) => entry.startsWith(`${property}:`));
  const rawValue = line ? line.slice(property.length + 1).trim() : '';
  return rawValue.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
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
  properties: Record<string, ObsidianFrontmatterValue>;
} => {
  const safeTitle = toStringParam(params.title).slice(0, MAX_TITLE_CHARS) || 'Inbox Chat';
  const fileName = buildInboxNotePath({
    guildId: params.guildId,
    requesterId: params.requesterId,
    title: safeTitle,
    now: params.now,
  });
  const threadRootPath = params.threadRootPath || fileName;
  const observedAt = params.now.toISOString();
  const sourceRefs = dedupeStrings([params.replyToPath, threadRootPath]);

  const builder = doc()
    .title(safeTitle)
    .tag('chat', 'inbox', 'external-query')
    .property('title', safeTitle)
    .property('schema', 'chat-inbox/v1')
    .property('created', observedAt)
    .property('observed_at', observedAt)
    .property('valid_at', observedAt)
    .property('source', 'api-chat')
    .property('guild_id', params.guildId || 'system')
    .property('requester_id', params.requesterId)
    .property('requester_kind', params.requesterKind)
    .property('thread_root', threadRootPath)
    .property('canonical_key', stripMarkdownExtension(threadRootPath))
    .property('status', 'open')
    .section('Request')
    .line(params.message)
    .section('Handling')
    .line('This note was created by the external inbox chat route before retrieval and response generation.');

  if (sourceRefs.length > 0) {
    builder.property('source_refs', sourceRefs);
  }

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
  properties: Record<string, ObsidianFrontmatterValue>;
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
  const observedAt = params.now.toISOString();

  const builder = doc()
    .title(`${safeTitle} Answer`)
    .tag('chat', 'answer', 'external-query')
    .property('title', `${safeTitle} Answer`)
    .property('schema', 'chat-answer/v1')
    .property('created', observedAt)
    .property('observed_at', observedAt)
    .property('valid_at', observedAt)
    .property('source', 'api-chat')
    .property('guild_id', params.guildId || 'system')
    .property('requester_id', params.requesterId)
    .property('requester_kind', params.requesterKind)
    .property('thread_root', threadRootPath)
    .property('canonical_key', stripMarkdownExtension(threadRootPath))
    .property('status', 'answered')
    .property('source_count', sourceFiles.length)
    .section('Question')
    .line(params.question)
    .section('Answer')
    .line(params.answer);

  if (sourceFiles.length > 0) {
    builder.property('source_refs', sourceFiles);
  }
  if (params.ragResult?.intent) {
    builder.property('retrieval_intent', params.ragResult.intent);
  }

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
  vaultPath: string;
  llmConfigured: boolean;
  searchAdapter: string | null;
  writeAdapter: string | null;
}): InboxChatStatus => {
  const searchReady = Boolean(params.searchAdapter)
    && (NON_FILESYSTEM_ADAPTERS.has(String(params.searchAdapter)) || (Boolean(params.vaultPath) && existsSync(params.vaultPath)));
  const writeReady = Boolean(params.writeAdapter)
    && (NON_FILESYSTEM_ADAPTERS.has(String(params.writeAdapter)) || (Boolean(params.vaultPath) && existsSync(params.vaultPath)));

  const reasons: string[] = [];
  if (!params.llmConfigured) reasons.push('llm_not_configured');
  if (!searchReady) reasons.push('search_adapter_missing');
  if (!writeReady) reasons.push('write_adapter_missing');
  if (!searchReady && !writeReady) reasons.push('vault_not_ready');

  const searchLocal = params.searchAdapter ? LOCAL_ADAPTERS.has(params.searchAdapter) : false;
  const writeLocal = params.writeAdapter ? LOCAL_ADAPTERS.has(params.writeAdapter) : false;

  let mode: ChatStatusMode = 'unavailable';
  if (params.searchAdapter || params.writeAdapter) {
    if (searchLocal && writeLocal) mode = 'local-first';
    else if (searchLocal || writeLocal) mode = 'hybrid';
    else mode = 'remote-first';
  }

  const reachable = searchReady && params.llmConfigured;
  return {
    reachable,
    localFirstReady: reachable && writeReady && mode === 'local-first',
    mode,
    reasons,
  };
};

export const processInboxChatNote = async (params: ProcessInboxChatNoteParams): Promise<ProcessInboxChatNoteResult> => {
  const vaultPath = getObsidianVaultRoot() || '';
  const adapterStatus = getObsidianAdapterRuntimeStatus();
  const readiness = evaluateInboxChatStatus({
    vaultPath,
    llmConfigured: isAnyLlmConfigured(),
    searchAdapter: adapterStatus.selectedByCapability.search_vault,
    writeAdapter: adapterStatus.selectedByCapability.write_note,
  });

  if (!readiness.reachable) {
    throw new Error('LOCAL_FIRST_CHAT_NOT_READY');
  }

  const warnings: string[] = [];
  if (adapterStatus.routingState.remoteMcpCircuitOpen) {
    warnings.push(`remote_mcp_deprioritized:${adapterStatus.routingState.remoteMcpCircuitReason || 'unknown'}`);
  }
  let replyToContent: string | null = null;
  if (params.replyToPath) {
    try {
      replyToContent = await readObsidianFileWithAdapter({
        vaultPath,
        filePath: params.replyToPath,
      });
      if (!replyToContent) warnings.push('reply_to_note_missing');
    } catch (error) {
      warnings.push(`reply_to_read_failed:${getErrorMessage(error)}`);
    }
  }

  const derivedThreadRootPath = params.threadRootPath
    || readFrontmatterProperty(replyToContent, 'thread_root')
    || params.replyToPath
    || params.notePath;

  let ragResult: RAGQueryResult | null = null;
  try {
    ragResult = await queryObsidianRAG(params.message, {
      maxDocs: params.maxDocs,
      contextMode: params.contextMode,
      guildId: params.guildId || undefined,
    });
  } catch (error) {
    warnings.push(`rag_query_failed:${getErrorMessage(error)}`);
  }

  const prompt = buildLlmPrompt({
    message: params.message,
    noteContent: params.noteContent,
    notePath: params.notePath,
    replyToPath: params.replyToPath || null,
    replyToContent,
    threadRootPath: derivedThreadRootPath || params.notePath,
    ragResult,
    contextMode: params.contextMode,
  });

  let answer = '';
  try {
    answer = await generateText({
      system: prompt.system,
      user: prompt.user,
      maxTokens: MAX_TOKENS,
      guildId: params.guildId || undefined,
      requestedBy: params.requesterId,
      actionName: 'chat.inbox',
      providerProfile: 'cost-optimized',
    });
  } catch (error) {
    warnings.push(`llm_generation_failed:${getErrorMessage(error)}`);
    answer = buildFallbackAnswer({ message: params.message, notePath: params.notePath, ragResult });
  }

  const answeredAt = new Date();
  const effectiveThreadRootPath = derivedThreadRootPath || params.notePath || 'chat/inbox';
  let answerNotePath: string | null = null;

  if (params.persist) {
    const answerNote = buildAnswerChatNote({
      question: params.message,
      title: params.title,
      answer,
      guildId: params.guildId,
      requesterId: params.requesterId,
      requesterKind: params.requesterKind,
      now: answeredAt,
      requestNotePath: params.notePath,
      replyToPath: params.replyToPath || undefined,
      threadRootPath: effectiveThreadRootPath,
      ragResult,
    });

    try {
      const result = await writeObsidianNoteWithAdapter({
        guildId: params.guildId,
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

    if (params.notePath) {
      try {
        const currentInboxNote = await readObsidianFileWithAdapter({
          vaultPath,
          filePath: params.notePath,
        });
        const updatedInboxNote = annotateInboxNoteWithAnswer({
          markdown: currentInboxNote || params.noteContent,
          answeredAt,
          answerSummary: summarizeAnswer(answer),
          answerNotePath,
          replyToPath: params.replyToPath || null,
          threadRootPath: effectiveThreadRootPath,
        });
        const rewrite = await writeObsidianNoteWithAdapter({
          guildId: params.guildId,
          vaultPath,
          fileName: params.notePath,
          content: updatedInboxNote,
          tags: params.noteTags,
          properties: params.noteProperties,
        });
        if (!rewrite?.path) warnings.push('inbox_note_update_failed');
      } catch (error) {
        warnings.push(`inbox_note_update_failed:${getErrorMessage(error)}`);
      }
    }
  }

  return {
    answer,
    answerNote: {
      persisted: Boolean(answerNotePath),
      path: answerNotePath,
    },
    thread: {
      replyToPath: params.replyToPath || null,
      threadRootPath: effectiveThreadRootPath,
    },
    retrieval: {
      intent: ragResult?.intent ?? null,
      documentCount: ragResult?.documentCount ?? 0,
      executionTimeMs: ragResult?.executionTimeMs ?? 0,
      sourceFiles: dedupeStrings([params.replyToPath, params.notePath, ...(ragResult?.sourceFiles || [])]),
    },
    localFirst: readiness,
    warnings,
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

  router.get('/status', async (req, res) => {
    if (!requireRouteAuth(req, res)) return;

    const adapterStatus = getObsidianAdapterRuntimeStatus();
    const vaultPath = getObsidianVaultRoot() || '';
    const llmConfigured = isAnyLlmConfigured();
    const readiness = evaluateInboxChatStatus({
      vaultPath,
      llmConfigured,
      searchAdapter: adapterStatus.selectedByCapability.search_vault,
      writeAdapter: adapterStatus.selectedByCapability.write_note,
    });
    const vaultHealth = await getObsidianVaultLiveHealthStatus();

    res.json({
      ok: true,
      readiness,
      vaultHealth,
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
        vaultConfigured: Boolean(vaultPath) && existsSync(vaultPath),
        selectedSearchAdapter: adapterStatus.selectedByCapability.search_vault,
        selectedWriteAdapter: adapterStatus.selectedByCapability.write_note,
        configuredOrder: adapterStatus.configuredOrder,
        effectiveOrderByCapability: adapterStatus.effectiveOrderByCapability,
        routingState: adapterStatus.routingState,
        remoteMcp: adapterStatus.remoteMcp,
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

    const vaultPath = getObsidianVaultRoot() || '';
    const adapterStatus = getObsidianAdapterRuntimeStatus();
    const readiness = evaluateInboxChatStatus({
      vaultPath,
      llmConfigured: isAnyLlmConfigured(),
      searchAdapter: adapterStatus.selectedByCapability.search_vault,
      writeAdapter: adapterStatus.selectedByCapability.write_note,
    });

    if (!readiness.reachable) {
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
    const requesterKind: InboxChatRequesterKind = req.user ? 'session' : 'bearer';
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

    const result = await processInboxChatNote({
      message,
      title,
      guildId,
      requesterId,
      requesterKind,
      noteContent: note.content,
      notePath: inboxNotePath,
      persist,
      maxDocs,
      contextMode,
      replyToPath,
      threadRootPath: derivedThreadRootPath,
      noteTags: note.tags,
      noteProperties: note.properties,
    });

    return res.json({
      ok: true,
      answer: result.answer,
      inbox: {
        persisted: Boolean(inboxNotePath),
        path: inboxNotePath,
      },
      answerNote: result.answerNote,
      thread: result.thread,
      retrieval: result.retrieval,
      localFirst: result.localFirst,
      warnings: dedupeStrings([...warnings, ...result.warnings]),
    });
  });

  return router;
};
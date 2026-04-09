import { Router } from 'express';
import { describe, expect, it } from 'vitest';

import { buildAnswerChatNote, buildInboxChatNote, createChatRouter, evaluateInboxChatStatus } from './chat';

type RouteEntry = {
  method: string;
  path: string;
};

const collectRoutes = (router: Router): RouteEntry[] => {
  const stack = (router as unknown as { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> }).stack || [];
  const routes: RouteEntry[] = [];

  for (const layer of stack) {
    if (!layer.route || !layer.route.path || !layer.route.methods) continue;
    const methods = Object.keys(layer.route.methods).filter((method) => layer.route?.methods?.[method]);
    for (const method of methods) {
      routes.push({ method: method.toUpperCase(), path: String(layer.route.path) });
    }
  }

  return routes;
};

describe('chat routes', () => {
  it('builds an inbox note with frontmatter and a nested chat path', () => {
    const note = buildInboxChatNote({
      message: 'Need a local-first answer from my Obsidian inbox note.',
      title: 'Local-first check',
      guildId: '',
      requesterId: 'user-1',
      requesterKind: 'bearer',
      now: new Date('2026-04-09T12:34:56.000Z'),
      replyToPath: 'chat/answers/2026-04-09/120000_prior-answer.md',
      threadRootPath: 'chat/inbox/2026-04-09/115900_root.md',
    });

    expect(note.fileName.startsWith('chat/inbox/2026-04-09/123456_')).toBe(true);
    expect(note.fileName.endsWith('.md')).toBe(true);
    expect(note.content).toContain('schema: chat-inbox/v1');
    expect(note.content).toContain('observed_at: 2026-04-09T12:34:56.000Z');
    expect(note.content).toContain('valid_at: 2026-04-09T12:34:56.000Z');
    expect(note.content).toContain('in_reply_to: chat/answers/2026-04-09/120000_prior-answer.md');
    expect(note.content).toContain('thread_root: chat/inbox/2026-04-09/115900_root.md');
    expect(note.content).toContain('source_refs: [chat/answers/2026-04-09/120000_prior-answer.md, chat/inbox/2026-04-09/115900_root.md]');
    expect(note.content).toContain('## Request');
    expect(note.content).toContain('Need a local-first answer from my Obsidian inbox note.');
    expect(note.content).toContain('[[chat/answers/2026-04-09/120000_prior-answer]]');
  });

  it('builds an answer note with backlinks to request and thread context', () => {
    const note = buildAnswerChatNote({
      question: '이전 답변을 이어서 정리해줘.',
      title: 'Follow-up check',
      answer: '이 답변은 이전 답변을 이어서 정리한 것입니다.',
      guildId: '',
      requesterId: 'user-1',
      requesterKind: 'bearer',
      now: new Date('2026-04-09T13:45:01.000Z'),
      requestNotePath: 'chat/inbox/2026-04-09/134500_follow-up-check.md',
      replyToPath: 'chat/answers/2026-04-09/133000_prior-answer.md',
      threadRootPath: 'chat/inbox/2026-04-09/120000_root.md',
      ragResult: {
        answer: 'vault answer',
        intent: 'development',
        documentCount: 2,
        executionTimeMs: 42,
        sourceFiles: ['guilds/123/chat/context.md'],
        documentContext: 'Context',
        contextMode: 'metadata_first',
        cacheStatus: { hits: 0, misses: 1 },
      },
    });

    expect(note.fileName.startsWith('chat/answers/2026-04-09/134501_')).toBe(true);
    expect(note.content).toContain('schema: chat-answer/v1');
    expect(note.content).toContain('observed_at: 2026-04-09T13:45:01.000Z');
    expect(note.content).toContain('request_note: chat/inbox/2026-04-09/134500_follow-up-check.md');
    expect(note.content).toContain('in_reply_to: chat/answers/2026-04-09/133000_prior-answer.md');
    expect(note.content).toContain('thread_root: chat/inbox/2026-04-09/120000_root.md');
    expect(note.content).toContain('source_count: 3');
    expect(note.content).toContain('retrieval_intent: development');
    expect(note.content).toContain('source_refs: [chat/inbox/2026-04-09/134500_follow-up-check.md, chat/answers/2026-04-09/133000_prior-answer.md, guilds/123/chat/context.md]');
    expect(note.content).toContain('[[chat/inbox/2026-04-09/134500_follow-up-check|Request Note]]');
    expect(note.content).toContain('[[chat/answers/2026-04-09/133000_prior-answer]]');
  });

  it('reports local-first readiness only when both adapters are local', () => {
    const existingVaultPath = process.cwd();

    const local = evaluateInboxChatStatus({
      vaultPath: existingVaultPath,
      llmConfigured: true,
      searchAdapter: 'local-fs',
      writeAdapter: 'native-cli',
    });
    const hybrid = evaluateInboxChatStatus({
      vaultPath: existingVaultPath,
      llmConfigured: true,
      searchAdapter: 'remote-mcp',
      writeAdapter: 'local-fs',
    });
    const remoteOnly = evaluateInboxChatStatus({
      vaultPath: '',
      llmConfigured: true,
      searchAdapter: 'remote-mcp',
      writeAdapter: 'remote-mcp',
    });

    expect(local.localFirstReady).toBe(true);
    expect(local.mode).toBe('local-first');
    expect(hybrid.localFirstReady).toBe(false);
    expect(hybrid.mode).toBe('hybrid');
    expect(remoteOnly.reachable).toBe(true);
    expect(remoteOnly.mode).toBe('remote-first');
  });

  it('registers the inbox chat endpoints', () => {
    const router = createChatRouter();
    const routes = collectRoutes(router);
    const routeKeys = new Set(routes.map((route) => `${route.method} ${route.path}`));

    expect(routeKeys.has('GET /status')).toBe(true);
    expect(routeKeys.has('POST /inbox')).toBe(true);
  });
});
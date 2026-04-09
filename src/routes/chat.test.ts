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
    expect(note.content).toContain('in_reply_to: chat/answers/2026-04-09/120000_prior-answer.md');
    expect(note.content).toContain('thread_root: chat/inbox/2026-04-09/115900_root.md');
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
      ragResult: null,
    });

    expect(note.fileName.startsWith('chat/answers/2026-04-09/134501_')).toBe(true);
    expect(note.content).toContain('schema: chat-answer/v1');
    expect(note.content).toContain('request_note: chat/inbox/2026-04-09/134500_follow-up-check.md');
    expect(note.content).toContain('in_reply_to: chat/answers/2026-04-09/133000_prior-answer.md');
    expect(note.content).toContain('thread_root: chat/inbox/2026-04-09/120000_root.md');
    expect(note.content).toContain('[[chat/inbox/2026-04-09/134500_follow-up-check|Request Note]]');
    expect(note.content).toContain('[[chat/answers/2026-04-09/133000_prior-answer]]');
  });

  it('reports local-first readiness only when both adapters are local', () => {
    const local = evaluateInboxChatStatus({
      vaultConfigured: true,
      llmConfigured: true,
      searchAdapter: 'local-fs',
      writeAdapter: 'native-cli',
    });
    const hybrid = evaluateInboxChatStatus({
      vaultConfigured: true,
      llmConfigured: true,
      searchAdapter: 'remote-mcp',
      writeAdapter: 'local-fs',
    });

    expect(local.localFirstReady).toBe(true);
    expect(local.mode).toBe('local-first');
    expect(hybrid.localFirstReady).toBe(false);
    expect(hybrid.mode).toBe('hybrid');
  });

  it('registers the inbox chat endpoints', () => {
    const router = createChatRouter();
    const routes = collectRoutes(router);
    const routeKeys = new Set(routes.map((route) => `${route.method} ${route.path}`));

    expect(routeKeys.has('GET /status')).toBe(true);
    expect(routeKeys.has('POST /inbox')).toBe(true);
  });
});
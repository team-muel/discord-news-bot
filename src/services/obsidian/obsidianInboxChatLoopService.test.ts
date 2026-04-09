import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../routes/chat', () => ({
  processInboxChatNote: vi.fn(() => Promise.resolve({
    answer: 'ok',
    answerNote: { persisted: true, path: 'chat/answers/2026-04-09/answer.md' },
    thread: { replyToPath: null, threadRootPath: 'chat/inbox/2026-04-09/test-note.md' },
    retrieval: { intent: 'memory', documentCount: 1, executionTimeMs: 10, sourceFiles: ['chat/inbox/2026-04-09/test-note.md'] },
    localFirst: { reachable: true, localFirstReady: true, mode: 'local-first', reasons: [] },
    warnings: [],
  })),
  readFrontmatterProperty: (markdown: string, key: string) => {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return '';
    const line = match[1].split('\n').find((entry) => entry.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : '';
  },
}));

vi.mock('./router', () => ({
  listObsidianFilesWithAdapter: vi.fn(() => Promise.resolve([
    { filePath: 'chat/inbox/2026-04-09/test-note.md', name: 'test-note', extension: 'md', sizeBytes: 0, modifiedAt: 0 },
  ])),
  readObsidianFileWithAdapter: vi.fn((params: { filePath: string }) => {
    if (params.filePath === 'chat/inbox/2026-04-09/test-note.md') {
      return Promise.resolve(['---', 'tags: [chat, inbox]', '---', '', '# 집가고 싶다', '', '오늘 너무 피곤한데 왜 이런지 정리해줘.'].join('\n'));
    }
    return Promise.resolve(null);
  }),
  searchObsidianVaultWithAdapter: vi.fn(() => Promise.resolve([])),
}));

describe('obsidianInboxChatLoopService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('OBSIDIAN_INBOX_CHAT_LOOP_ENABLED', 'true');
    vi.stubEnv('OBSIDIAN_INBOX_CHAT_LOOP_MAX_NOTES_PER_RUN', '2');
    vi.stubEnv('OBSIDIAN_INBOX_CHAT_LOOP_SEARCH_LIMIT', '10');
    vi.stubEnv('OBSIDIAN_SYNC_VAULT_PATH', 'C:/vault');
  });

  it('processes pending inbox notes found in the vault', async () => {
    const { processInboxChatNote } = await import('../../routes/chat');
    const { runObsidianInboxChatProcessorCycle } = await import('./obsidianInboxChatLoopService');

    const result = await runObsidianInboxChatProcessorCycle();

    expect(result.candidateCount).toBe(1);
    expect(result.processedCount).toBe(1);
    expect(processInboxChatNote).toHaveBeenCalledWith(expect.objectContaining({
      title: '집가고 싶다',
      notePath: 'chat/inbox/2026-04-09/test-note.md',
    }));
  });

  it('skips the bootstrap inbox note', async () => {
    vi.resetModules();
    vi.doMock('./router', () => ({
      listObsidianFilesWithAdapter: vi.fn(() => Promise.resolve([
        { filePath: 'chat/inbox/00 Inbox.md', name: '00 Inbox', extension: 'md', sizeBytes: 0, modifiedAt: 0 },
      ])),
      readObsidianFileWithAdapter: vi.fn(() => Promise.resolve(['---', 'title: Inbox', 'source: local-chat-bootstrap', '---', '', '# Inbox'].join('\n'))),
      searchObsidianVaultWithAdapter: vi.fn(() => Promise.resolve([])),
    }));

    const { processInboxChatNote } = await import('../../routes/chat');
    const { runObsidianInboxChatProcessorCycle } = await import('./obsidianInboxChatLoopService');
    const result = await runObsidianInboxChatProcessorCycle();

    expect(result.processedCount).toBe(0);
    expect(processInboxChatNote).not.toHaveBeenCalled();
  });
});
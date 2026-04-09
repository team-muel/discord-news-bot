import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListFiles,
  mockReadFile,
  mockWriteNote,
} = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteNote: vi.fn(),
}));

vi.mock('./router', () => ({
  listObsidianFilesWithAdapter: mockListFiles,
  readObsidianFileWithAdapter: mockReadFile,
  writeObsidianNoteWithAdapter: mockWriteNote,
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('knowledgeCompilerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListFiles.mockImplementation(async (_vaultPath: string, folder?: string) => {
      if (folder === 'guilds/guild-1/chat/answers') {
        return [
          { filePath: 'guilds/guild-1/chat/answers/2026-04-09/current.md', name: 'current', extension: 'md', sizeBytes: 0, modifiedAt: 20 },
          { filePath: 'guilds/guild-1/chat/answers/2026-04-09/previous.md', name: 'previous', extension: 'md', sizeBytes: 0, modifiedAt: 10 },
        ];
      }
      return [];
    });

    mockReadFile.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (filePath === 'guilds/guild-1/chat/answers/2026-04-09/previous.md') {
        return [
          '---',
          'title: Previous answer',
          'schema: chat-answer/v1',
          'source: api-chat',
          'created: 2026-04-09T00:00:00.000Z',
          'observed_at: 2026-04-09T00:00:00.000Z',
          'status: answered',
          'canonical_key: chat/thread-1',
          'retrieval_intent: development',
          'source_refs: [chat/inbox/2026-04-09/thread-root.md]',
          'tags: [chat, answer, external-query]',
          '---',
          '',
          '# Previous answer',
          '',
          'Earlier answer body.',
        ].join('\n');
      }
      return null;
    });

    mockWriteNote.mockImplementation(async ({ fileName }: { fileName: string }) => ({ path: fileName }));
  });

  it('rebuilds index, log, topic, and entity artifacts for knowledge-bearing notes', async () => {
    const { getObsidianKnowledgeCompilationStats, runKnowledgeCompilationForNote } = await import('./knowledgeCompilerService');

    const result = await runKnowledgeCompilationForNote({
      guildId: 'guild-1',
      vaultPath: '/vault',
      filePath: 'guilds/guild-1/chat/answers/2026-04-09/current.md',
      content: [
        '---',
        'title: Current answer',
        'schema: chat-answer/v1',
        'source: api-chat',
        'created: 2026-04-09T00:10:00.000Z',
        'observed_at: 2026-04-09T00:10:00.000Z',
        'status: answered',
        'canonical_key: chat/thread-1',
        'retrieval_intent: development',
        'source_refs: [chat/inbox/2026-04-09/thread-root.md, guilds/guild-1/chat/context.md]',
        'tags: [chat, answer, external-query]',
        '---',
        '',
        '# Current answer',
        '',
        'Current answer body.',
      ].join('\n'),
    });

    expect(result.compiled).toBe(true);
    expect(result.indexedNotes).toBe(2);
    expect(result.topics).toContain('development');
    expect(result.entityKey).toBe('chat/thread-1');
    expect(mockWriteNote).toHaveBeenCalledTimes(5);

    const writtenPaths = mockWriteNote.mock.calls.map((call) => call[0].fileName);
    expect(writtenPaths).toContain('ops/knowledge-control/INDEX.md');
    expect(writtenPaths).toContain('ops/knowledge-control/LOG.md');
    expect(writtenPaths).toContain('ops/knowledge-control/LINT.md');
    expect(writtenPaths).toContain('ops/knowledge-control/topics/development.md');
    expect(writtenPaths).toContain('ops/knowledge-control/entities/chat-thread-1.md');

    const entityWrite = mockWriteNote.mock.calls.find((call) => call[0].fileName === 'ops/knowledge-control/entities/chat-thread-1.md');
    expect(entityWrite?.[0]?.content).toContain('Current answer');
    expect(entityWrite?.[0]?.content).toContain('thread-root');
    expect(entityWrite?.[0]?.skipKnowledgeCompilation).toBe(true);

    const lintWrite = mockWriteNote.mock.calls.find((call) => call[0].fileName === 'ops/knowledge-control/LINT.md');
    expect(lintWrite?.[0]?.content).toContain('No lint issues detected.');
    expect(lintWrite?.[0]?.skipKnowledgeCompilation).toBe(true);

    expect(result.artifacts).toContain('ops/knowledge-control/LINT.md');

    const stats = getObsidianKnowledgeCompilationStats();
    expect(stats.lastLintSummary).toMatchObject({
      issueCount: 0,
      missingSourceRefs: 0,
      staleActiveNotes: 0,
      invalidLifecycleNotes: 0,
      canonicalCollisions: 0,
    });
  });

  it('skips raw inbox notes', async () => {
    const { runKnowledgeCompilationForNote } = await import('./knowledgeCompilerService');

    const result = await runKnowledgeCompilationForNote({
      guildId: 'guild-1',
      vaultPath: '/vault',
      filePath: 'chat/inbox/2026-04-09/request.md',
      content: [
        '---',
        'title: Request',
        'schema: chat-inbox/v1',
        'status: open',
        'created: 2026-04-09T00:00:00.000Z',
        '---',
        '',
        '# Request',
        '',
        'Need help with local-first retrieval.',
      ].join('\n'),
    });

    expect(result.compiled).toBe(false);
    expect(result.reason).toBe('raw_or_ops_path');
    expect(mockWriteNote).not.toHaveBeenCalled();
  });
});
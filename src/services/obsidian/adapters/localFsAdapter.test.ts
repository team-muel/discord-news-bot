import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localFsObsidianAdapter } from './localFsAdapter';

describe('localFsObsidianAdapter', () => {
  let vaultDir = '';

  beforeEach(async () => {
    vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-localfs-'));
    await fs.mkdir(path.join(vaultDir, 'chat', 'inbox'), { recursive: true });
    await fs.mkdir(path.join(vaultDir, 'memory'), { recursive: true });

    await fs.writeFile(
      path.join(vaultDir, 'chat', 'inbox', '2026-04-09_note.md'),
      ['---', 'tags: [chat, inbox]', '---', '', '# Inbox Note', '', 'Graph memory keeps process history available.'].join('\n'),
      'utf-8',
    );
    await fs.writeFile(
      path.join(vaultDir, 'memory', 'reference.md'),
      ['# Reference', '', 'See [[chat/inbox/2026-04-09_note]] for the latest inbox item.'].join('\n'),
      'utf-8',
    );
  });

  afterEach(async () => {
    if (vaultDir) {
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });

  it('searches nested markdown files and tag queries', async () => {
    const tagResults = await localFsObsidianAdapter.searchVault!({
      vaultPath: vaultDir,
      query: 'tag:chat',
      limit: 10,
    });
    const keywordResults = await localFsObsidianAdapter.searchVault!({
      vaultPath: vaultDir,
      query: 'graph memory',
      limit: 10,
    });

    expect(tagResults.some((entry) => entry.filePath === 'chat/inbox/2026-04-09_note.md')).toBe(true);
    expect(keywordResults.some((entry) => entry.filePath === 'chat/inbox/2026-04-09_note.md')).toBe(true);
    expect(keywordResults[0]?.filePath).toBe('chat/inbox/2026-04-09_note.md');
  });

  it('supports mixed tag and multi-token queries without requiring exact phrase match', async () => {
    const results = await localFsObsidianAdapter.searchVault!({
      vaultPath: vaultDir,
      query: 'tag:chat inbox graph memory',
      limit: 10,
    });

    expect(results[0]?.filePath).toBe('chat/inbox/2026-04-09_note.md');
    expect(results.every((entry) => entry.filePath !== 'memory/reference.md' || entry.score <= results[0]!.score)).toBe(true);
  });

  it('computes backlinks across nested files', async () => {
    const graph = await localFsObsidianAdapter.getGraphMetadata!({ vaultPath: vaultDir });

    expect(graph['chat/inbox/2026-04-09_note.md']).toBeDefined();
    expect(graph['chat/inbox/2026-04-09_note.md'].backlinks).toContain('memory/reference.md');
    expect(graph['memory/reference.md'].links).toContain('chat/inbox/2026-04-09_note.md');
  });
});
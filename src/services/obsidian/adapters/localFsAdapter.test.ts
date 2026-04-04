import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../../../utils/env', () => ({
  parseBooleanEnv: (_v: unknown, fallback: boolean) => fallback,
}));

vi.stubEnv('OBSIDIAN_LOCAL_FS_ENABLED', 'true');

const { localFsObsidianAdapter } = await import('./localFsAdapter');

let tmpDir: string;

const createVaultFiles = async (files: Record<string, string>) => {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
};

describe('localFsObsidianAdapter', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('identity + availability', () => {
    it('id is local-fs', () => {
      expect(localFsObsidianAdapter.id).toBe('local-fs');
    });

    it('is available by default', () => {
      expect(localFsObsidianAdapter.isAvailable()).toBe(true);
    });

    it('supports read_lore, search_vault, read_file, graph_metadata, write_note', () => {
      expect(localFsObsidianAdapter.capabilities).toContain('read_lore');
      expect(localFsObsidianAdapter.capabilities).toContain('search_vault');
      expect(localFsObsidianAdapter.capabilities).toContain('read_file');
      expect(localFsObsidianAdapter.capabilities).toContain('graph_metadata');
      expect(localFsObsidianAdapter.capabilities).toContain('write_note');
    });
  });

  describe('readFile', () => {
    it('reads a markdown file from the vault', async () => {
      await createVaultFiles({ 'notes/hello.md': '# Hello\nWorld' });

      const content = await localFsObsidianAdapter.readFile!({
        vaultPath: tmpDir,
        filePath: 'notes/hello.md',
      });

      expect(content).toBe('# Hello\nWorld');
    });

    it('returns null for non-existent file', async () => {
      const content = await localFsObsidianAdapter.readFile!({
        vaultPath: tmpDir,
        filePath: 'nonexistent.md',
      });

      expect(content).toBeNull();
    });

    it('rejects path traversal attempts', async () => {
      await createVaultFiles({ 'secret.md': 'should not read' });

      const content = await localFsObsidianAdapter.readFile!({
        vaultPath: path.join(tmpDir, 'subdir'),
        filePath: '../secret.md',
      });

      expect(content).toBeNull();
    });
  });

  describe('searchVault', () => {
    it('returns results matching query text', async () => {
      await createVaultFiles({
        'notes/discord.md': '# Discord Bot\nA bot for managing news feeds.',
        'notes/unrelated.md': '# Cooking\nRecipe for pasta.',
      });

      const results = await localFsObsidianAdapter.searchVault!({
        vaultPath: tmpDir,
        query: 'discord bot',
        limit: 10,
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].filePath).toContain('discord');
    });

    it('supports tag-based search', async () => {
      await createVaultFiles({
        'notes/tagged.md': '# Tagged\n#project #active\nSome content',
        'notes/untagged.md': '# Untagged\nNo tags here',
      });

      const results = await localFsObsidianAdapter.searchVault!({
        vaultPath: tmpDir,
        query: 'tag:project',
        limit: 10,
      });

      expect(results.length).toBe(1);
      expect(results[0].filePath).toContain('tagged');
    });

    it('respects limit parameter', async () => {
      await createVaultFiles({
        'a.md': '# Alpha\ncontent alpha',
        'b.md': '# Beta\ncontent beta',
        'c.md': '# Gamma\ncontent gamma',
      });

      const results = await localFsObsidianAdapter.searchVault!({
        vaultPath: tmpDir,
        query: 'content',
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty for no matches', async () => {
      await createVaultFiles({ 'notes/test.md': '# Test\nHello world' });

      const results = await localFsObsidianAdapter.searchVault!({
        vaultPath: tmpDir,
        query: 'zyxwvutsrq',
        limit: 5,
      });

      expect(results).toEqual([]);
    });
  });

  describe('getGraphMetadata', () => {
    it('returns graph with backlinks and tags', async () => {
      await createVaultFiles({
        'alpha.md': '# Alpha\n#project\nLinks to [[beta]]',
        'beta.md': '# Beta\nLinked from alpha',
      });

      const metadata = await localFsObsidianAdapter.getGraphMetadata!({
        vaultPath: tmpDir,
      });

      expect(metadata['alpha.md']).toBeDefined();
      expect(metadata['alpha.md'].tags).toContain('project');
      expect(metadata['alpha.md'].links).toContain('beta.md');

      expect(metadata['beta.md']).toBeDefined();
      expect(metadata['beta.md'].backlinks).toContain('alpha.md');
    });

    it('handles empty vault gracefully', async () => {
      const metadata = await localFsObsidianAdapter.getGraphMetadata!({
        vaultPath: tmpDir,
      });

      expect(metadata).toEqual({});
    });
  });

  describe('writeNote', () => {
    it('creates a new note with content', async () => {
      const result = await localFsObsidianAdapter.writeNote!({
        guildId: 'guild-1',
        vaultPath: tmpDir,
        fileName: 'new-note',
        content: '# New Note\nBody text',
      });

      expect(result.path).toBe('new-note.md');

      const content = await fs.readFile(path.join(tmpDir, 'new-note.md'), 'utf8');
      expect(content).toContain('# New Note');
    });

    it('writes frontmatter with tags and properties', async () => {
      await localFsObsidianAdapter.writeNote!({
        guildId: 'guild-1',
        vaultPath: tmpDir,
        fileName: 'with-meta.md',
        content: 'Body',
        tags: ['project', 'active'],
        properties: { status: 'draft', priority: 1 },
      });

      const content = await fs.readFile(path.join(tmpDir, 'with-meta.md'), 'utf8');
      expect(content).toContain('---');
      expect(content).toContain('tags:');
      expect(content).toContain('"project"');
      expect(content).toContain('status: "draft"');
      expect(content).toContain('priority: 1');
    });

    it('creates subdirectory structure', async () => {
      const result = await localFsObsidianAdapter.writeNote!({
        guildId: 'guild-1',
        vaultPath: tmpDir,
        fileName: 'deep/nested/note.md',
        content: 'Nested content',
      });

      expect(result.path).toBe('deep/nested/note.md');
      const content = await fs.readFile(path.join(tmpDir, 'deep', 'nested', 'note.md'), 'utf8');
      expect(content).toBe('Nested content');
    });

    it('rejects path traversal in writeNote', async () => {
      await expect(
        localFsObsidianAdapter.writeNote!({
          guildId: 'guild-1',
          vaultPath: path.join(tmpDir, 'vault'),
          fileName: '../../escape.md',
          content: 'malicious',
        }),
      ).rejects.toThrow('outside vault');
    });
  });

  describe('readLore', () => {
    it('returns formatted hints from vault documents', async () => {
      await createVaultFiles({
        'lore/topic-a.md': '# Topic A\nSome useful lore content about topic A.\n[[topic-b]]',
        'lore/topic-b.md': '# Topic B\nAnother lore entry with references.\n[[topic-a]]',
      });

      const hints = await localFsObsidianAdapter.readLore!({
        guildId: 'guild-1',
        goal: 'find topic',
        vaultPath: tmpDir,
      });

      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]).toContain('[obsidian-local]');
    });
  });

  describe('warmup', () => {
    it('builds the vault index without errors', async () => {
      await createVaultFiles({ 'warmup-test.md': '# Warmup\nContent' });

      await expect(
        localFsObsidianAdapter.warmup!({ vaultPath: tmpDir }),
      ).resolves.toBeUndefined();
    });
  });
});

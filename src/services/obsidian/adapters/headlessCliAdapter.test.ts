import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

vi.stubEnv('OBSIDIAN_HEADLESS_ENABLED', 'true');
vi.stubEnv('OBSIDIAN_HEADLESS_COMMAND', 'ob');
vi.stubEnv('OBSIDIAN_VAULT_NAME', 'TestVault');

const { headlessCliObsidianAdapter } = await import('./headlessCliAdapter');

const { execFile } = await import('node:child_process');
const mockExecFile = vi.mocked(execFile);

const makeExecSuccess = (stdout: string) => {
  return async (..._args: unknown[]) => ({ stdout, stderr: '' });
};

const makeExecError = (message: string) => {
  return async () => { throw new Error(message); };
};

describe('headlessCliObsidianAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('identity + availability', () => {
    it('id is headless-cli', () => {
      expect(headlessCliObsidianAdapter.id).toBe('headless-cli');
    });

    it('is available when enabled and command set', () => {
      expect(headlessCliObsidianAdapter.isAvailable()).toBe(true);
    });

    it('supports read_lore, search_vault, read_file, graph_metadata', () => {
      expect(headlessCliObsidianAdapter.capabilities).toContain('read_lore');
      expect(headlessCliObsidianAdapter.capabilities).toContain('search_vault');
      expect(headlessCliObsidianAdapter.capabilities).toContain('read_file');
      expect(headlessCliObsidianAdapter.capabilities).toContain('graph_metadata');
    });

    it('does not support write_note', () => {
      expect(headlessCliObsidianAdapter.capabilities).not.toContain('write_note');
    });
  });

  describe('searchVault', () => {
    it('returns parsed results from JSON output', async () => {
      const jsonOutput = JSON.stringify([
        { path: 'notes/alpha.md', title: 'Alpha', score: 0.9 },
        { path: 'notes/beta.md', title: 'Beta', score: 0.7 },
      ]);
      mockExecFile.mockImplementation(makeExecSuccess(jsonOutput) as never);

      const results = await headlessCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'discord',
        limit: 5,
      });

      expect(results).toHaveLength(2);
      expect(results[0].filePath).toBe('notes/alpha.md');
      expect(results[0].score).toBe(0.9);
      expect(results[1].filePath).toBe('notes/beta.md');
    });

    it('falls back to text parsing for non-JSON output', async () => {
      mockExecFile.mockImplementation(makeExecSuccess('notes/foo.md|Foo|0.8') as never);

      const results = await headlessCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'test',
        limit: 3,
      });

      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('notes/foo.md');
    });

    it('returns empty array on CLI failure', async () => {
      mockExecFile.mockImplementation(makeExecError('Command not found') as never);

      const results = await headlessCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'test',
        limit: 3,
      });

      expect(results).toEqual([]);
    });

    it('tries legacy CLI args when primary returns nothing', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((async (..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) return { stdout: '', stderr: '' };
        return { stdout: JSON.stringify([{ path: 'legacy.md', score: 0.5 }]), stderr: '' };
      }) as never);

      const results = await headlessCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'fallback test',
        limit: 5,
      });

      expect(callCount).toBe(2);
      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('legacy.md');
    });

    it('sanitizes dangerous characters from query', async () => {
      mockExecFile.mockImplementation(makeExecSuccess('[]') as never);

      await headlessCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'test; $(rm -rf /)',
        limit: 5,
      });

      const callArgs = mockExecFile.mock.calls[0];
      const args = callArgs[1] as string[];
      const queryArg = args?.find((a: string) => a.startsWith('query='));
      expect(queryArg).toBeDefined();
      expect(queryArg).not.toContain(';');
      expect(queryArg).not.toContain('$(');
    });
  });

  describe('readFile', () => {
    it('returns file content on success', async () => {
      mockExecFile.mockImplementation(makeExecSuccess('# Hello\nContent here') as never);

      const content = await headlessCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: 'notes/test.md',
      });

      expect(content).toBe('# Hello\nContent here');
    });

    it('returns null for empty file path', async () => {
      const content = await headlessCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: '',
      });

      expect(content).toBeNull();
    });

    it('returns null on CLI error and tries legacy args', async () => {
      mockExecFile.mockImplementation(makeExecError('timeout') as never);

      const content = await headlessCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: 'notes/missing.md',
      });

      expect(content).toBeNull();
    });
  });

  describe('readLore', () => {
    it('returns lore hints from search + read pipeline', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((async (..._args: unknown[]) => {
        callCount++;
        if (callCount <= 2) {
          // searchVault (primary + possibly legacy)
          return {
            stdout: JSON.stringify([
              { path: 'lore/note1.md', score: 0.9 },
              { path: 'lore/note2.md', score: 0.7 },
            ]),
            stderr: '',
          };
        }
        // readFile calls
        return { stdout: '# Title\nSome lore content here for testing', stderr: '' };
      }) as never);

      const hints = await headlessCliObsidianAdapter.readLore!({
        guildId: 'guild-123',
        goal: 'find bot setup info',
        vaultPath: '/vault',
      });

      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0]).toContain('[obsidian-headless]');
    });

    it('returns empty for empty goal', async () => {
      const hints = await headlessCliObsidianAdapter.readLore!({
        guildId: 'guild-123',
        goal: '',
        vaultPath: '/vault',
      });

      expect(hints).toEqual([]);
    });
  });

  describe('getGraphMetadata', () => {
    it('returns parsed graph nodes from JSON', async () => {
      const graphJson = JSON.stringify([
        {
          path: 'notes/alpha.md',
          title: 'Alpha',
          tags: ['project', 'active'],
          backlinks: ['notes/beta.md'],
          links: ['notes/gamma.md'],
        },
        {
          path: 'notes/beta.md',
          title: 'Beta',
          tags: [],
          backlinks: [],
          links: ['notes/alpha.md'],
        },
      ]);
      mockExecFile.mockImplementation(makeExecSuccess(graphJson) as never);

      const metadata = await headlessCliObsidianAdapter.getGraphMetadata!({
        vaultPath: '/vault',
      });

      expect(metadata['notes/alpha.md']).toBeDefined();
      expect(metadata['notes/alpha.md'].tags).toContain('project');
      expect(metadata['notes/alpha.md'].backlinks).toContain('notes/beta.md');
      expect(metadata['notes/beta.md']).toBeDefined();
    });

    it('returns empty object on CLI failure', async () => {
      mockExecFile.mockImplementation(makeExecError('timeout') as never);

      const metadata = await headlessCliObsidianAdapter.getGraphMetadata!({
        vaultPath: '/vault',
      });

      expect(metadata).toEqual({});
    });

    it('returns empty object for invalid JSON', async () => {
      mockExecFile.mockImplementation(makeExecSuccess('not json') as never);

      const metadata = await headlessCliObsidianAdapter.getGraphMetadata!({
        vaultPath: '/vault',
      });

      expect(metadata).toEqual({});
    });
  });
});

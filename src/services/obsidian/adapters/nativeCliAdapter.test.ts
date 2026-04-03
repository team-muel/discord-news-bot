import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../../utils/env', () => ({
  parseBooleanEnv: (_v: unknown, _fallback: boolean) => true,
  parseIntegerEnv: (_v: unknown, fallback: number) => fallback,
}));

// Enable native CLI for tests
vi.stubEnv('OBSIDIAN_NATIVE_CLI_ENABLED', 'true');
vi.stubEnv('OBSIDIAN_NATIVE_CLI_PATH', '/usr/bin/obsidian');
vi.stubEnv('OBSIDIAN_VAULT_NAME', 'TestVault');

const { nativeCliObsidianAdapter } = await import('./nativeCliAdapter');

const { execFile } = await import('node:child_process');
const mockExecFile = vi.mocked(execFile);

const makeExecCallback = (stdout: string, stderr = '') => {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr });
    return {} as ReturnType<typeof execFile>;
  };
};

const makeExecError = (message: string) => {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: unknown) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(new Error(message), null);
    return {} as ReturnType<typeof execFile>;
  };
};

describe('nativeCliObsidianAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when enabled and path set', () => {
      expect(nativeCliObsidianAdapter.isAvailable()).toBe(true);
    });

    it('has correct id', () => {
      expect(nativeCliObsidianAdapter.id).toBe('native-cli');
    });

    it('supports all core capabilities', () => {
      expect(nativeCliObsidianAdapter.capabilities).toContain('read_lore');
      expect(nativeCliObsidianAdapter.capabilities).toContain('search_vault');
      expect(nativeCliObsidianAdapter.capabilities).toContain('read_file');
      expect(nativeCliObsidianAdapter.capabilities).toContain('graph_metadata');
      expect(nativeCliObsidianAdapter.capabilities).toContain('write_note');
    });
  });

  describe('searchVault', () => {
    it('returns parsed results from JSON array of file paths', async () => {
      mockExecFile.mockImplementation(
        makeExecCallback(JSON.stringify(['notes/foo.md', 'notes/bar.md'])) as never,
      );

      const results = await nativeCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'discord bot',
        limit: 5,
      });

      expect(results).toHaveLength(2);
      expect(results[0].filePath).toBe('notes/foo.md');
      expect(results[0].title).toBe('foo');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('returns empty on CLI error', async () => {
      mockExecFile.mockImplementation(makeExecError('timeout') as never);

      const results = await nativeCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'test',
        limit: 3,
      });

      expect(results).toEqual([]);
    });

    it('sanitizes query input', async () => {
      mockExecFile.mockImplementation(makeExecCallback('[]') as never);

      await nativeCliObsidianAdapter.searchVault!({
        vaultPath: '/vault',
        query: 'test; rm -rf /',
        limit: 5,
      });

      const callArgs = mockExecFile.mock.calls[0];
      const args = callArgs[1] as string[];
      const queryArg = args.find((a: string) => a.startsWith('query='));
      expect(queryArg).not.toContain(';');
    });
  });

  describe('readFile', () => {
    it('returns file content', async () => {
      mockExecFile.mockImplementation(
        makeExecCallback('# Hello\nThis is a test note.') as never,
      );

      const content = await nativeCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: 'notes/test.md',
      });

      expect(content).toBe('# Hello\nThis is a test note.');
    });

    it('returns null for empty path', async () => {
      const content = await nativeCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: '',
      });

      expect(content).toBeNull();
    });

    it('returns null on CLI error', async () => {
      mockExecFile.mockImplementation(makeExecError('not found') as never);

      const content = await nativeCliObsidianAdapter.readFile!({
        vaultPath: '/vault',
        filePath: 'notes/missing.md',
      });

      expect(content).toBeNull();
    });
  });

  describe('readLore', () => {
    it('returns hints with backlink counts', async () => {
      // First call: search
      // Second call: readFile
      // Third call: backlinks
      let callCount = 0;
      mockExecFile.mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
        callCount++;
        const callback = typeof _opts === 'function' ? _opts : cb;
        const args = _args as string[];
        const isSearch = args?.some?.((a: string) => String(a).startsWith('query='));
        const isBacklinks = args?.[0] === 'backlinks';

        let stdout = '';
        if (isSearch) {
          stdout = JSON.stringify(['notes/architecture.md']);
        } else if (isBacklinks) {
          stdout = JSON.stringify([{ file: 'notes/design.md' }, { file: 'notes/api.md' }]);
        } else {
          stdout = '# Architecture\nThis describes the system architecture.\nDesign patterns used.';
        }

        if (callback) callback(null, { stdout, stderr: '' });
        return {} as ReturnType<typeof execFile>;
      }) as never);

      const hints = await nativeCliObsidianAdapter.readLore!({
        guildId: 'guild-1',
        goal: 'system architecture',
        vaultPath: '/vault',
      });

      expect(hints.length).toBeGreaterThanOrEqual(1);
      expect(hints[0]).toContain('[obsidian-native]');
      expect(hints[0]).toContain('architecture.md');
      expect(hints[0]).toContain('[←2]');
    });

    it('returns empty for empty goal', async () => {
      const hints = await nativeCliObsidianAdapter.readLore!({
        guildId: 'guild-1',
        goal: '',
        vaultPath: '/vault',
      });

      expect(hints).toEqual([]);
    });
  });

  describe('writeNote', () => {
    it('creates a note via CLI', async () => {
      mockExecFile.mockImplementation(makeExecCallback('Created: notes/new.md') as never);

      const result = await nativeCliObsidianAdapter.writeNote!({
        guildId: 'guild-1',
        vaultPath: '/vault',
        fileName: 'new-note.md',
        content: 'Hello world',
      });

      expect(result.path).toContain('guilds/guild-1/');
      expect(result.path).toContain('new-note.md');
    });

    it('throws on empty fileName', async () => {
      await expect(
        nativeCliObsidianAdapter.writeNote!({
          guildId: 'guild-1',
          vaultPath: '/vault',
          fileName: '',
          content: 'Hello',
        }),
      ).rejects.toThrow('fileName is required');
    });

    it('throws when CLI returns null', async () => {
      mockExecFile.mockImplementation(makeExecError('permission denied') as never);

      await expect(
        nativeCliObsidianAdapter.writeNote!({
          guildId: 'guild-1',
          vaultPath: '/vault',
          fileName: 'test.md',
          content: 'Hello',
        }),
      ).rejects.toThrow('native CLI returned no output');
    });
  });
});

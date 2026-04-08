import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn(() => '/mock/vault'),
}));

vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(async () => ({ ok: true, path: '/mock/vault/guilds/123456789/events/subscriptions/test.md' })),
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { writeSubscriptionNote } from './subscriptionNoteWriter';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';

const mockUpsert = vi.mocked(upsertObsidianGuildDocument);
const mockVaultRoot = vi.mocked(getObsidianVaultRoot);

const makeInput = (overrides?: Partial<Parameters<typeof writeSubscriptionNote>[0]>) => ({
  row: {
    id: 42,
    guild_id: '123456789012345678',
    url: 'https://youtube.com/@LinusTechTips#videos',
    name: 'youtube-ltt',
  },
  mode: 'videos' as const,
  latest: {
    id: 'dQw4w9WgXcQ',
    title: 'New GPU Review',
    content: 'Detailed review of the latest GPU',
    link: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
    published: '2026-04-09T12:00:00Z',
    author: 'Linus Tech Tips',
  },
  ...overrides,
});

describe('writeSubscriptionNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultRoot.mockReturnValue('/mock/vault');
    mockUpsert.mockResolvedValue({ ok: true, path: '/mock/path.md' });
  });

  it('writes a note with correct metadata for videos', async () => {
    await writeSubscriptionNote(makeInput());

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.guildId).toBe('123456789012345678');
    expect(call.vaultPath).toBe('/mock/vault');
    expect(call.fileName).toContain('events/subscriptions/');
    expect(call.fileName).toContain('videos');
    expect(call.fileName).toContain('New-GPU-Review');
    expect(call.content).toContain('# New GPU Review');
    expect(call.content).toContain('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(call.tags).toContain('youtube');
    expect(call.tags).toContain('subscription');
    expect(call.tags).toContain('videos');
  });

  it('writes a note with correct metadata for posts', async () => {
    await writeSubscriptionNote(makeInput({ mode: 'posts' }));

    const call = mockUpsert.mock.calls[0][0];
    expect(call.fileName).toContain('posts');
    expect(call.tags).toContain('posts');
  });

  it('includes content snippet in note body', async () => {
    await writeSubscriptionNote(makeInput());

    const call = mockUpsert.mock.calls[0][0];
    expect(call.content).toContain('Detailed review of the latest GPU');
  });

  it('skips write when guild_id is missing', async () => {
    await writeSubscriptionNote(makeInput({ row: { id: 1, guild_id: null, url: '', name: null } }));
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips write when guild_id is invalid', async () => {
    await writeSubscriptionNote(makeInput({ row: { id: 1, guild_id: 'abc', url: '', name: null } }));
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips write when vault path is empty', async () => {
    mockVaultRoot.mockReturnValue('');
    await writeSubscriptionNote(makeInput());
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('handles missing content gracefully', async () => {
    const input = makeInput();
    input.latest.content = undefined;
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.content).toContain('URL: https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(call.content).not.toContain('undefined');
  });

  it('truncates extremely long content', async () => {
    const input = makeInput();
    input.latest.content = 'x'.repeat(5000);
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    // Content should be truncated at 2000 chars
    expect(call.content.length).toBeLessThan(2500);
  });

  it('sanitizes special characters in filename', async () => {
    const input = makeInput();
    input.latest.title = 'Best GPU? $500 vs $1000! (2026)';
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.fileName).not.toContain('?');
    expect(call.fileName).not.toContain('$');
  });
});

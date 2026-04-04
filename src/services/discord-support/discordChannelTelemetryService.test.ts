import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/obsidianEnv', () => ({ getObsidianVaultRoot: vi.fn() }));
vi.mock('../obsidian/authoring', () => ({ upsertObsidianGuildDocument: vi.fn() }));
vi.mock('../observability/outcomeSignal', () => ({
  logOutcomeSignal: vi.fn(),
}));
vi.mock('./bucketFlushUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bucketFlushUtils')>();
  return { ...actual };
});

import { recordDiscordChannelMessageSignal } from './discordChannelTelemetryService';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';

beforeEach(() => {
  vi.mocked(getObsidianVaultRoot).mockReturnValue('/vault');
  vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: true, path: '/vault/test' });
});

describe('recordDiscordChannelMessageSignal', () => {
  it('records a channel message signal without error', () => {
    expect(() =>
      recordDiscordChannelMessageSignal({
        guildId: 'g1',
        channelId: 'c1',
        channelName: 'general',
        authorId: 'u1',
      }),
    ).not.toThrow();
  });

  it('ignores signals with empty guildId', () => {
    expect(() =>
      recordDiscordChannelMessageSignal({
        guildId: '',
        channelId: 'c1',
        channelName: 'general',
        authorId: 'u1',
      }),
    ).not.toThrow();
  });

  it('ignores signals with empty channelId', () => {
    expect(() =>
      recordDiscordChannelMessageSignal({
        guildId: 'g1',
        channelId: '',
        channelName: 'general',
        authorId: 'u1',
      }),
    ).not.toThrow();
  });

  it('ignores signals with empty authorId', () => {
    expect(() =>
      recordDiscordChannelMessageSignal({
        guildId: 'g1',
        channelId: 'c1',
        channelName: 'general',
        authorId: '',
      }),
    ).not.toThrow();
  });

  it('handles thread signals with parentChannelId', () => {
    expect(() =>
      recordDiscordChannelMessageSignal({
        guildId: 'g1',
        channelId: 'c1',
        channelName: 'thread-1',
        authorId: 'u1',
        isThread: true,
        parentChannelId: 'parent1',
      }),
    ).not.toThrow();
  });
});

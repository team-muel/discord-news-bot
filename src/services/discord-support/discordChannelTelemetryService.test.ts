import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/obsidianEnv', () => ({ getObsidianVaultRoot: vi.fn() }));
vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(),
  summarizeReflectionBundle: vi.fn((bundle: { plane?: string; concern?: string; suggestedPaths?: string[]; gatePaths?: string[]; customerImpact?: boolean } | null | undefined) => ({
    plane: bundle?.plane || 'none',
    concern: bundle?.concern || 'none',
    nextPath: bundle?.suggestedPaths?.[0] || bundle?.gatePaths?.[0] || 'none',
    customerImpact: Boolean(bundle?.customerImpact),
  })),
}));
vi.mock('../observability/outcomeSignal', () => ({
  logOutcomeSignal: vi.fn(),
}));
vi.mock('./bucketFlushUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bucketFlushUtils')>();
  return { ...actual };
});

import { recordDiscordChannelMessageSignal } from './discordChannelTelemetryService';
import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';

const flushAsyncWork = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
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

  it('ignores private thread signals so they do not enter telemetry buckets', async () => {
    for (let index = 0; index < 40; index += 1) {
      recordDiscordChannelMessageSignal({
        guildId: 'g-private-thread',
        channelId: `thread-${index}`,
        channelName: `private-${index}`,
        authorId: `u${index}`,
        isThread: true,
        isPrivateThread: true,
        parentChannelId: 'parent-private',
      });
    }

    await flushAsyncWork();

    expect(vi.mocked(upsertObsidianGuildDocument)).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
  });

  it('logs reflection summary when a flush succeeds', async () => {
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({
      ok: true,
      path: '/vault/guilds/g-flush-telemetry/events/ingest/channel_activity_2026-01-01-00.md',
      reflectionBundle: {
        targetPath: 'guilds/g-flush-telemetry/events/ingest/channel_activity_2026-01-01-00.md',
        plane: 'record',
        concern: 'guild-memory',
        requiredPaths: ['guilds/g-flush-telemetry/events/ingest/channel_activity_2026-01-01-00.md'],
        suggestedPaths: ['guilds/g-flush-telemetry/Guild_Lore.md'],
        suggestedPatterns: [],
        verificationChecklist: [],
        gatePaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
        customerImpact: false,
        notes: [],
      },
    });

    for (let index = 0; index < 40; index += 1) {
      recordDiscordChannelMessageSignal({
        guildId: 'g-flush-telemetry',
        channelId: `c${index}`,
        channelName: `general-${index}`,
        authorId: `u${index}`,
      });
    }

    await flushAsyncWork();

    expect(vi.mocked(upsertObsidianGuildDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      '[DISCORD-TELEMETRY] flush synced guild=%s path=%s count=%d concern=%s next=%s',
      'g-flush-telemetry',
      '/vault/guilds/g-flush-telemetry/events/ingest/channel_activity_2026-01-01-00.md',
      40,
      'guild-memory',
      'guilds/g-flush-telemetry/Guild_Lore.md',
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection, ChannelType } from 'discord.js';
import type { Guild, GuildBasedChannel } from 'discord.js';

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/obsidianEnv', () => ({ getObsidianVaultRoot: vi.fn() }));
vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(),
  summarizeReflectionBundle: vi.fn((bundle?: { concern?: string; suggestedPaths?: string[]; gatePaths?: string[]; plane?: string; customerImpact?: boolean }) => ({
    plane: bundle?.plane || 'none',
    concern: bundle?.concern || 'none',
    nextPath: bundle?.suggestedPaths?.[0] || bundle?.gatePaths?.[0] || 'none',
    customerImpact: Boolean(bundle?.customerImpact),
  })),
}));
vi.mock('../observability/outcomeSignal', () => ({
  logOutcomeSignal: vi.fn(),
}));

import {
  syncGuildTopologySnapshot,
  autoSyncGuildTopologyOnJoin,
  autoSyncGuildTopologiesOnReady,
} from './discordTopologySyncService';
import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';

const makeChannel = (id: string, name: string, type: ChannelType): GuildBasedChannel =>
  ({ id, name, type, rawPosition: 0 }) as any;

const makeGuild = (id: string, name: string, channels: GuildBasedChannel[] = []): Guild => {
  const cache = new Collection<string, GuildBasedChannel>();
  for (const ch of channels) cache.set(ch.id, ch);
  return { id, name, channels: { cache } } as any;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getObsidianVaultRoot).mockReturnValue('/vault');
  vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: true, path: '/vault/test' });
});

describe('syncGuildTopologySnapshot', () => {
  it('writes topology document on success', async () => {
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({
      ok: true,
      path: '/vault/test',
      reflectionBundle: {
        targetPath: 'guilds/g1/events/ingest/discord_topology_2026-04-10.md',
        plane: 'record',
        concern: 'guild-memory',
        requiredPaths: [],
        suggestedPaths: ['guilds/g1/Guild_Lore.md'],
        suggestedPatterns: [],
        verificationChecklist: [],
        gatePaths: [],
        customerImpact: false,
        notes: [],
      },
    });
    const guild = makeGuild('g1', 'TestGuild', [
      makeChannel('c1', 'general', ChannelType.GuildText),
    ]);
    await syncGuildTopologySnapshot(guild, 'manual');
    expect(upsertObsidianGuildDocument).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'g1' }),
    );
    expect(vi.mocked(logger).info).toHaveBeenCalledWith(
      '[DISCORD-TOPOLOGY] snapshot synced guild=%s reason=%s path=%s concern=%s next=%s',
      'g1',
      'manual',
      '/vault/test',
      'guild-memory',
      'guilds/g1/Guild_Lore.md',
    );
  });

  it('skips when vault path missing', async () => {
    vi.mocked(getObsidianVaultRoot).mockReturnValue('');
    const guild = makeGuild('g1', 'TestGuild');
    await syncGuildTopologySnapshot(guild, 'manual');
    expect(upsertObsidianGuildDocument).not.toHaveBeenCalled();
  });

  it('handles empty channel list', async () => {
    const guild = makeGuild('g1', 'TestGuild');
    await syncGuildTopologySnapshot(guild, 'manual');
    expect(upsertObsidianGuildDocument).toHaveBeenCalled();
  });

  it('handles write failure gracefully', async () => {
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: false, path: null, reason: 'DISK_FULL' });
    const guild = makeGuild('g1', 'TestGuild');
    await expect(syncGuildTopologySnapshot(guild, 'error')).resolves.toBeUndefined();
  });
});

describe('autoSyncGuildTopologyOnJoin', () => {
  it('syncs topology on guild join', async () => {
    const guild = makeGuild('g1', 'TestGuild');
    await autoSyncGuildTopologyOnJoin(guild);
    expect(upsertObsidianGuildDocument).toHaveBeenCalled();
  });
});

describe('autoSyncGuildTopologiesOnReady', () => {
  it('syncs all guilds on ready', async () => {
    const guilds = [makeGuild('g1', 'A'), makeGuild('g2', 'B')];
    await autoSyncGuildTopologiesOnReady(guilds);
    expect(upsertObsidianGuildDocument).toHaveBeenCalledTimes(2);
  });
});

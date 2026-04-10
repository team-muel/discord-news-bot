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

import { recordReactionRewardSignal } from './discordReactionRewardService';
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

const baseParams = {
  guildId: 'g1',
  channelId: 'c1',
  messageId: 'm1',
  userId: 'u1',
  emoji: '👍',
  direction: 'add' as const,
};

describe('recordReactionRewardSignal', () => {
  it('records a positive reaction signal without error', () => {
    expect(() => recordReactionRewardSignal(baseParams)).not.toThrow();
  });

  it('records a negative reaction signal', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, emoji: '👎' }),
    ).not.toThrow();
  });

  it('ignores unknown emoji', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, emoji: '🤔' }),
    ).not.toThrow();
  });

  it('ignores signals with empty guildId', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, guildId: '' }),
    ).not.toThrow();
  });

  it('ignores signals with empty messageId', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, messageId: '' }),
    ).not.toThrow();
  });

  it('handles remove direction', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, direction: 'remove' }),
    ).not.toThrow();
  });

  it('handles text-based emoji names (thumbsup)', () => {
    expect(() =>
      recordReactionRewardSignal({ ...baseParams, emoji: 'thumbsup' }),
    ).not.toThrow();
  });

  it('logs reflection summary when a reward flush succeeds', async () => {
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({
      ok: true,
      path: '/vault/guilds/g-flush-reward/events/reward/reaction_reward_2026-01-01-00.md',
      reflectionBundle: {
        targetPath: 'guilds/g-flush-reward/events/reward/reaction_reward_2026-01-01-00.md',
        plane: 'record',
        concern: 'guild-memory',
        requiredPaths: ['guilds/g-flush-reward/events/reward/reaction_reward_2026-01-01-00.md'],
        suggestedPaths: ['guilds/g-flush-reward/Guild_Lore.md'],
        suggestedPatterns: [],
        verificationChecklist: [],
        gatePaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
        customerImpact: false,
        notes: [],
      },
    });

    for (let index = 0; index < 10; index += 1) {
      recordReactionRewardSignal({
        guildId: 'g-flush-reward',
        channelId: `c${index}`,
        messageId: `m${index}`,
        userId: `u${index}`,
        emoji: '👍',
        direction: 'add',
      });
    }

    await flushAsyncWork();

    expect(vi.mocked(upsertObsidianGuildDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      '[REACTION-REWARD] flush synced guild=%s path=%s events=%d concern=%s next=%s',
      'g-flush-reward',
      '/vault/guilds/g-flush-reward/events/reward/reaction_reward_2026-01-01-00.md',
      10,
      'guild-memory',
      'guilds/g-flush-reward/Guild_Lore.md',
    );
  });
});

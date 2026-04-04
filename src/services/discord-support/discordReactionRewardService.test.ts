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

import { recordReactionRewardSignal } from './discordReactionRewardService';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';

beforeEach(() => {
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
});

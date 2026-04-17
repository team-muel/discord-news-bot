import { describe, expect, it, vi } from 'vitest';

import { captureExternalNewsMemory } from './actionRunnerNewsCapture';

describe('captureExternalNewsMemory', () => {
  it('persists deduped allowed news artifacts and records a fingerprint', async () => {
    const createMemoryItem = vi.fn().mockResolvedValue(undefined);
    const recordNewsFingerprint = vi.fn().mockResolvedValue(undefined);
    const isNewsFingerprinted = vi.fn().mockResolvedValue(false);

    await captureExternalNewsMemory({
      guildId: 'guild-1',
      requestedBy: 'user-123',
      goal: 'track example coverage',
      artifacts: [
        'Alpha launch\nhttps://example.com/a?utm_source=test\nmeta | 2026-04-16T08:00:00Z',
        'Beta launch\nhttps://sub.example.com/b?fbclid=123\nmeta | 2026-04-16T09:00:00Z',
        'Ignored other domain\nhttps://ignored.test/c\nmeta | 2026-04-16T09:30:00Z',
      ],
    }, {
      now: () => Date.parse('2026-04-16T12:00:00Z'),
      getGuildActionPolicy: vi.fn().mockResolvedValue({ enabled: true, runMode: 'auto' } as never),
      listGuildAllowedDomains: vi.fn().mockResolvedValue(['example.com']),
      createMemoryItem,
      buildNewsFingerprint: vi.fn().mockReturnValue('fp-1234567890abcdef-extra'),
      isNewsFingerprinted,
      recordNewsFingerprint,
    });

    expect(isNewsFingerprinted).toHaveBeenCalledTimes(1);
    expect(createMemoryItem).toHaveBeenCalledTimes(1);
    expect(recordNewsFingerprint).toHaveBeenCalledTimes(1);

    const memoryInput = createMemoryItem.mock.calls[0]?.[0];
    expect(memoryInput).toMatchObject({
      guildId: 'guild-1',
      type: 'semantic',
      title: '외부뉴스: track example coverage',
      actorId: 'user-123',
      source: {
        sourceKind: 'system',
        sourceRef: 'https://example.com/a',
      },
    });
    expect(memoryInput.content).toContain('query: track example coverage');
    expect(memoryInput.content).toContain('source: google_news_rss');
    expect(memoryInput.content).toContain('Alpha launch | https://example.com/a?utm_source=test');
    expect(memoryInput.content).toContain('Beta launch | https://sub.example.com/b?fbclid=123');
    expect(memoryInput.content).not.toContain('ignored.test');
    expect(memoryInput.tags).toContain('external-news');
    expect(memoryInput.tags).toContain('domains:2');
    expect(memoryInput.tags).toContain('dedupe:fp-1234567890abc');

    expect(recordNewsFingerprint).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild-1',
      goal: 'track example coverage',
      fingerprint: 'fp-1234567890abcdef-extra',
    }));
  });

  it('skips persistence when the fingerprint was already seen', async () => {
    const createMemoryItem = vi.fn().mockResolvedValue(undefined);
    const recordNewsFingerprint = vi.fn().mockResolvedValue(undefined);

    await captureExternalNewsMemory({
      guildId: 'guild-2',
      requestedBy: 'user-456',
      goal: 'monitor repeat coverage',
      artifacts: [
        'Alpha launch\nhttps://example.com/a\nmeta | 2026-04-16T08:00:00Z',
        'Beta launch\nhttps://example.com/b\nmeta | 2026-04-16T09:00:00Z',
      ],
    }, {
      now: () => Date.parse('2026-04-16T12:00:00Z'),
      getGuildActionPolicy: vi.fn().mockResolvedValue({ enabled: true, runMode: 'auto' } as never),
      listGuildAllowedDomains: vi.fn().mockResolvedValue(['example.com']),
      createMemoryItem,
      buildNewsFingerprint: vi.fn().mockReturnValue('fp-repeat-1234567890'),
      isNewsFingerprinted: vi.fn().mockResolvedValue(true),
      recordNewsFingerprint,
    });

    expect(createMemoryItem).not.toHaveBeenCalled();
    expect(recordNewsFingerprint).not.toHaveBeenCalled();
  });
});
import { describe, expect, it } from 'vitest';

import { summarizeSourceUsageRows } from './botRuntimeState';

describe('summarizeSourceUsageRows', () => {
  it('aggregates total, active, youtube, news, and active guild counts', () => {
    const summary = summarizeSourceUsageRows([
      { guild_id: 'g1', is_active: true, name: 'youtube-posts', created_at: '2026-04-10T00:00:00.000Z' },
      { guild_id: 'g1', is_active: false, name: 'google-finance-news', created_at: '2026-04-10T01:00:00.000Z' },
      { guild_id: 'g2', is_active: true, name: 'youtube-videos', created_at: '2026-04-10T02:00:00.000Z' },
    ]);

    expect(summary).toMatchObject({
      total: 3,
      active: 2,
      youtube: 2,
      news: 1,
      activeGuilds: 2,
    });
    expect(summary.byGuild).toEqual([
      {
        guildId: 'g1',
        total: 2,
        active: 1,
        youtube: 1,
        news: 1,
        newestCreatedAt: '2026-04-10T01:00:00.000Z',
      },
      {
        guildId: 'g2',
        total: 1,
        active: 1,
        youtube: 1,
        news: 0,
        newestCreatedAt: '2026-04-10T02:00:00.000Z',
      },
    ]);
  });

  it('handles null guilds and non-matching names safely', () => {
    const summary = summarizeSourceUsageRows([
      { guild_id: null, is_active: null, name: null, created_at: null },
      { guild_id: null, is_active: true, name: 'custom-source', created_at: '2026-04-10T03:00:00.000Z' },
    ]);

    expect(summary).toEqual({
      total: 2,
      active: 1,
      youtube: 0,
      news: 0,
      activeGuilds: 1,
      byGuild: [
        {
          guildId: 'unknown',
          total: 2,
          active: 1,
          youtube: 0,
          news: 0,
          newestCreatedAt: '2026-04-10T03:00:00.000Z',
        },
      ],
    });
  });
});
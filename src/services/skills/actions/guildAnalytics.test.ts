import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../../../bot', () => ({
  client: {
    guilds: {
      fetch: vi.fn(),
    },
  },
}));

vi.mock('../../discord-support/userCrmService', () => ({
  getGuildLeaderboard: vi.fn(),
}));

vi.mock('../../../logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { guildAnalyticsAction } from './guildAnalytics';
import { getGuildLeaderboard } from '../../discord-support/userCrmService';

// Access mocked bot client via dynamic import (lazy client resolved here)
const getMockClient = async () => (await import('../../../bot')).client;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GUILD_ID = '123456789012345678';

/** Create a Collection-like Map with .filter() and .size (mimics Discord.js Collection) */
const makeCollection = <V>(entries: [string, V][]) => {
  const map = new Map<string, V>(entries);
  const col = {
    get size() { return map.size; },
    filter(fn: (v: V) => boolean) {
      return makeCollection([...map.entries()].filter(([, v]) => fn(v)));
    },
    forEach: map.forEach.bind(map),
    [Symbol.iterator]: map[Symbol.iterator].bind(map),
    values: map.values.bind(map),
    entries: map.entries.bind(map),
  };
  return col;
};

/** Build a minimal mock Guild for Discord API responses */
const makeMockGuild = (overrides: Partial<{
  name: string;
  memberCount: number;
  premiumTier: number;
  premiumSubscriptionCount: number;
  createdAt: Date;
  channels: Map<string, unknown>;
  roles: Map<string, { name: string; members: Map<string, unknown> }>;
  members: [string, { user: { bot: boolean }; presence?: { status: string } | null }][];
}> = {}) => {
  const channelsMap = overrides.channels ?? new Map([['ch1', {}], ['ch2', {}]]);
  const everyoneRole = { name: '@everyone', members: new Map() };
  const modRole = { name: 'Moderator', members: new Map([['u1', {}], ['u2', {}]]) };
  const rolesMap = overrides.roles ?? new Map([
    ['r0', everyoneRole],
    ['r1', modRole],
  ]);

  const memberEntries: [string, { user: { bot: boolean }; presence?: { status: string } | null }][] =
    overrides.members ?? [
      ['u1', { user: { bot: false }, presence: null }],
      ['u2', { user: { bot: false }, presence: null }],
      ['u3', { user: { bot: true }, presence: null }],
    ];

  const membersCollection = makeCollection(memberEntries);

  return {
    name: overrides.name ?? '테스트 서버',
    memberCount: overrides.memberCount ?? 100,
    premiumTier: overrides.premiumTier ?? 1,
    premiumSubscriptionCount: overrides.premiumSubscriptionCount ?? 3,
    createdAt: overrides.createdAt ?? new Date('2024-01-01'),
    channels: {
      cache: { size: channelsMap.size },
    },
    roles: {
      cache: {
        size: rolesMap.size,
        filter: (fn: (r: any) => boolean) => {
          const arr = [...rolesMap.values()].filter(fn);
          return {
            sort: (cmp: (a: any, b: any) => number) => {
              const sorted = [...arr].sort(cmp);
              return {
                first: (n: number) => sorted.slice(0, n),
                length: sorted.length,
              };
            },
            length: arr.length,
          };
        },
      },
    },
    members: {
      cache: membersCollection,
      fetch: vi.fn().mockResolvedValue(membersCollection),
    },
  };
};

const makeMockMembership = (userId: string, counts: Partial<{
  messageCount: number;
  commandCount: number;
  reactionGivenCount: number;
  reactionReceivedCount: number;
  sessionCount: number;
}> = {}) => ({
  guildId: GUILD_ID,
  userId,
  messageCount: counts.messageCount ?? 0,
  commandCount: counts.commandCount ?? 0,
  reactionGivenCount: counts.reactionGivenCount ?? 0,
  reactionReceivedCount: counts.reactionReceivedCount ?? 0,
  sessionCount: counts.sessionCount ?? 0,
  firstSeenAt: '2024-01-01T00:00:00Z',
  lastActiveAt: '2024-04-01T00:00:00Z',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('guildAnalyticsAction', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const cl = await getMockClient();
    vi.mocked(cl.guilds.fetch).mockResolvedValue(makeMockGuild() as any);
    vi.mocked(getGuildLeaderboard).mockResolvedValue([]);
  });

  // -----------------------------------------------------------------------
  // Basic validation
  // -----------------------------------------------------------------------

  it('guildId가 없으면 실패한다', async () => {
    const result = await guildAnalyticsAction.execute({
      goal: '서버 분석',
      args: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('GUILD_ID_REQUIRED');
  });

  it('name이 guild.analytics이다', () => {
    expect(guildAnalyticsAction.name).toBe('guild.analytics');
  });

  // -----------------------------------------------------------------------
  // Scope: overview (default)
  // -----------------------------------------------------------------------

  describe('scope=overview', () => {
    it('기본 scope로 서버 개요를 반환한다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([
        makeMockMembership('u1', { messageCount: 50 }),
        makeMockMembership('u2', { messageCount: 30 }),
      ]);

      const result = await guildAnalyticsAction.execute({
        goal: '서버 분석',
        guildId: GUILD_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('테스트 서버');
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts[0]).toContain('서버 개요');
      expect(result.artifacts[0]).toContain('멤버 수');
      expect(result.artifacts[0]).toContain('메시지 리더보드');
    });

    it('길드를 찾을 수 없으면 실패한다', async () => {
      const cl = await getMockClient();
      vi.mocked(cl.guilds.fetch).mockRejectedValue(new Error('Unknown Guild'));

      const result = await guildAnalyticsAction.execute({
        goal: '서버 분석',
        guildId: GUILD_ID,
        args: { scope: 'overview' },
      });

      expect(result.ok).toBe(false);
      expect(result.summary).toContain('찾을 수 없습니다');
    });
  });

  // -----------------------------------------------------------------------
  // Scope: leaderboard
  // -----------------------------------------------------------------------

  describe('scope=leaderboard', () => {
    it('메시지 리더보드를 반환한다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([
        makeMockMembership('u1', { messageCount: 100 }),
        makeMockMembership('u2', { messageCount: 80 }),
        makeMockMembership('u3', { messageCount: 60 }),
      ]);

      const result = await guildAnalyticsAction.execute({
        goal: '리더보드 조회',
        guildId: GUILD_ID,
        args: { scope: 'leaderboard', counter: 'message_count', limit: '3' },
      });

      expect(result.ok).toBe(true);
      expect(result.artifacts[0]).toContain('메시지');
      expect(result.artifacts[0]).toContain('<@u1>');
      expect(result.artifacts[0]).toContain('<@u3>');
    });

    it('커맨드 카운터로 리더보드를 조회한다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([
        makeMockMembership('u1', { commandCount: 25 }),
      ]);

      const result = await guildAnalyticsAction.execute({
        goal: '커맨드 리더보드',
        guildId: GUILD_ID,
        args: { scope: 'leaderboard', counter: 'command_count' },
      });

      expect(result.ok).toBe(true);
      expect(result.artifacts[0]).toContain('커맨드');
    });

    it('데이터 없으면 안내 메시지를 반환한다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([]);

      const result = await guildAnalyticsAction.execute({
        goal: '리더보드 조회',
        guildId: GUILD_ID,
        args: { scope: 'leaderboard' },
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('데이터 없음');
    });

    it('잘못된 counter는 message_count 기본값을 사용한다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([]);

      await guildAnalyticsAction.execute({
        goal: '리더보드',
        guildId: GUILD_ID,
        args: { scope: 'leaderboard', counter: 'invalid_counter' },
      });

      expect(getGuildLeaderboard).toHaveBeenCalledWith(GUILD_ID, 'message_count', 10);
    });

    it('limit은 최대 50으로 제한된다', async () => {
      vi.mocked(getGuildLeaderboard).mockResolvedValue([]);

      await guildAnalyticsAction.execute({
        goal: '리더보드',
        guildId: GUILD_ID,
        args: { scope: 'leaderboard', limit: '999' },
      });

      expect(getGuildLeaderboard).toHaveBeenCalledWith(GUILD_ID, 'message_count', 50);
    });
  });

  // -----------------------------------------------------------------------
  // Scope: members
  // -----------------------------------------------------------------------

  describe('scope=members', () => {
    it('멤버 현황을 반환한다', async () => {
      const result = await guildAnalyticsAction.execute({
        goal: '멤버 현황',
        guildId: GUILD_ID,
        args: { scope: 'members' },
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('멤버 현황');
      expect(result.artifacts[0]).toContain('사람');
      expect(result.artifacts[0]).toContain('봇');
    });

    it('길드를 찾을 수 없으면 실패한다', async () => {
      const cl = await getMockClient();
      vi.mocked(cl.guilds.fetch).mockRejectedValue(new Error('Not found'));

      const result = await guildAnalyticsAction.execute({
        goal: '멤버 현황',
        guildId: GUILD_ID,
        args: { scope: 'members' },
      });

      expect(result.ok).toBe(false);
    });

    it('GuildPresences 없이 online은 0으로 표시된다', async () => {
      // presences are null → online should be 0
      const result = await guildAnalyticsAction.execute({
        goal: '멤버 현황',
        guildId: GUILD_ID,
        args: { scope: 'members' },
      });

      expect(result.ok).toBe(true);
      // The online count should note it's approximate
      expect(result.artifacts[0]).toContain('온라인(추정)');
    });
  });

  // -----------------------------------------------------------------------
  // Invalid scope
  // -----------------------------------------------------------------------

  it('잘못된 scope는 overview로 fallback한다', async () => {
    const result = await guildAnalyticsAction.execute({
      goal: '서버 분석',
      guildId: GUILD_ID,
      args: { scope: 'nonexistent' },
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts[0]).toContain('서버 개요');
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('실행 중 에러 발생 시 EXECUTION_ERROR를 반환한다', async () => {
    const cl = await getMockClient();
    vi.mocked(cl.guilds.fetch).mockImplementation(() => {
      throw new Error('Unexpected boom');
    });

    const result = await guildAnalyticsAction.execute({
      goal: '서버 분석',
      guildId: GUILD_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('EXECUTION_ERROR');
  });
});

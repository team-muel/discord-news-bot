/**
 * guild.analytics — Agent action for guild-level analytics.
 *
 * Combines Discord API data (member count, channels, roles) with CRM
 * aggregates (message/command/reaction counts, leaderboard, activity trends).
 *
 * Invoked via `/해줘` or natural language, not a dedicated slash command.
 */
import type { ActionDefinition } from './types';
import type { Client } from 'discord.js';
import {
  getGuildLeaderboard,
  type ActivityCounter,
} from '../../discord-support/userCrmService';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';

/** Lazy-loaded Discord client to avoid bot.ts side effects at import time. */
let _client: Client | null = null;
const getClient = async (): Promise<Client> => {
  if (!_client) {
    const mod = await import('../../../bot');
    _client = mod.client;
  }
  return _client;
};

type AnalyticsScope = 'overview' | 'leaderboard' | 'members';

const VALID_SCOPES: AnalyticsScope[] = ['overview', 'leaderboard', 'members'];
const VALID_COUNTERS: ActivityCounter[] = [
  'message_count', 'command_count', 'reaction_given_count',
  'reaction_received_count', 'session_count',
];

const COUNTER_LABELS: Record<ActivityCounter, string> = {
  message_count: '메시지',
  command_count: '커맨드',
  reaction_given_count: '리액션(준)',
  reaction_received_count: '리액션(받은)',
  session_count: '세션',
};

const fmtNum = (n: number): string => n.toLocaleString('ko-KR');

// ---------------------------------------------------------------------------
// Scope handlers
// ---------------------------------------------------------------------------

async function handleOverview(guildId: string): Promise<{ ok: boolean; summary: string; artifacts: string[] }> {
  const cl = await getClient();
  const guild = await cl.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return { ok: false, summary: `길드 ${guildId}를 찾을 수 없습니다.`, artifacts: [] };
  }

  // Fetch Discord API data
  const memberCount = guild.memberCount;
  const channelCount = guild.channels.cache.size;
  const roleCount = guild.roles.cache.size;
  const boostLevel = guild.premiumTier;
  const boostCount = guild.premiumSubscriptionCount ?? 0;
  const createdAt = guild.createdAt.toLocaleDateString('ko-KR');

  // Fetch CRM top contributors
  const topMessages = await getGuildLeaderboard(guildId, 'message_count', 5);
  const topCommands = await getGuildLeaderboard(guildId, 'command_count', 5);

  const totalMessages = topMessages.reduce((sum, m) => sum + m.messageCount, 0);
  const totalCommands = topCommands.reduce((sum, m) => sum + m.commandCount, 0);

  const lines: string[] = [
    `## ${guild.name} 서버 개요`,
    '',
    `| 항목 | 값 |`,
    `|------|-----|`,
    `| 멤버 수 | ${fmtNum(memberCount)} |`,
    `| 채널 수 | ${fmtNum(channelCount)} |`,
    `| 역할 수 | ${fmtNum(roleCount)} |`,
    `| 부스트 | Tier ${boostLevel} (${fmtNum(boostCount)}개) |`,
    `| 생성일 | ${createdAt} |`,
    '',
    `### CRM 집계 (추적된 상위 유저 기준)`,
    `- 총 메시지: ${fmtNum(totalMessages)}`,
    `- 총 커맨드: ${fmtNum(totalCommands)}`,
  ];

  if (topMessages.length > 0) {
    lines.push('', '### 메시지 리더보드 (Top 5)');
    topMessages.forEach((m, i) => {
      lines.push(`${i + 1}. <@${m.userId}> — ${fmtNum(m.messageCount)}회`);
    });
  }

  return {
    ok: true,
    summary: `${guild.name} 서버 개요 조회 성공 (멤버 ${fmtNum(memberCount)}, 채널 ${fmtNum(channelCount)})`,
    artifacts: [lines.join('\n')],
  };
}

async function handleLeaderboard(
  guildId: string,
  counter: ActivityCounter,
  limit: number,
): Promise<{ ok: boolean; summary: string; artifacts: string[] }> {
  const cl = await getClient();
  const guild = await cl.guilds.fetch(guildId).catch(() => null);
  const guildName = guild?.name ?? guildId;
  const label = COUNTER_LABELS[counter];

  const board = await getGuildLeaderboard(guildId, counter, limit);
  if (board.length === 0) {
    return {
      ok: true,
      summary: `${guildName} ${label} 리더보드: 데이터 없음`,
      artifacts: ['리더보드 데이터가 없습니다. 활동이 추적된 후 조회해주세요.'],
    };
  }

  const lines: string[] = [
    `## ${guildName} ${label} 리더보드`,
    '',
  ];

  const counterKey = counter.replace('_count', '') as string;
  board.forEach((m, i) => {
    const value = counter === 'message_count' ? m.messageCount
      : counter === 'command_count' ? m.commandCount
      : counter === 'reaction_given_count' ? m.reactionGivenCount
      : counter === 'reaction_received_count' ? m.reactionReceivedCount
      : m.sessionCount;
    lines.push(`${i + 1}. <@${m.userId}> — ${fmtNum(value)}회`);
  });

  return {
    ok: true,
    summary: `${guildName} ${label} 리더보드 (${board.length}명)`,
    artifacts: [lines.join('\n')],
  };
}

async function handleMembers(guildId: string): Promise<{ ok: boolean; summary: string; artifacts: string[] }> {
  const cl = await getClient();
  const guild = await cl.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return { ok: false, summary: `길드 ${guildId}를 찾을 수 없습니다.`, artifacts: [] };
  }

  // Fetch members from Discord API (limited to cached + fetched)
  const members = await guild.members.fetch({ limit: 100 }).catch(() => guild.members.cache);
  const total = guild.memberCount;
  // GuildPresences intent is not enabled — online count is approximate based on cached data only
  const online = members.filter((m) => m.presence?.status === 'online' || m.presence?.status === 'idle' || m.presence?.status === 'dnd').size;
  const bots = members.filter((m) => m.user.bot).size;
  const humans = members.size - bots;

  const lines: string[] = [
    `## ${guild.name} 멤버 현황`,
    '',
    `| 항목 | 값 |`,
    `|------|-----|`,
    `| 전체 멤버 | ${fmtNum(total)} |`,
    `| 조회된 멤버 | ${fmtNum(members.size)} |`,
    `| 사람 | ${fmtNum(humans)} |`,
    `| 봇 | ${fmtNum(bots)} |`,
    `| 온라인(추정) | ${fmtNum(online)} |`,
  ];

  // Roles breakdown
  const roleStats = guild.roles.cache
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.members.size - a.members.size)
    .first(10);

  if (roleStats && roleStats.length > 0) {
    lines.push('', '### 역할별 멤버 수 (Top 10)');
    for (const role of roleStats) {
      lines.push(`- ${role.name}: ${fmtNum(role.members.size)}명`);
    }
  }

  return {
    ok: true,
    summary: `${guild.name} 멤버 현황 (전체 ${fmtNum(total)}, 사람 ${fmtNum(humans)}, 봇 ${fmtNum(bots)})`,
    artifacts: [lines.join('\n')],
  };
}

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

export const guildAnalyticsAction: ActionDefinition = {
  name: 'guild.analytics',
  description: '서버(길드) 분석 — 개요, 리더보드, 멤버 현황 등 Discord API + CRM 데이터를 결합한 서버 인사이트를 제공합니다.',
  category: 'data',
  parameters: [
    {
      name: 'scope',
      required: false,
      description: 'Analysis scope: overview (default), leaderboard, members',
      example: 'overview',
    },
    {
      name: 'counter',
      required: false,
      description: 'Leaderboard counter: message_count, command_count, reaction_given_count, reaction_received_count, session_count',
      example: 'message_count',
    },
    {
      name: 'limit',
      required: false,
      description: 'Number of leaderboard entries (default: 10, max: 50)',
      example: '10',
    },
  ],
  execute: async ({ goal, args, guildId }) => {
    const startMs = Date.now();

    if (!guildId) {
      return {
        ok: false,
        name: 'guild.analytics',
        summary: 'guildId가 필요합니다.',
        artifacts: [],
        verification: ['guildId 누락'],
        error: 'GUILD_ID_REQUIRED',
      };
    }

    const scope = (typeof args?.scope === 'string' && VALID_SCOPES.includes(args.scope as AnalyticsScope))
      ? args.scope as AnalyticsScope
      : 'overview';

    const counter = (typeof args?.counter === 'string' && VALID_COUNTERS.includes(args.counter as ActivityCounter))
      ? args.counter as ActivityCounter
      : 'message_count';

    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));

    try {
      let result: { ok: boolean; summary: string; artifacts: string[] };

      switch (scope) {
        case 'leaderboard':
          result = await handleLeaderboard(guildId, counter, limit);
          break;
        case 'members':
          result = await handleMembers(guildId);
          break;
        case 'overview':
        default:
          result = await handleOverview(guildId);
          break;
      }

      return {
        ok: result.ok,
        name: 'guild.analytics',
        summary: result.summary,
        artifacts: result.artifacts,
        verification: result.ok ? [`scope=${scope} 조회 성공`] : [`scope=${scope} 조회 실패`],
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const errMsg = getErrorMessage(err);
      logger.warn('[guild.analytics] error: %s', errMsg);
      return {
        ok: false,
        name: 'guild.analytics',
        summary: `서버 분석 실패: ${errMsg}`,
        artifacts: [],
        verification: ['실행 중 오류 발생'],
        error: 'EXECUTION_ERROR',
        durationMs: Date.now() - startMs,
      };
    }
  },
};

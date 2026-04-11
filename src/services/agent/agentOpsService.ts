import { ChannelType, type Client, type Guild, type GuildBasedChannel } from 'discord.js';
import { DISCORD_MESSAGES } from '../../discord/messages';
import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv } from '../../utils/env';
import { queueMemoryJob } from './agentMemoryStore';
import { getAgentGotCutoverDecision } from './agentGotCutoverService';
import { listGuildAgentSessions, startAgentSession } from '../multiAgentService';
import { isAutomationEnabled, triggerAutomationJob } from '../automationBot';
import { T_SOURCES } from '../infra/tableRegistry';
import { getNewsMonitorCandidateSourceStatus } from '../news/newsMonitorWorkerClient';
import { createNewsChannelSubscription } from '../news/newsChannelStore';
import { autoBootstrapGuildKnowledgeOnJoin } from '../obsidian/obsidianBootstrapService';
import { autoSyncGuildTopologyOnJoin } from '../discord-support/discordTopologySyncService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getErrorMessage } from '../../utils/errorMessage';

const AGENT_AUTO_ONBOARDING_ENABLED = parseBooleanEnv(process.env.AGENT_AUTO_ONBOARDING_ENABLED, true);
const AGENT_DAILY_LEARNING_ENABLED = parseBooleanEnv(process.env.AGENT_DAILY_LEARNING_ENABLED, true);
const AGENT_DAILY_LEARNING_HOUR = Math.min(23, parseMinIntEnv(process.env.AGENT_DAILY_LEARNING_HOUR, 4, 0));
const AGENT_DAILY_MAX_GUILDS = parseMinIntEnv(process.env.AGENT_DAILY_MAX_GUILDS, 30, 1);
const AGENT_ONBOARDING_COOLDOWN_MS = parseMinIntEnv(process.env.AGENT_ONBOARDING_COOLDOWN_MS, 6 * 60 * 60 * 1000, 60_000);
const AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED = parseBooleanEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED, true);
const AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN = parseMinIntEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN, 60, 5);
const AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS = parseMinIntEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS, 100, 1);
const AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT = parseBoundedNumberEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT, 100, 0, 100);
const AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES = parseMinIntEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES, 20, 0);

type SendableGuildChannel = GuildBasedChannel & {
  id: string;
  name: string;
  rawPosition?: number;
  isSendable: () => boolean;
  send: (content: string) => Promise<unknown>;
};

type GuildJoinNewsBootstrapStatus =
  | 'created'
  | 'existing'
  | 'skipped-has-sources'
  | 'skipped-supabase'
  | 'failed';

let dailyTimer: NodeJS.Timeout | null = null;
let gotCutoverAutopilotTimer: NodeJS.Timeout | null = null;
let lastDailyLearningAt: string | null = null;
let lastDailyLearningSummary: string | null = null;
let gotCutoverAutopilotRunning = false;
let lastGotCutoverAutopilotAt: string | null = null;
let lastGotCutoverAutopilotSummary: string | null = null;

const nowMs = () => Date.now();

const hasRecentOnboardingSession = (guildId: string): boolean => {
  const sessions = listGuildAgentSessions(guildId, 20);
  const cutoff = nowMs() - AGENT_ONBOARDING_COOLDOWN_MS;
  return sessions.some((session) =>
    session.requestedSkillId === 'guild-onboarding-blueprint'
    && Date.parse(session.createdAt) >= cutoff);
};

const isSendableGuildChannel = (channel: GuildBasedChannel | null | undefined): channel is SendableGuildChannel => {
  if (!channel) {
    return false;
  }

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return false;
  }

  if (!('isSendable' in channel) || typeof channel.isSendable !== 'function' || !channel.isSendable()) {
    return false;
  }

  return 'send' in channel && typeof channel.send === 'function';
};

const getChannelSortPos = (channel: GuildBasedChannel): number => {
  return Number(('rawPosition' in channel ? channel.rawPosition : 0) || 0);
};

const resolveGuildBootstrapChannel = (guild: Guild): SendableGuildChannel | null => {
  const selected = new Set<string>();
  const orderedCandidates: SendableGuildChannel[] = [];
  const push = (channel: GuildBasedChannel | null | undefined) => {
    if (!isSendableGuildChannel(channel) || selected.has(channel.id)) {
      return;
    }
    selected.add(channel.id);
    orderedCandidates.push(channel);
  };

  push(guild.systemChannel);

  const fallbackChannels = [...guild.channels.cache.values()]
    .filter(isSendableGuildChannel)
    .sort((left, right) => getChannelSortPos(left) - getChannelSortPos(right) || left.name.localeCompare(right.name));

  for (const channel of fallbackChannels) {
    push(channel);
  }

  return orderedCandidates[0] || null;
};

const hasAnyGuildSourceRows = async (guildId: string): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const { data, error } = await getSupabaseClient()
    .from(T_SOURCES)
    .select('id')
    .eq('guild_id', guildId)
    .limit(1);

  if (error) {
    throw error;
  }

  return Array.isArray(data) && data.length > 0;
};

const ensureDefaultGuildNewsSubscription = async (guild: Guild, channelId: string): Promise<GuildJoinNewsBootstrapStatus> => {
  if (!isSupabaseConfigured()) {
    return 'skipped-supabase';
  }

  if (await hasAnyGuildSourceRows(guild.id)) {
    return 'skipped-has-sources';
  }

  try {
    const result = await createNewsChannelSubscription({
      userId: 'system-on-guild-join',
      guildId: guild.id,
      discordChannelId: channelId,
    });
    return result.created ? 'created' : 'existing';
  } catch (error) {
    logger.warn('[AGENT-OPS] default news bootstrap failed guild=%s channel=%s error=%s', guild.id, channelId, getErrorMessage(error));
    return 'failed';
  }
};

const buildGuildJoinWelcomeLines = (params: {
  sessionId: string | null;
  newsBootstrapStatus: GuildJoinNewsBootstrapStatus;
  channelId: string;
}): string[] => {
  const lines = [...DISCORD_MESSAGES.bot.onboardingWelcomeLines(params.sessionId)];
  const automationReady = isAutomationEnabled() && getNewsMonitorCandidateSourceStatus().configured;

  switch (params.newsBootstrapStatus) {
    case 'created':
      lines.push(
        automationReady
          ? `기본 뉴스 브리핑을 <#${params.channelId}> 채널에 연결했습니다. 새 뉴스가 확인되면 이 채널로 자동 전송됩니다.`
          : `기본 뉴스 브리핑 source를 <#${params.channelId}> 채널에 연결했습니다. 자동화 런타임이 준비되면 이 채널로 전달됩니다.`,
      );
      break;
    case 'existing':
      lines.push(`기본 뉴스 브리핑은 이미 <#${params.channelId}> 채널에 연결되어 있습니다.`);
      break;
    case 'skipped-supabase':
      lines.push('기본 뉴스 프로비저닝은 현재 저장소 연결이 없어 건너뛰었습니다. 필요하면 이 채널에서 `/구독 뉴스`로 직접 연결해주세요.');
      break;
    case 'failed':
      lines.push('기본 뉴스 프로비저닝 중 오류가 있어 이 채널에서 `/구독 뉴스`로 다시 연결해주세요.');
      break;
    case 'skipped-has-sources':
    default:
      break;
  }

  return lines;
};

const ensureGuildJoinReadySurface = async (guild: Guild, onboardingSessionId: string | null): Promise<void> => {
  const channel = resolveGuildBootstrapChannel(guild);
  if (!channel) {
    logger.warn('[AGENT-OPS] guild bootstrap channel missing guild=%s', guild.id);
    return;
  }

  const newsBootstrapStatus = await ensureDefaultGuildNewsSubscription(guild, channel.id);
  const lines = buildGuildJoinWelcomeLines({
    sessionId: onboardingSessionId,
    newsBootstrapStatus,
    channelId: channel.id,
  });

  try {
    await channel.send(lines.join('\n'));
  } catch (error) {
    logger.warn('[AGENT-OPS] guild welcome send failed guild=%s channel=%s error=%s', guild.id, channel.id, getErrorMessage(error));
  }

  if (newsBootstrapStatus === 'created' && isAutomationEnabled() && getNewsMonitorCandidateSourceStatus().configured) {
    void triggerAutomationJob('news-monitor', { guildId: guild.id }).catch((error) => {
      logger.warn('[AGENT-OPS] initial news monitor trigger failed guild=%s error=%s', guild.id, getErrorMessage(error));
    });
  }
};

export const triggerGuildOnboardingSession = (params: {
  guildId: string;
  guildName?: string;
  requestedBy: string;
  reason?: string;
}) => {
  if (!AGENT_AUTO_ONBOARDING_ENABLED) {
    return { ok: false, message: 'AGENT_AUTO_ONBOARDING_ENABLED=false' };
  }

  if (hasRecentOnboardingSession(params.guildId)) {
    return { ok: false, message: '최근 ?�보???�션???��? 존재?�니??' };
  }

  const goal = [
    `길드 ?�보??분석 ?�행`,
    `guildId=${params.guildId}`,
    `guildName=${params.guildName || 'unknown'}`,
    `reason=${params.reason || 'manual'}`,
    '출력: ?�영 ?�격 ?�약, 초기 권장 ?�동??3�? ?�이???�집 ?�의 UX, ?�험?�소',
  ].join('\n');

  const session = startAgentSession({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal,
    skillId: 'guild-onboarding-blueprint',
    isAdmin: true,
  });

  logger.info('[AGENT-OPS] onboarding session started guild=%s session=%s', params.guildId, session.id);

  // Non-blocking snapshot enqueue for memory bootstrap.
  void queueMemoryJob({
    guildId: params.guildId,
    jobType: 'onboarding_snapshot',
    actorId: params.requestedBy,
    input: {
      guildName: params.guildName || null,
      reason: params.reason || 'manual',
      ownerUserId: params.requestedBy,
      sessionId: session.id,
    },
  }).catch((error) => {
    logger.warn('[AGENT-OPS] onboarding snapshot queue failed guild=%s error=%s', params.guildId, getErrorMessage(error));
  });

  return { ok: true, message: '?�보???�션???�작?�습?�다.', sessionId: session.id };
};

const runDailyLearningForGuildIds = (guildIds: string[]) => {
  let started = 0;
  let failed = 0;

  for (const guildId of guildIds.slice(0, AGENT_DAILY_MAX_GUILDS)) {
    const goal = [
      '?�일 ?�영 ?�습/?�고 ?�행',
      `guildId=${guildId}`,
      '목표: 최근 ?�영 ?�슈, ?�못??가?? ?��? ?�호 변?? ?�발 방�? 체크리스?��? ?�약',
      '출력: 1) ?�늘???�심?�습 2) ?�정??규칙 3) ?�일???�선과제',
    ].join('\n');

    try {
      startAgentSession({
        guildId,
        requestedBy: 'system-daily-learning',
        goal,
        skillId: 'incident-review',
        isAdmin: true,
      });
      started += 1;
    } catch {
      failed += 1;
    }
  }

  lastDailyLearningAt = new Date().toISOString();
  lastDailyLearningSummary = `started=${started}, failed=${failed}`;
  logger.info('[AGENT-OPS] daily learning run completed: %s', lastDailyLearningSummary);
  return { started, failed, summary: lastDailyLearningSummary };
};

const buildCutoverAutopilotNotes = (params: {
  readinessRecommended: boolean;
  reason: string;
  failedReasons: string[];
  rolloutPercentage: number;
}) => {
  const failed = params.failedReasons.length > 0 ? params.failedReasons.join('|') : 'none';
  return `auto readiness=${params.readinessRecommended} reason=${params.reason} rollout=${params.rolloutPercentage} failed=${failed}`;
};

const runGotCutoverAutopilotForGuildIds = async (guildIds: string[]) => {
  if (!isSupabaseConfigured()) {
    lastGotCutoverAutopilotAt = new Date().toISOString();
    lastGotCutoverAutopilotSummary = 'skipped=supabase_not_configured';
    return { ok: false, message: 'SUPABASE_NOT_CONFIGURED', processed: 0, promoted: 0, held: 0, failed: 0, summary: lastGotCutoverAutopilotSummary };
  }

  const limitedGuildIds = guildIds.slice(0, AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS);
  const client = getSupabaseClient();
  let processed = 0;
  let promoted = 0;
  let held = 0;
  let failed = 0;

  for (const guildId of limitedGuildIds) {
    try {
      const decision = await getAgentGotCutoverDecision({ guildId, forceRefresh: true });
      const rolloutPercentage = decision.readinessRecommended
        ? AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT
        : 0;

      const { error } = await client
        .from('agent_got_cutover_profiles')
        .upsert({
          guild_id: guildId,
          enabled: true,
          rollout_percentage: rolloutPercentage,
          min_review_samples: AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES,
          updated_by: 'system:got-cutover-autopilot',
          notes: buildCutoverAutopilotNotes({
            readinessRecommended: decision.readinessRecommended,
            reason: decision.reason,
            failedReasons: decision.failedReasons,
            rolloutPercentage,
          }),
        }, { onConflict: 'guild_id' });

      if (error) {
        failed += 1;
        continue;
      }

      processed += 1;
      if (rolloutPercentage > 0) {
        promoted += 1;
      } else {
        held += 1;
      }
    } catch {
      failed += 1;
    }
  }

  lastGotCutoverAutopilotAt = new Date().toISOString();
  lastGotCutoverAutopilotSummary = `processed=${processed}, promoted=${promoted}, held=${held}, failed=${failed}`;
  logger.info('[AGENT-OPS] got cutover autopilot completed: %s', lastGotCutoverAutopilotSummary);

  return {
    ok: true,
    message: `GoT cutover autopilot completed: ${lastGotCutoverAutopilotSummary}`,
    processed,
    promoted,
    held,
    failed,
    summary: lastGotCutoverAutopilotSummary,
  };
};

export const triggerDailyLearningRun = (client: Client, guildId?: string) => {
  if (!AGENT_DAILY_LEARNING_ENABLED) {
    return { ok: false, message: 'AGENT_DAILY_LEARNING_ENABLED=false' };
  }

  const guildIds = guildId ? [guildId] : [...client.guilds.cache.keys()];
  const result = runDailyLearningForGuildIds(guildIds);
  return {
    ok: true,
    message: `?�일 ?�습 ?�행 ?�청 ?�료: ${result.summary}`,
    ...result,
  };
};

export const triggerGotCutoverAutopilotRun = async (client: Client, guildId?: string) => {
  if (!AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED) {
    return { ok: false, message: 'AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED=false', processed: 0, promoted: 0, held: 0, failed: 0, summary: 'disabled' };
  }

  if (gotCutoverAutopilotRunning) {
    return { ok: false, message: 'GoT cutover autopilot is already running', processed: 0, promoted: 0, held: 0, failed: 0, summary: 'running' };
  }

  gotCutoverAutopilotRunning = true;
  try {
    const guildIds = guildId ? [guildId] : [...client.guilds.cache.keys()];
    return await runGotCutoverAutopilotForGuildIds(guildIds);
  } finally {
    gotCutoverAutopilotRunning = false;
  }
};

const scheduleNextDailyRun = (client: Client) => {
  if (!AGENT_DAILY_LEARNING_ENABLED) {
    return;
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(AGENT_DAILY_LEARNING_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  const delayMs = Math.max(1000, next.getTime() - now.getTime());
  dailyTimer = setTimeout(() => {
    try {
      triggerDailyLearningRun(client);
    } finally {
      scheduleNextDailyRun(client);
    }
  }, delayMs);
};

export const startAgentDailyLearningLoop = (client: Client) => {
  if (!AGENT_DAILY_LEARNING_ENABLED || dailyTimer) {
    return;
  }

  scheduleNextDailyRun(client);
  logger.info('[AGENT-OPS] daily learning loop started (hour=%d)', AGENT_DAILY_LEARNING_HOUR);
};

const scheduleNextGotCutoverAutopilotRun = (client: Client) => {
  if (!AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED) {
    return;
  }

  const delayMs = AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN * 60 * 1000;
  gotCutoverAutopilotTimer = setTimeout(() => {
    void triggerGotCutoverAutopilotRun(client).finally(() => {
      scheduleNextGotCutoverAutopilotRun(client);
    });
  }, delayMs);
};

export const startGotCutoverAutopilotLoop = (client: Client) => {
  if (!AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED || gotCutoverAutopilotTimer) {
    return;
  }

  scheduleNextGotCutoverAutopilotRun(client);
  logger.info('[AGENT-OPS] got cutover autopilot loop started (intervalMin=%d)', AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN);
};

export const stopGotCutoverAutopilotLoop = () => {
  if (gotCutoverAutopilotTimer) {
    clearTimeout(gotCutoverAutopilotTimer);
    gotCutoverAutopilotTimer = null;
  }
};

export const stopAgentDailyLearningLoop = () => {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }
};

export const getAgentOpsSnapshot = () => ({
  autoOnboardingEnabled: AGENT_AUTO_ONBOARDING_ENABLED,
  dailyLearningEnabled: AGENT_DAILY_LEARNING_ENABLED,
  dailyLearningHour: AGENT_DAILY_LEARNING_HOUR,
  dailyMaxGuilds: AGENT_DAILY_MAX_GUILDS,
  onboardingCooldownMs: AGENT_ONBOARDING_COOLDOWN_MS,
  gotCutoverAutopilotEnabled: AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED,
  gotCutoverAutopilotIntervalMin: AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN,
  gotCutoverAutopilotMaxGuilds: AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS,
  gotCutoverAutopilotTargetRolloutPercent: AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT,
  gotCutoverAutopilotMinReviewSamples: AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES,
  gotCutoverAutopilotRunning,
  lastGotCutoverAutopilotAt,
  lastGotCutoverAutopilotSummary,
  lastDailyLearningAt,
  lastDailyLearningSummary,
});

export const onGuildJoined = (guild: Guild) => {
  void autoSyncGuildTopologyOnJoin(guild).catch((error) => {
    logger.warn('[AGENT-OPS] topology sync failed guild=%s error=%s', guild.id, getErrorMessage(error));
  });

  void autoBootstrapGuildKnowledgeOnJoin({
    guildId: guild.id,
    guildName: guild.name,
    reason: 'guildCreate',
  }).catch((error) => {
    logger.warn('[AGENT-OPS] obsidian bootstrap failed guild=%s error=%s', guild.id, getErrorMessage(error));
  });

  const onboarding = triggerGuildOnboardingSession({
    guildId: guild.id,
    guildName: guild.name,
    requestedBy: 'system-on-guild-join',
    reason: 'guildCreate',
  });

  void ensureGuildJoinReadySurface(guild, onboarding.ok ? String(onboarding.sessionId || '') : null).catch((error) => {
    logger.warn('[AGENT-OPS] guild ready surface bootstrap failed guild=%s error=%s', guild.id, getErrorMessage(error));
  });

  return onboarding;
};

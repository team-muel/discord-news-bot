import type { Client, Guild } from 'discord.js';
import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv } from '../../utils/env';
import { queueMemoryJob } from './agentMemoryStore';
import { getAgentGotCutoverDecision } from './agentGotCutoverService';
import { listGuildAgentSessions, startAgentSession } from '../multiAgentService';
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
const AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT = Math.max(0, Math.min(100, parseIntegerEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT, 100)));
const AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES = parseMinIntEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES, 20, 0);

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

  return triggerGuildOnboardingSession({
    guildId: guild.id,
    guildName: guild.name,
    requestedBy: 'system-on-guild-join',
    reason: 'guildCreate',
  });
};

import type { Client, Guild } from 'discord.js';
import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { queueMemoryJob } from './agentMemoryStore';
import { getAgentGotCutoverDecision } from './agentGotCutoverService';
import { listGuildAgentSessions, startAgentSession } from './multiAgentService';
import { autoBootstrapGuildKnowledgeOnJoin } from './obsidianBootstrapService';
import { autoSyncGuildTopologyOnJoin } from './discordTopologySyncService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const AGENT_AUTO_ONBOARDING_ENABLED = parseBooleanEnv(process.env.AGENT_AUTO_ONBOARDING_ENABLED, true);
const AGENT_DAILY_LEARNING_ENABLED = parseBooleanEnv(process.env.AGENT_DAILY_LEARNING_ENABLED, true);
const AGENT_DAILY_LEARNING_HOUR = Math.min(23, Math.max(0, parseIntegerEnv(process.env.AGENT_DAILY_LEARNING_HOUR, 4)));
const AGENT_DAILY_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.AGENT_DAILY_MAX_GUILDS, 30));
const AGENT_ONBOARDING_COOLDOWN_MS = Math.max(60_000, parseIntegerEnv(process.env.AGENT_ONBOARDING_COOLDOWN_MS, 6 * 60 * 60 * 1000));
const AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED = parseBooleanEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED, true);
const AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN = Math.max(5, parseIntegerEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN, 60));
const AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS = Math.max(1, parseIntegerEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS, 100));
const AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT = Math.max(0, Math.min(100, parseIntegerEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT, 100)));
const AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES = Math.max(0, parseIntegerEnv(process.env.AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES, 20));

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
    return { ok: false, message: '최근 온보딩 세션이 이미 존재합니다.' };
  }

  const goal = [
    `길드 온보딩 분석 실행`,
    `guildId=${params.guildId}`,
    `guildName=${params.guildName || 'unknown'}`,
    `reason=${params.reason || 'manual'}`,
    '출력: 운영 성격 요약, 초기 권장 자동화 3개, 데이터 수집 동의 UX, 위험요소',
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
    logger.warn('[AGENT-OPS] onboarding snapshot queue failed guild=%s error=%s', params.guildId, error instanceof Error ? error.message : String(error));
  });

  return { ok: true, message: '온보딩 세션을 시작했습니다.', sessionId: session.id };
};

const runDailyLearningForGuildIds = (guildIds: string[]) => {
  let started = 0;
  let failed = 0;

  for (const guildId of guildIds.slice(0, AGENT_DAILY_MAX_GUILDS)) {
    const goal = [
      '일일 운영 학습/회고 실행',
      `guildId=${guildId}`,
      '목표: 최근 운영 이슈, 잘못된 가정, 유저 선호 변화, 재발 방지 체크리스트를 요약',
      '출력: 1) 오늘의 핵심학습 2) 수정할 규칙 3) 내일의 우선과제',
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
    message: `일일 학습 실행 요청 완료: ${result.summary}`,
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
    logger.warn('[AGENT-OPS] topology sync failed guild=%s error=%s', guild.id, error instanceof Error ? error.message : String(error));
  });

  void autoBootstrapGuildKnowledgeOnJoin({
    guildId: guild.id,
    guildName: guild.name,
    reason: 'guildCreate',
  }).catch((error) => {
    logger.warn('[AGENT-OPS] obsidian bootstrap failed guild=%s error=%s', guild.id, error instanceof Error ? error.message : String(error));
  });

  return triggerGuildOnboardingSession({
    guildId: guild.id,
    guildName: guild.name,
    requestedBy: 'system-on-guild-join',
    reason: 'guildCreate',
  });
};

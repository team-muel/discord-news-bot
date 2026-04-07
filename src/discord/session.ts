/**
 * Session progress rendering + streaming helpers.
 * Extracted from bot.ts to keep the rendering logic isolated.
 */
import { type AgentSession, cancelAgentSession, getAgentSession, startAgentSession } from '../services/multiAgentService';
import { buildReasoningGoalForGuild } from '../services/taskRoutingService';
import { recordTaskRoutingMetric } from '../services/taskRoutingMetricsService';
import { DISCORD_MESSAGES } from './messages';
import {
  DISCORD_ENABLE_FEEDBACK_PROMPT,
  DISCORD_FEEDBACK_PROMPT_LINE,
} from '../config';
import {
  FEEDBACK_REACTION_SEED_DOWN,
  FEEDBACK_REACTION_SEED_ENABLED,
  FEEDBACK_REACTION_SEED_UP,
  SESSION_PROGRESS_INTERVAL_MS,
  SESSION_PROGRESS_TIMEOUT_MS,
  SESSION_PROGRESS_UPDATE_BUCKET_MS,
  SESSION_RESULT_CLIP_LIMIT_DEBUG,
  SESSION_RESULT_CLIP_LIMIT_USER,
} from './runtimePolicy';

const FEEDBACK_PROMPT_ENABLED = DISCORD_ENABLE_FEEDBACK_PROMPT;
const FEEDBACK_PROMPT_LINE = DISCORD_FEEDBACK_PROMPT_LINE;

// ─── Types ────────────────────────────────────────────────────────────────────
export type ProgressSink = {
  update: (content: string) => Promise<unknown>;
};

export type ProgressRenderOptions = {
  showDebugBlocks: boolean;
  maxLinks: number;
};

// ─── Feedback reaction seeding ────────────────────────────────────────────────
/**
 * Add 👍/👎 seed reactions to a bot reply so users can one-click feedback.
 * Silently swallows errors — reactions are best-effort.
 */
export const seedFeedbackReactions = async (
  message: { react: (emoji: string) => Promise<unknown> } | null | undefined,
): Promise<void> => {
  if (!FEEDBACK_REACTION_SEED_ENABLED || !message) return;
  await Promise.all([
    message.react(FEEDBACK_REACTION_SEED_UP).catch(() => {}),
    message.react(FEEDBACK_REACTION_SEED_DOWN).catch(() => {}),
  ]);
};

// ─── Internal utils ───────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const SECTION_LABEL_ONLY_PATTERN =
  /^(?:#+\s*)?(?:deliverable|verification|confidence)\s*:?$/i;
const DEBUG_LINE_PATTERN =
  /^(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/;
const DEBUG_INLINE_PATTERN =
  /(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/;

const isDebugLine = (line: string): boolean =>
  DEBUG_LINE_PATTERN.test(String(line || '').trim());

const stripActionDebugText = (raw: string): string => {
  const lines = String(raw || '').split(/\r?\n/);
  const kept: string[] = [];
  const keptLinks: string[] = [];
  let section: 'none' | 'artifact' | 'verification' = 'none';

  const pushLink = (value: string) => {
    const links = String(value || '').match(URL_PATTERN) || [];
    for (const link of links) {
      if (!keptLinks.includes(link)) keptLinks.push(link);
    }
  };

  for (const original of lines) {
    const line = String(original || '').trim();
    if (!line) continue;

    if (line.startsWith('산출물:')) {
      section = 'artifact';
      const body = line.replace(/^산출물:\s*/i, '').trim();
      pushLink(body);
      if (body && body !== '없음') kept.push(body.replace(DEBUG_INLINE_PATTERN, '').trim());
      continue;
    }
    if (line.startsWith('검증:')) { section = 'verification'; continue; }
    if (isDebugLine(line)) { section = 'none'; continue; }
    if (section === 'verification' && line.startsWith('-')) continue;

    if (line.startsWith('- ')) {
      const bulletBody = line.slice(2).trim();
      pushLink(bulletBody);
      if (section === 'artifact' && bulletBody) {
        const cleaned = bulletBody.replace(DEBUG_INLINE_PATTERN, '').trim();
        if (cleaned) kept.push(cleaned);
      }
      continue;
    }

    pushLink(line);
    if (DEBUG_INLINE_PATTERN.test(line)) {
      const cleaned = line
        .replace(/요청 결과\s*/g, '')
        .replace(/액션:[^\n]*/g, '')
        .replace(/검증:[^\n]*/g, '')
        .replace(/재시도 횟수:[^\n]*/g, '')
        .replace(/소요시간\(ms\):[^\n]*/g, '')
        .replace(/상태:[^\n]*/g, '')
        .trim();
      if (cleaned) kept.push(cleaned);
      continue;
    }
    kept.push(line);
  }

  const compact = kept
    .filter((l) => !isDebugLine(l))
    .map((l) => l.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (compact) return compact;

  if (keptLinks.length > 0) {
    const top = keptLinks.slice(0, 2);
    return [DISCORD_MESSAGES.session.linkFoundHeader, ...top.map((url) => `- ${url}`)].join('\n');
  }
  return '';
};

const extractDeliverableBody = (raw: string): string | null => {
  const match = raw.match(
    /##\s*Deliverable\s*([\s\S]*?)(?:\n##\s*Verification|\n##\s*Confidence|$)/i,
  );
  if (!match) return null;
  return String(match[1] || '').trim() || null;
};

const removeSectionLabelLeaks = (raw: string): string =>
  String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !SECTION_LABEL_ONLY_PATTERN.test(l))
    .map((l) => l.replace(/^#+\s*(deliverable|verification|confidence)\s*:?\s*/i, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

const limitLinks = (input: string, maxLinks: number): string => {
  if (maxLinks < 1) return input.replace(URL_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  let count = 0;
  return input
    .replace(URL_PATTERN, (url) => {
      count++;
      return count <= maxLinks ? url : '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const toUserFacingResult = (session: AgentSession, options: ProgressRenderOptions): string => {
  const raw = String(session.result || '').trim();
  if (!raw) return DISCORD_MESSAGES.session.emptyResult;
  if (options.showDebugBlocks) return raw;

  const sourceText = extractDeliverableBody(raw) || raw;
  const cleaned = stripActionDebugText(sourceText) || stripActionDebugText(raw);
  const stripped = String(cleaned || '')
    .replace(/##\s*Verification[\s\S]*/i, '')
    .replace(/##\s*Confidence[\s\S]*/i, '')
    .trim();
  const deLabeled = removeSectionLabelLeaks(stripped);
  const linkLimited = limitLinks(deLabeled, options.maxLinks);

  const base = linkLimited || DISCORD_MESSAGES.session.noDisplayableResult;
  if (!FEEDBACK_PROMPT_ENABLED || !FEEDBACK_PROMPT_LINE || options.showDebugBlocks) {
    return base;
  }
  if (base.includes(FEEDBACK_PROMPT_LINE)) {
    return base;
  }
  return `${base}\n\n${FEEDBACK_PROMPT_LINE}`;
};

const toUserFacingFailureMessage = (session: AgentSession): string => {
  const cleaned = stripActionDebugText(String(session.error || '').trim());
  if (cleaned) return `${DISCORD_MESSAGES.session.failureGeneric.split('\n')[0]}\n${cleaned}`;
  return DISCORD_MESSAGES.session.failureGeneric;
};

const toFriendlyStageLine = (stage: string): string => {
  const n = String(stage || '').toLowerCase();
  if (/계획|plan/.test(n)) return '지금 계획을 생각 중이에요.';
  if (/조사|research|자료|검색|수집/.test(n)) return '관련 자료를 찾고 정리 중이에요.';
  if (/검토|critic|리스크|확인/.test(n)) return '결과를 점검하고 다듬고 있어요.';
  if (/실행|execution/.test(n)) return '실행 내용을 정리 중이에요.';
  if (/최종|응답|final/.test(n)) return '답변을 마무리하고 있어요.';
  return '요청을 계속 처리 중이에요.';
};

const describeActiveStep = (session: AgentSession): string => {
  const running = session.steps.find((s) => s.status === 'running');
  if (running) return running.title;
  const pending = session.steps.find((s) => s.status === 'pending');
  if (pending) return pending.title;
  return '최종 응답 생성';
};

// ─── Public API ───────────────────────────────────────────────────────────────
export const buildSessionProgressText = (
  session: AgentSession,
  goal: string,
  options: ProgressRenderOptions,
  elapsedMs: number,
): string => {
  if (session.status === 'queued') {
    const sec = Math.max(0, Math.floor(elapsedMs / 1000));
    return DISCORD_MESSAGES.session.queued(sec);
  }
  if (session.status === 'running') {
    const sec = Math.max(0, Math.floor(elapsedMs / 1000));
    const stage = describeActiveStep(session);
    if (!options.showDebugBlocks) {
      return [
        DISCORD_MESSAGES.session.runningHeader,
        toFriendlyStageLine(stage),
        DISCORD_MESSAGES.session.runningElapsed(sec),
      ].join('\n');
    }
    return [
      DISCORD_MESSAGES.session.runningDebugHeader,
      DISCORD_MESSAGES.session.runningDebugStage(stage),
      DISCORD_MESSAGES.session.runningDebugElapsed(sec),
      DISCORD_MESSAGES.session.runningDebugTail,
    ].join('\n');
  }
  if (session.status === 'cancelled') {
    if (!options.showDebugBlocks) return DISCORD_MESSAGES.session.cancelled;
    return [
      DISCORD_MESSAGES.session.cancelledDebugHeader,
      DISCORD_MESSAGES.session.cancelledDebugGoal(goal),
      session.error ? DISCORD_MESSAGES.session.cancelledDebugReason(session.error) : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (session.status === 'failed') {
    if (!options.showDebugBlocks) return toUserFacingFailureMessage(session);
    return [
      DISCORD_MESSAGES.session.failedDebugHeader,
      DISCORD_MESSAGES.session.failedDebugGoal(goal),
      DISCORD_MESSAGES.session.failedDebugError(session.error || 'unknown'),
    ].join('\n');
  }

  const content = toUserFacingResult(session, options);
  const wrapped = content;
  const clipLimit = options.showDebugBlocks ? SESSION_RESULT_CLIP_LIMIT_DEBUG : SESSION_RESULT_CLIP_LIMIT_USER;
  return wrapped.length > clipLimit ? `${wrapped.slice(0, clipLimit)}\n...` : wrapped;
};

export const streamSessionProgress = async (
  sink: ProgressSink,
  sessionId: string,
  goal: string,
  options: ProgressRenderOptions,
): Promise<void> => {
  const startedAt = Date.now();
  const timeoutMs = SESSION_PROGRESS_TIMEOUT_MS;
  const intervalMs = SESSION_PROGRESS_INTERVAL_MS;
  const updateBucketMs = SESSION_PROGRESS_UPDATE_BUCKET_MS;
  let previous = '';
  let previousBucket = -1;

  while (Date.now() - startedAt < timeoutMs) {
    const session = getAgentSession(sessionId);
    if (!session) {
      await sink.update(DISCORD_MESSAGES.session.sessionNotFound);
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const bucket = Math.floor(elapsedMs / updateBucketMs);
    const text = buildSessionProgressText(session, goal, options, elapsedMs);
    const forceHeartbeat =
      session.status === 'queued' || session.status === 'running';
    if (text !== previous || (forceHeartbeat && bucket !== previousBucket)) {
      await sink.update(text);
      previous = text;
      previousBucket = bucket;
    }

    if (
      session.status === 'completed' ||
      session.status === 'failed' ||
      session.status === 'cancelled'
    ) {
      return;
    }
    await sleep(intervalMs);
  }

  const cancelResult = cancelAgentSession(sessionId);

  if (options.showDebugBlocks) {
    await sink.update(
      [
        DISCORD_MESSAGES.session.timeoutDebugHeader,
        DISCORD_MESSAGES.session.timeoutDebugSession(sessionId),
        `중단 결과: ${cancelResult.message}`,
        DISCORD_MESSAGES.session.timeoutDebugHint,
      ].join('\n'),
    );
    return;
  }

  await sink.update(cancelResult.ok
    ? DISCORD_MESSAGES.session.timeoutUserCancelled
    : DISCORD_MESSAGES.session.timeoutUser);
};

export const startVibeSession = async (
  guildId: string,
  userId: string,
  request: string,
): Promise<AgentSession> => {
    const routed = await buildReasoningGoalForGuild(request, guildId);
    const session = startAgentSession({
      guildId,
      requestedBy: userId,
      goal: routed.goal,
      skillId: null,
      priority: routed.route === 'knowledge' ? 'fast' : 'balanced',
    });

    void recordTaskRoutingMetric({
      guildId,
      requestedBy: userId,
      goal: request,
      channel: 'vibe',
      route: routed.route,
      confidence: routed.confidence,
      reasons: routed.reasons,
      overrideUsed: routed.overrideUsed,
      status: 'success',
      durationMs: 0,
      extra: {
        sessionId: session.id,
        priority: session.priority,
      },
    });

    return session;
  };

export const inferSessionSkill = (
  text: string,
):
  | 'ops-plan'
  | 'ops-execution'
  | 'ops-critique'
  | 'guild-onboarding-blueprint'
  | 'incident-review'
  | 'webhook' => {
  const n = String(text || '').toLowerCase();
  if (/web\s*hook|webhook|웹훅/.test(n)) return 'webhook';
  if (/onboard|온보딩|신규 서버|초기 설정/.test(n)) return 'guild-onboarding-blueprint';
  if (/incident|장애|사고|회고|재발/.test(n)) return 'incident-review';
  if (/critique|검토|리스크|위험|보완/.test(n)) return 'ops-critique';
  if (/plan|계획|로드맵|단계/.test(n)) return 'ops-plan';
  return 'ops-execution';
};

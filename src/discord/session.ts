/**
 * Session progress rendering + streaming helpers.
 * Extracted from bot.ts to keep the rendering logic isolated.
 */
import type { AgentSession } from '../services/multiAgentService';
import { getAgentSession, startAgentSession } from '../services/multiAgentService';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ProgressSink = {
  update: (content: string) => Promise<unknown>;
};

export type ProgressRenderOptions = {
  showDebugBlocks: boolean;
  maxLinks: number;
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
    return ['요청한 링크를 찾았어요.', ...top.map((url) => `- ${url}`)].join('\n');
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
  if (!raw) return '결과가 비어 있습니다.';
  if (options.showDebugBlocks) return raw;

  const sourceText = extractDeliverableBody(raw) || raw;
  const cleaned = stripActionDebugText(sourceText) || stripActionDebugText(raw);
  const stripped = String(cleaned || '')
    .replace(/##\s*Verification[\s\S]*/i, '')
    .replace(/##\s*Confidence[\s\S]*/i, '')
    .trim();
  const deLabeled = removeSectionLabelLeaks(stripped);
  const linkLimited = limitLinks(deLabeled, options.maxLinks);
  return linkLimited || '요청을 처리했지만 표시 가능한 결과 본문이 없어 다시 시도해주세요.';
};

const toUserFacingFailureMessage = (session: AgentSession): string => {
  const cleaned = stripActionDebugText(String(session.error || '').trim());
  if (cleaned) return `요청 처리 중 문제가 발생했습니다.\n${cleaned}`;
  return '요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
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
    return `요청을 처리하기 위해 준비 중입니다... (대기 ${sec}초)`;
  }
  if (session.status === 'running') {
    const sec = Math.max(0, Math.floor(elapsedMs / 1000));
    const stage = describeActiveStep(session);
    return [
      '요청을 실행 중입니다.',
      `현재 단계: ${stage}`,
      `경과시간: ${sec}초`,
      '지연이 길어지면 자동으로 타임아웃/폴백 처리됩니다.',
    ].join('\n');
  }
  if (session.status === 'cancelled') {
    if (!options.showDebugBlocks) return '요청이 중지되었습니다.';
    return ['작업이 중지되었습니다.', `목표: ${goal}`, session.error ? `사유: ${session.error}` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (session.status === 'failed') {
    if (!options.showDebugBlocks) return toUserFacingFailureMessage(session);
    return ['작업이 실패했습니다.', `목표: ${goal}`, `오류: ${session.error || 'unknown'}`].join('\n');
  }

  const content = toUserFacingResult(session, options);
  const wrapped = options.showDebugBlocks
    ? content
    : ['요청하신 결과입니다.', '', content].join('\n');
  const clipLimit = options.showDebugBlocks ? 1700 : 1200;
  return wrapped.length > clipLimit ? `${wrapped.slice(0, clipLimit)}\n...` : wrapped;
};

export const streamSessionProgress = async (
  sink: ProgressSink,
  sessionId: string,
  goal: string,
  options: ProgressRenderOptions,
): Promise<void> => {
  const startedAt = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  const intervalMs = 2200;
  const updateBucketMs = 10_000;
  let previous = '';
  let previousBucket = -1;

  while (Date.now() - startedAt < timeoutMs) {
    const session = getAgentSession(sessionId);
    if (!session) {
      await sink.update('세션 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
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

  await sink.update(
    [
      '작업은 계속 진행 중입니다.',
      `세션: ${sessionId}`,
      '진행 상황은 /상태 세션아이디:<ID> 로 확인할 수 있습니다.',
    ].join('\n'),
  );
};

export const startVibeSession = (
  guildId: string,
  userId: string,
  request: string,
): AgentSession =>
  startAgentSession({
    guildId,
    requestedBy: userId,
    goal: request,
    skillId: null,
    priority: 'balanced',
  });

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

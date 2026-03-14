import crypto from 'crypto';
import { buildAgentMemoryHints } from './agentMemoryService';
import { getAgentPolicySnapshot, primeAgentPolicyCache, validateAgentSessionRequest } from './agentPolicyService';
import { persistAgentSession } from './agentSessionStore';
import { generateText, isAnyLlmConfigured } from './llmClient';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillId } from './skills/types';
import { getWorkflowStepTemplates, primeWorkflowProfileCache } from './agentWorkflowService';

export type AgentRole = 'planner' | 'researcher' | 'critic';
export type AgentPriority = 'fast' | 'balanced' | 'precise';
export type AgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentIntent = 'task' | 'casual_chat' | 'uncertain';

export type AgentStep = {
  id: string;
  role: AgentRole;
  title: string;
  status: AgentStepStatus;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  error: string | null;
};

export type AgentSession = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  priority: AgentPriority;
  requestedSkillId: SkillId | null;
  routedIntent: AgentIntent;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  result: string | null;
  error: string | null;
  cancelRequested: boolean;
  memoryHints: string[];
  steps: AgentStep[];
};

export type AgentRuntimeSnapshot = {
  totalSessions: number;
  runningSessions: number;
  queuedSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  deadletteredSessions: number;
  latestSessionAt: string | null;
};

type AgentDeadletter = {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  reason: string;
  failedAt: string;
};

const MAX_SESSION_HISTORY = Math.max(50, Number(process.env.AGENT_MAX_SESSION_HISTORY || 300));
const AGENT_SESSION_TIMEOUT_MS = Math.max(20_000, Number(process.env.AGENT_SESSION_TIMEOUT_MS || 180_000));
const AGENT_STEP_TIMEOUT_MS = Math.max(5_000, Number(process.env.AGENT_STEP_TIMEOUT_MS || 75_000));
const AGENT_MEMORY_HINT_TIMEOUT_MS = Math.max(500, Number(process.env.AGENT_MEMORY_HINT_TIMEOUT_MS || 5_000));
const AGENT_QUEUE_POLL_MS = Math.max(100, Number(process.env.AGENT_QUEUE_POLL_MS || 250));
const AGENT_MAX_QUEUE_SIZE = Math.max(10, Number(process.env.AGENT_MAX_QUEUE_SIZE || 300));
const AGENT_SESSION_MAX_ATTEMPTS = Math.max(1, Number(process.env.AGENT_SESSION_MAX_ATTEMPTS || 2));
const AGENT_DEADLETTER_MAX = Math.max(10, Number(process.env.AGENT_DEADLETTER_MAX || 300));
const sessions = new Map<string, AgentSession>();
const pendingSessionQueue: string[] = [];
const runningSessionIds = new Set<string>();
const sessionAttempts = new Map<string, number>();
const deadletters: AgentDeadletter[] = [];
let queueDrainTimer: NodeJS.Timeout | null = null;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const ensureSessionBudget = (sessionStartedAtMs: number) => {
  if (Date.now() - sessionStartedAtMs > AGENT_SESSION_TIMEOUT_MS) {
    throw new Error('SESSION_TIMEOUT');
  }
};

const toPriority = (value?: string | null): AgentPriority => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fast' || normalized === '빠름') {
    return 'fast';
  }
  if (normalized === 'precise' || normalized === '정밀') {
    return 'precise';
  }
  return 'balanced';
};

const nowIso = () => new Date().toISOString();

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const extractMemoryCitations = (memoryHints: string[]): string[] => {
  const out: string[] = [];
  for (const hint of memoryHints) {
    const line = String(hint || '');
    const matches = line.match(/\[memory:([^\]\s]+)/g) || [];
    for (const match of matches) {
      const id = match.replace('[memory:', '').replace(']', '').trim();
      if (!id) continue;
      if (!out.includes(id)) {
        out.push(id);
      }
      if (out.length >= 6) {
        return out;
      }
    }
  }
  return out;
};

const toConfidenceLabel = (priority: AgentPriority, citationCount: number): string => {
  if (citationCount >= 2 && priority === 'precise') {
    return 'high';
  }
  if (citationCount >= 1) {
    return 'medium';
  }
  return 'low';
};

const toConclusion = (raw: string): string => {
  const compact = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '현재 시점에서 확정할 수 있는 결론을 생성하지 못했습니다.';
  }
  return compact.slice(0, 280);
};

const parseIntentFromLlm = (raw: string): AgentIntent | null => {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const intent = String(parsed.intent || '').trim().toLowerCase();
    if (intent === 'task') {
      return 'task';
    }
    if (intent === 'casual_chat') {
      return 'casual_chat';
    }
    if (intent === 'uncertain') {
      return 'uncertain';
    }
  } catch {
    return null;
  }

  return null;
};

const classifyIntent = async (params: {
  guildId: string;
  goal: string;
  requestedSkillId: SkillId | null;
  intentHints: string[];
}): Promise<AgentIntent> => {
  const { goal, requestedSkillId, intentHints } = params;
  if (requestedSkillId) {
    return 'task';
  }

  const text = String(goal || '').trim();
  if (!text) {
    return 'task';
  }

  const hintLines = intentHints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 4)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const raw = await generateText({
      system: [
        '너는 대화 의도 분류기다.',
        'task: 정보/방법 요청, 기술 설정·연동·구성, 작업 실행, 검색·분석·생성, "~하고 싶어(목적·기능)", "알려줘야", "어떻게", "방법" 등 무언가를 얻거나 이루려는 모든 발화.',
        'casual_chat: 순수 감정 토로(우울해, 힘들어), 단순 인사, 목적 없는 잡담. 기술/작업 맥락이 조금이라도 있으면 task.',
        'uncertain: 문장이 짧거나 모호해서 task/casual_chat 판별 신뢰가 낮은 경우. 정책/권한/관리 이슈가 섞였지만 목표가 불명확한 경우도 uncertain.',
        '출력은 반드시 JSON 한 줄만 사용한다.',
      ].join('\n'),
      user: [
        '참고 메모리 힌트(길드 정책/맥락):',
        hintBlock,
        `문장: ${text}`,
        '출력 형식: {"intent":"task|casual_chat|uncertain"}',
      ].join('\n'),
      temperature: 0,
      maxTokens: 40,
    });

    return parseIntentFromLlm(raw) || 'uncertain';
  } catch {
    return 'uncertain';
  }
};

const buildIntentClarificationFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (!text) {
    return '요청을 정확히 처리하려면 원하는 결과를 한 줄로 알려주세요. 예: "공지 채널 하나 만들어줘" 또는 "그냥 오늘 힘들었어"';
  }
  return '요청을 안전하게 처리하려고 확인이 필요해요. 지금 원하는 게 작업 실행인지, 그냥 대화/상담인지 한 줄로 알려주세요.';
};

const generateIntentClarificationResult = async (goal: string, hints: string[]): Promise<string> => {
  const hintLines = hints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 3)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const output = await generateText({
      system: [
        '너는 디스코드 운영 봇의 안전 라우팅 어시스턴트다.',
        '목표가 모호할 때는 자동 실행을 시작하지 말고 확인 질문 1개만 한다.',
        '출력은 짧은 한국어 1~2문장으로 작성한다.',
      ].join('\n'),
      user: [
        '아래 사용자 발화는 의도가 모호하다.',
        `사용자 발화: ${String(goal || '').trim()}`,
        '참고 메모리 힌트:',
        hintBlock,
        '작업 실행 vs 일반 대화 중 무엇을 원하는지 확인하는 질문을 작성해라.',
      ].join('\n'),
      temperature: 0.2,
      maxTokens: 120,
    });

    const text = String(output || '').trim();
    return text || buildIntentClarificationFallback(goal);
  } catch {
    return buildIntentClarificationFallback(goal);
  }
};

const buildCasualChatFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (/우울|슬퍼|힘들|불안/.test(text)) {
    return '많이 지쳤던 것 같아요. 괜찮다면 오늘 특히 힘들었던 순간이 뭐였는지 한 가지만 말해줄래요?';
  }
  return '들려줘서 고마워요. 지금 마음이나 상황을 한두 문장만 더 말해주면, 거기에 맞춰 같이 이야기해볼게요.';
};

const generateCasualChatResult = async (goal: string): Promise<string> => {
  try {
    const output = await generateText({
      system: [
        '너는 공감형 한국어 대화 파트너다.',
        '도구 호출을 유도하거나 작업 실행으로 전환하지 않는다.',
        '과거 데이터베이스/장기기억(메모리, Obsidian)을 먼저 뒤지지 않는다.',
        '감정적 호소나 짧은 일상어에는 현재 맥락에 공감한 뒤 가벼운 질문 1개로 핑퐁을 유도한다.',
        '질문 예시 톤: 무슨 일 있었어?, 어떤 빵 먹었어?',
        '짧고 자연스럽게 공감하고, 필요하면 한 가지 되묻기만 한다.',
        '진단, 단정, 과도한 조언은 피한다.',
      ].join('\n'),
      user: [
        '사용자 발화에 대해 자연스럽게 답해라.',
        '출력은 일반 대화 문장만 작성한다.',
        '근거/검증/confidence 같은 섹션 제목을 쓰지 않는다.',
        `사용자: ${String(goal || '').trim()}`,
      ].join('\n'),
      temperature: 0.5,
      maxTokens: 220,
    });

    const text = String(output || '').trim();
    return text || buildCasualChatFallback(goal);
  } catch {
    return buildCasualChatFallback(goal);
  }
};

const cancelAllPendingSteps = (session: AgentSession, timestamp: string) => {
  for (const step of session.steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = 'cancelled';
      step.startedAt = step.startedAt || timestamp;
      step.endedAt = timestamp;
    }
  }
};

const formatCitationFirstResult = (rawResult: string, session: AgentSession): string => {
  const citations = extractMemoryCitations(session.memoryHints);
  const confidence = toConfidenceLabel(session.priority, citations.length);
  const conclusion = toConclusion(rawResult);

  const citationText = citations.length > 0
    ? citations.map((id) => `- memory:${id}`).join('\n')
    : '- 근거 부족: memory 힌트에서 직접 인용 가능한 항목을 찾지 못했습니다.';

  return [
    '## Deliverable',
    conclusion,
    '',
    '## Verification',
    citationText,
    '',
    `## Confidence: ${confidence}`,
  ].join('\n');
};

const touch = (session: AgentSession) => {
  session.updatedAt = nowIso();
};

const buildInitialSteps = (
  guildId: string,
  requestedSkillId: SkillId | null,
  priority: AgentPriority,
  timestamp: string,
): AgentStep[] => {
  primeWorkflowProfileCache();
  const templates = getWorkflowStepTemplates({
    guildId,
    priority,
    hasRequestedSkill: Boolean(requestedSkillId),
  });

  return templates.map((template) => {
    const cancelled = Boolean(
      (priority === 'fast' && template.skipWhenFast)
      || (requestedSkillId && template.skipWhenRequestedSkill),
    );
    return {
      id: crypto.randomUUID(),
      role: template.role,
      title: requestedSkillId && template.role === 'planner'
        ? `스킬 실행: ${requestedSkillId}`
        : template.title,
      status: cancelled ? 'cancelled' : 'pending',
      startedAt: null,
      endedAt: cancelled ? timestamp : null,
      output: null,
      error: null,
    };
  });
};

const cloneSession = (session: AgentSession): AgentSession => ({
  ...session,
  steps: session.steps.map((step) => ({ ...step })),
});

const getSession = (sessionId: string): AgentSession => sessions.get(sessionId) as AgentSession;

const markSessionTerminal = (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => {
  session.status = status;
  session.endedAt = nowIso();
  if (patch?.result !== undefined) {
    session.result = patch.result;
  }
  if (patch?.error !== undefined) {
    session.error = patch.error;
  }
  touch(session);
  void persistAgentSession(cloneSession(session));
};

const runStep = async (
  session: AgentSession,
  step: AgentStep,
  skillId: SkillId,
  buildInput: (priorOutput?: string) => string,
  priorOutput?: string,
): Promise<string> => {
  if (session.cancelRequested) {
    step.status = 'cancelled';
    step.startedAt = step.startedAt || nowIso();
    step.endedAt = nowIso();
    touch(session);
    throw new Error('SESSION_CANCELLED');
  }

  step.status = 'running';
  step.startedAt = nowIso();
  touch(session);

  try {
    const result = await withTimeout(executeSkill(skillId, {
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      goal: buildInput(priorOutput),
      memoryHints: session.memoryHints,
      priorOutput,
    }), AGENT_STEP_TIMEOUT_MS, `STEP_TIMEOUT:${step.role}`);

    const output = result.output;
    if (session.cancelRequested) {
      step.status = 'cancelled';
      step.endedAt = nowIso();
      touch(session);
      throw new Error('SESSION_CANCELLED');
    }

    step.status = 'completed';
    step.endedAt = nowIso();
    step.output = String(output || '').trim();
    touch(session);
    return step.output;
  } catch (error) {
    step.status = 'failed';
    step.endedAt = nowIso();
    step.error = getErrorMessage(error);
    touch(session);
    throw error;
  }
};

const executeSession = async (sessionId: string): Promise<AgentSessionStatus> => {
  const session = getSession(sessionId);
  if (!session) {
    return 'failed';
  }

  session.status = 'running';
  session.startedAt = nowIso();
  touch(session);
  void persistAgentSession(cloneSession(session));
  const sessionStartedAtMs = Date.now();

  try {
    ensureSessionBudget(sessionStartedAtMs);
    const intentHints = await withTimeout(buildAgentMemoryHints({
      guildId: session.guildId,
      goal: session.goal,
      maxItems: 4,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_HINT_TIMEOUT').catch(() => []);
    session.routedIntent = await classifyIntent({
      guildId: session.guildId,
      goal: session.goal,
      requestedSkillId: session.requestedSkillId,
      intentHints,
    });
    touch(session);

    if (session.routedIntent === 'casual_chat') {
      ensureSessionBudget(sessionStartedAtMs);
      const timestamp = nowIso();
      cancelAllPendingSteps(session, timestamp);
      const casualReply = await generateCasualChatResult(session.goal);
      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: casualReply,
        error: null,
      });
      return session.cancelRequested ? 'cancelled' : 'completed';
    }

    if (session.routedIntent === 'uncertain') {
      ensureSessionBudget(sessionStartedAtMs);
      const timestamp = nowIso();
      cancelAllPendingSteps(session, timestamp);
      const clarification = await generateIntentClarificationResult(session.goal, intentHints);
      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: clarification,
        error: null,
      });
      return session.cancelRequested ? 'cancelled' : 'completed';
    }

    ensureSessionBudget(sessionStartedAtMs);
    session.memoryHints = await withTimeout(buildAgentMemoryHints({
      guildId: session.guildId,
      goal: session.goal,
      maxItems: session.priority === 'fast' ? 4 : session.priority === 'precise' ? 16 : 10,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'MEMORY_HINT_TIMEOUT').catch(() => []);
    touch(session);

    if (session.requestedSkillId) {
      ensureSessionBudget(sessionStartedAtMs);
      const singleSkillStep = session.steps[0];
      const singleResult = await runStep(
        session,
        singleSkillStep,
        session.requestedSkillId,
        () => session.goal,
        undefined,
      );

      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: formatCitationFirstResult(singleResult, session),
        error: null,
      });
      return session.cancelRequested ? 'cancelled' : 'completed';
    }

    const planner = session.steps[0];
    const researcher = session.steps[1];
    const critic = session.steps[2];

    if (session.priority === 'fast') {
      ensureSessionBudget(sessionStartedAtMs);
      const fastDraft = await runStep(session, researcher, 'ops-execution', () => [
        '우선순위: 빠름',
        '요구사항: 중간 과정 없이 최종 결과물만 제시',
        `목표: ${session.goal}`,
        '출력: 바로 사용할 수 있는 결과물 텍스트',
      ].join('\n'), undefined);

      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: formatCitationFirstResult(fastDraft, session),
        error: null,
      });
      return session.cancelRequested ? 'cancelled' : 'completed';
    }

    ensureSessionBudget(sessionStartedAtMs);
    const plan = await runStep(session, planner, 'ops-plan', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (검증과 리스크 완화를 강화)' : '우선순위: 균형',
      '역할: 계획 수립 에이전트',
      `목표: ${session.goal}`,
      '출력: 1) 실행 단계 2) 필요한 근거 3) 실패시 대안 을 간결한 한국어 문단으로 작성',
      '규칙: 추측과 단정 금지, 실제 실행 가능한 단계 중심',
    ].join('\n'), undefined);

    ensureSessionBudget(sessionStartedAtMs);
    const executionDraft = await runStep(session, researcher, 'ops-execution', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
      '역할: 실행/리서치 에이전트',
      `목표: ${session.goal}`,
      `계획안: ${plan}`,
      '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
    ].join('\n'), plan);

    ensureSessionBudget(sessionStartedAtMs);
    const critique = await runStep(session, critic, 'ops-critique', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (보수적 관점으로 리스크를 촘촘히 점검)' : '우선순위: 균형',
      '역할: 검증 에이전트',
      `목표: ${session.goal}`,
      `실행안: ${executionDraft}`,
      '출력: 사실성 위험, 과잉자동화 위험, 개인정보/운영 리스크를 점검하고 보완안을 제시',
    ].join('\n'), executionDraft);

    ensureSessionBudget(sessionStartedAtMs);
    const finalResult = await runStep(session, researcher, 'ops-execution', () => [
      '요구사항: 중간 과정/역할별 산출물 노출 금지',
      `목표: ${session.goal}`,
      `계획 참고: ${plan}`,
      `검증 참고: ${critique}`,
      `초안 참고: ${executionDraft}`,
      '출력: 사용자에게 전달할 최종 결과물만 간결하게 작성',
    ].join('\n'), critique);

    markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: formatCitationFirstResult(finalResult, session),
      error: null,
    });
    return session.cancelRequested ? 'cancelled' : 'completed';
  } catch (error) {
    if (session.cancelRequested || getErrorMessage(error) === 'SESSION_CANCELLED') {
      markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
      return 'cancelled';
    }

    if (getErrorMessage(error) === 'SESSION_TIMEOUT') {
      markSessionTerminal(session, 'failed', { error: '처리 시간이 길어져 세션을 종료했습니다. 요청 범위를 줄여 다시 시도해주세요.' });
      return 'failed';
    }

    if (getErrorMessage(error).startsWith('STEP_TIMEOUT:')) {
      const role = getErrorMessage(error).split(':')[1] || 'unknown';
      markSessionTerminal(session, 'failed', { error: `단계 처리 시간이 초과되었습니다(${role}). 잠시 후 다시 시도해주세요.` });
      return 'failed';
    }

    markSessionTerminal(session, 'failed', { error: getErrorMessage(error) });
    return 'failed';
  }
};

const enqueueSession = (sessionId: string) => {
  if (!pendingSessionQueue.includes(sessionId)) {
    pendingSessionQueue.push(sessionId);
  }
};

const removeFromQueue = (sessionId: string) => {
  const index = pendingSessionQueue.indexOf(sessionId);
  if (index >= 0) {
    pendingSessionQueue.splice(index, 1);
  }
};

const pushDeadletter = (session: AgentSession, reason: string) => {
  deadletters.unshift({
    sessionId: session.id,
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    goal: session.goal,
    reason,
    failedAt: nowIso(),
  });
  if (deadletters.length > AGENT_DEADLETTER_MAX) {
    deadletters.length = AGENT_DEADLETTER_MAX;
  }
};

const requeueForRetry = (session: AgentSession) => {
  session.status = 'queued';
  session.startedAt = null;
  session.endedAt = null;
  session.result = null;
  session.cancelRequested = false;
  session.steps = buildInitialSteps(session.guildId, session.requestedSkillId, session.priority, nowIso());
  touch(session);
  void persistAgentSession(cloneSession(session));
  enqueueSession(session.id);
};

const scheduleQueueDrain = () => {
  if (queueDrainTimer) {
    return;
  }

  queueDrainTimer = setTimeout(() => {
    queueDrainTimer = null;
    const maxConcurrent = Math.max(1, getAgentPolicySnapshot().maxConcurrentSessions);
    while (runningSessionIds.size < maxConcurrent && pendingSessionQueue.length > 0) {
      const sessionId = pendingSessionQueue.shift() as string;
      const session = sessions.get(sessionId);
      if (!session) {
        continue;
      }

      if (session.cancelRequested || session.status === 'cancelled') {
        markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
        continue;
      }

      runningSessionIds.add(sessionId);
      const attempts = (sessionAttempts.get(sessionId) || 0) + 1;
      sessionAttempts.set(sessionId, attempts);

      void executeSession(sessionId)
        .then((status) => {
          const latest = sessions.get(sessionId);
          if (!latest) {
            return;
          }

          if (status === 'failed') {
            if (attempts < AGENT_SESSION_MAX_ATTEMPTS) {
              requeueForRetry(latest);
              return;
            }

            pushDeadletter(latest, latest.error || 'FAILED');
          }
        })
        .finally(() => {
          runningSessionIds.delete(sessionId);
          scheduleQueueDrain();
        });
    }
  }, AGENT_QUEUE_POLL_MS);
};

const pruneSessions = () => {
  if (sessions.size <= MAX_SESSION_HISTORY) {
    return;
  }

  const ordered = [...sessions.values()]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  const removeCount = sessions.size - MAX_SESSION_HISTORY;
  for (let i = 0; i < removeCount; i += 1) {
    sessions.delete(ordered[i].id);
  }
};

export const startAgentSession = (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  skillId?: string | null;
  priority?: string | null;
  isAdmin?: boolean;
}) => {
  if (!isAnyLlmConfigured()) {
    throw new Error('LLM provider is not configured. Configure OPENAI/GEMINI/ANTHROPIC/OPENCLAW/OLLAMA provider.');
  }

  const requestedSkillId = params.skillId && isSkillId(params.skillId)
    ? params.skillId
    : null;
  const priority = toPriority(params.priority);
  primeAgentPolicyCache();
  primeWorkflowProfileCache();

  if (pendingSessionQueue.length >= AGENT_MAX_QUEUE_SIZE) {
    throw new Error(`대기열이 가득 찼습니다. 잠시 후 다시 시도해주세요. (max=${AGENT_MAX_QUEUE_SIZE})`);
  }

  const policy = validateAgentSessionRequest({
    guildId: params.guildId,
    runningSessions: runningSessionIds.size,
    goal: params.goal,
    requestedSkillId,
    isAdmin: params.isAdmin === true,
  });

  if (!policy.ok) {
    throw new Error(policy.message);
  }

  const sessionId = crypto.randomUUID();
  const timestamp = nowIso();
  const session: AgentSession = {
    id: sessionId,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal.trim(),
    priority,
    requestedSkillId,
    routedIntent: 'task',
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    cancelRequested: false,
    memoryHints: [],
    steps: buildInitialSteps(params.guildId, requestedSkillId, priority, timestamp),
  };

  sessions.set(session.id, session);
  pruneSessions();
  void persistAgentSession(cloneSession(session));
  enqueueSession(session.id);
  scheduleQueueDrain();
  return cloneSession(session);
};

export const cancelAgentSession = (sessionId: string): { ok: boolean; message: string } => {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '세션을 찾을 수 없습니다.' };
  }

  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return { ok: false, message: `이미 종료된 세션입니다: ${session.status}` };
  }

  session.cancelRequested = true;
  if (session.status === 'queued') {
    removeFromQueue(sessionId);
    markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
    return { ok: true, message: '대기열에서 중지했습니다.' };
  }

  touch(session);
  return { ok: true, message: '중지 요청을 수락했습니다.' };
};

export const getAgentSession = (sessionId: string): AgentSession | null => {
  const session = sessions.get(sessionId);
  return session ? cloneSession(session) : null;
};

export const listGuildAgentSessions = (guildId: string, limit = 10): AgentSession[] => {
  const size = Math.max(1, Math.min(50, Math.trunc(limit)));
  return [...sessions.values()]
    .filter((session) => session.guildId === guildId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, size)
    .map((session) => cloneSession(session));
};

export const listAgentDeadletters = (params?: { guildId?: string; limit?: number }) => {
  const limit = Math.max(1, Math.min(200, Math.trunc(params?.limit ?? 30)));
  const guildId = String(params?.guildId || '').trim();
  return deadletters
    .filter((row) => (!guildId || row.guildId === guildId))
    .slice(0, limit)
    .map((row) => ({ ...row }));
};

export const getMultiAgentRuntimeSnapshot = (): AgentRuntimeSnapshot => {
  const all = [...sessions.values()];
  const latest = all
    .map((session) => session.updatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    totalSessions: all.length,
    runningSessions: runningSessionIds.size,
    queuedSessions: pendingSessionQueue.length,
    completedSessions: all.filter((session) => session.status === 'completed').length,
    failedSessions: all.filter((session) => session.status === 'failed').length,
    cancelledSessions: all.filter((session) => session.status === 'cancelled').length,
    deadletteredSessions: deadletters.length,
    latestSessionAt: latest,
  };
};

export const listAgentSkills = () => listSkills();

export const getAgentPolicy = () => getAgentPolicySnapshot();

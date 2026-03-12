import crypto from 'crypto';
import { buildAgentMemoryHints } from './agentMemoryService';
import { getAgentPolicySnapshot, validateAgentSessionRequest } from './agentPolicyService';
import { persistAgentSession } from './agentSessionStore';
import { generateText, isAnyLlmConfigured } from './llmClient';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillId } from './skills/types';

export type AgentRole = 'planner' | 'researcher' | 'critic';
export type AgentPriority = 'fast' | 'balanced' | 'precise';
export type AgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentIntent = 'task' | 'casual_chat';

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
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  latestSessionAt: string | null;
};

const MAX_SESSION_HISTORY = Math.max(50, Number(process.env.AGENT_MAX_SESSION_HISTORY || 300));
const sessions = new Map<string, AgentSession>();

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

const TASK_HINT_PATTERN = /(찾아|검색|분석|요약|정리|작성|만들|계획|검토|실행|보여|조회|생성|추천|계산|설계|요청|해줘|해 줘|please|search|find|analyze|summarize|build|create|plan|review|check)/i;
const EXPLICIT_TASK_PATTERN = /(찾아줘|검색해줘|분석해줘|요약해줘|정리해줘|작성해줘|만들어줘|계획해줘|검토해줘|조회해줘|search for|find me|analyze this|summarize this)/i;
const CASUAL_HINT_PATTERN = /(우울|슬퍼|힘들|불안|외로|짜증|피곤|배고|졸려|심심|기분|오늘|방금|아까|그냥|ㅋㅋ|ㅎㅎ|하하|lol|lmao|thanks|고마워|고맙|안녕|반가)/i;

const classifyIntentHeuristically = (goal: string): AgentIntent | null => {
  const text = String(goal || '').trim();
  if (!text) {
    return 'task';
  }

  if (CASUAL_HINT_PATTERN.test(text) && text.length <= 180 && !EXPLICIT_TASK_PATTERN.test(text)) {
    return 'casual_chat';
  }

  if (TASK_HINT_PATTERN.test(text)) {
    return 'task';
  }

  if (CASUAL_HINT_PATTERN.test(text) && text.length <= 140) {
    return 'casual_chat';
  }

  if (text.length <= 24 && /[?？]$/.test(text)) {
    return 'casual_chat';
  }

  return null;
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
  } catch {
    return null;
  }

  return null;
};

const classifyIntent = async (goal: string, requestedSkillId: SkillId | null): Promise<AgentIntent> => {
  if (requestedSkillId) {
    return 'task';
  }

  const heuristic = classifyIntentHeuristically(goal);
  if (heuristic) {
    return heuristic;
  }

  try {
    const raw = await generateText({
      system: [
        '너는 라우팅 분류기다.',
        '입력을 보고 intent를 task 또는 casual_chat 중 하나로만 분류한다.',
        '감정 호소/짧은 일상 발화는 task 신호가 일부 보여도 casual_chat을 우선한다.',
        '명시적 작업 동사(찾아줘, 검색해줘, 분석해줘, 요약해줘 등)가 있을 때만 task로 분류한다.',
        '출력은 반드시 JSON 한 줄만 사용한다.',
      ].join('\n'),
      user: [
        '다음 문장을 분류하세요.',
        '기준:',
        '- task: 정보 검색/분석/실행 등 명확한 작업 요청',
        '- casual_chat: 감정 표현, 안부, 잡담, 짧은 반응',
        '- 감정 표현이 핵심이면 과거 DB/메모리 조회보다 공감형 핑퐁을 우선한다',
        '출력 형식: {"intent":"task|casual_chat"}',
        `문장: ${String(goal || '').trim()}`,
      ].join('\n'),
      temperature: 0,
      maxTokens: 80,
    });

    return parseIntentFromLlm(raw) || 'task';
  } catch {
    return 'task';
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
    const result = await executeSkill(skillId, {
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      goal: buildInput(priorOutput),
      memoryHints: session.memoryHints,
      priorOutput,
    });

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

const executeSession = async (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  session.status = 'running';
  session.startedAt = nowIso();
  touch(session);
  void persistAgentSession(cloneSession(session));

  try {
    session.routedIntent = await classifyIntent(session.goal, session.requestedSkillId);
    touch(session);

    if (session.routedIntent === 'casual_chat') {
      const timestamp = nowIso();
      cancelAllPendingSteps(session, timestamp);
      const casualReply = await generateCasualChatResult(session.goal);
      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: casualReply,
        error: null,
      });
      return;
    }

    session.memoryHints = await buildAgentMemoryHints({
      guildId: session.guildId,
      goal: session.goal,
      maxItems: session.priority === 'fast' ? 4 : session.priority === 'precise' ? 16 : 10,
    });
    touch(session);

    if (session.requestedSkillId) {
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
      return;
    }

    const planner = session.steps[0];
    const researcher = session.steps[1];
    const critic = session.steps[2];

    if (session.priority === 'fast') {
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
      return;
    }

    const plan = await runStep(session, planner, 'ops-plan', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (검증과 리스크 완화를 강화)' : '우선순위: 균형',
      '역할: 계획 수립 에이전트',
      `목표: ${session.goal}`,
      '출력: 1) 실행 단계 2) 필요한 근거 3) 실패시 대안 을 간결한 한국어 문단으로 작성',
      '규칙: 추측과 단정 금지, 실제 실행 가능한 단계 중심',
    ].join('\n'), undefined);

    const executionDraft = await runStep(session, researcher, 'ops-execution', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
      '역할: 실행/리서치 에이전트',
      `목표: ${session.goal}`,
      `계획안: ${plan}`,
      '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
    ].join('\n'), plan);

    const critique = await runStep(session, critic, 'ops-critique', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (보수적 관점으로 리스크를 촘촘히 점검)' : '우선순위: 균형',
      '역할: 검증 에이전트',
      `목표: ${session.goal}`,
      `실행안: ${executionDraft}`,
      '출력: 사실성 위험, 과잉자동화 위험, 개인정보/운영 리스크를 점검하고 보완안을 제시',
    ].join('\n'), executionDraft);

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
  } catch (error) {
    if (session.cancelRequested || getErrorMessage(error) === 'SESSION_CANCELLED') {
      markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
      return;
    }

    markSessionTerminal(session, 'failed', { error: getErrorMessage(error) });
  }
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
}) => {
  if (!isAnyLlmConfigured()) {
    throw new Error('LLM provider is not configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }

  const requestedSkillId = params.skillId && isSkillId(params.skillId)
    ? params.skillId
    : null;
  const priority = toPriority(params.priority);

  const runningSessions = [...sessions.values()].filter((session) =>
    session.status === 'queued' || session.status === 'running').length;

  const policy = validateAgentSessionRequest({
    runningSessions,
    goal: params.goal,
    requestedSkillId,
    isAdmin: true,
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
    steps: [
      {
        id: crypto.randomUUID(),
        role: 'planner',
        title: requestedSkillId ? `스킬 실행: ${requestedSkillId}` : '목표 실행 계획 수립',
        status: priority === 'fast' && !requestedSkillId ? 'cancelled' : 'pending',
        startedAt: null,
        endedAt: priority === 'fast' && !requestedSkillId ? timestamp : null,
        output: null,
        error: null,
      },
      {
        id: crypto.randomUUID(),
        role: 'researcher',
        title: '실행안/근거 초안 작성',
        status: requestedSkillId ? 'cancelled' : 'pending',
        startedAt: null,
        endedAt: requestedSkillId ? timestamp : null,
        output: null,
        error: null,
      },
      {
        id: crypto.randomUUID(),
        role: 'critic',
        title: '리스크 검토 및 보완',
        status: requestedSkillId || priority === 'fast' ? 'cancelled' : 'pending',
        startedAt: null,
        endedAt: requestedSkillId || priority === 'fast' ? timestamp : null,
        output: null,
        error: null,
      },
    ],
  };

  sessions.set(session.id, session);
  pruneSessions();
  void persistAgentSession(cloneSession(session));
  void executeSession(session.id);
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

export const getMultiAgentRuntimeSnapshot = (): AgentRuntimeSnapshot => {
  const all = [...sessions.values()];
  const latest = all
    .map((session) => session.updatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    totalSessions: all.length,
    runningSessions: all.filter((session) => session.status === 'queued' || session.status === 'running').length,
    completedSessions: all.filter((session) => session.status === 'completed').length,
    failedSessions: all.filter((session) => session.status === 'failed').length,
    cancelledSessions: all.filter((session) => session.status === 'cancelled').length,
    latestSessionAt: latest,
  };
};

export const listAgentSkills = () => listSkills();

export const getAgentPolicy = () => getAgentPolicySnapshot();

import crypto from 'crypto';
import type { AgentPriority } from '../../agentRuntimeTypes';

type SessionFormattingView = {
  goal: string;
  memoryHints: string[];
  priority: AgentPriority;
};

const SECTION_LABEL_ONLY_PATTERN = /^(?:#+\s*)?(?:deliverable|verification|confidence)\s*:?$/i;
const DEBUG_LINE_PATTERN = /^(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/;

export const extractMemoryCitations = (memoryHints: string[]): string[] => {
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

export const toConfidenceLabel = (priority: AgentPriority, citationCount: number): string => {
  if (citationCount >= 2 && priority === 'precise') {
    return 'high';
  }
  if (citationCount >= 1) {
    return 'medium';
  }
  return 'low';
};

export const sanitizeDeliverableText = (raw: string): string => {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !SECTION_LABEL_ONLY_PATTERN.test(line))
    .filter((line) => !DEBUG_LINE_PATTERN.test(line))
    .map((line) => line.replace(/^#+\s*(deliverable|verification|confidence)\s*:?\s*/i, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

export const toConclusion = (raw: string): string => {
  const compact = sanitizeDeliverableText(raw);
  if (!compact) {
    return '현재 시점에서 확정할 수 있는 결론을 생성하지 못했습니다.';
  }
  return compact.slice(0, 280);
};

const shortHash = (value: string): string => {
  const digest = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  return digest.slice(0, 16);
};

export const hasDebugLeak = (value: string): boolean => {
  const text = String(value || '');
  return /(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/.test(text);
};

export const hasBrokenTextPattern = (value: string): boolean => {
  const text = String(value || '');
  if (text.includes('�')) {
    return true;
  }
  return /\b[a-f0-9]{40,}\b/i.test(text);
};

export const buildEvidenceBundleId = (taskGoal: string, citations: string[]): string => {
  const normalizedGoal = String(taskGoal || '').trim().toLowerCase();
  const normalizedCitations = [...citations].map((id) => String(id || '').trim().toLowerCase()).sort();
  return shortHash(`${normalizedGoal}|${normalizedCitations.join('|')}`);
};

const toTokenSet = (value: string): Set<string> => {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return new Set(tokens);
};

const jaccardSimilarity = (a: string, b: string): number => {
  const setA = toTokenSet(a);
  const setB = toTokenSet(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
};

export const selectConsensusText = (candidates: string[]): string => {
  const normalized = candidates
    .map((candidate) => sanitizeDeliverableText(candidate))
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (normalized.length <= 1) {
    return normalized[0] || candidates[0] || '';
  }

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < normalized.length; i += 1) {
    let score = 0;
    for (let j = 0; j < normalized.length; j += 1) {
      if (i === j) continue;
      score += jaccardSimilarity(normalized[i], normalized[j]);
    }
    score = score / Math.max(1, normalized.length - 1);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return normalized[bestIndex];
};

export const formatCitationFirstResult = (rawResult: string, session: SessionFormattingView): string => {
  const citations = extractMemoryCitations(session.memoryHints);
  const confidence = toConfidenceLabel(session.priority, citations.length);
  const conclusion = toConclusion(rawResult);
  const evidenceBundleId = buildEvidenceBundleId(session.goal, citations);
  const routeMatch = String(session.goal || '').match(/\[ROUTE:(knowledge|execution|mixed|casual)\]/i);
  const route = String(routeMatch?.[1] || 'mixed').toLowerCase();
  const whyPath = route === 'knowledge'
    ? '근거 기반 회수 우선 경로를 선택했습니다.'
    : route === 'execution'
      ? '실행 가능한 단계/검증 중심 경로를 선택했습니다.'
      : route === 'casual'
        ? '대화 맥락 보존 중심 경로를 선택했습니다.'
        : '근거 요약 후 실행안을 제시하는 혼합 경로를 선택했습니다.';

  const alternatives = route === 'knowledge'
    ? ['execution: 근거보다 실행 지시가 앞서는 위험', 'casual: 작업형 요청을 대화형으로 축소할 위험']
    : route === 'execution'
      ? ['knowledge: 즉시 실행성 저하 가능성', 'casual: 작업 누락 위험']
      : route === 'casual'
        ? ['execution: 과도한 자동실행 위험', 'knowledge: 감정/대화 맥락 손실 위험']
        : ['knowledge-only: 실행안 부재 위험', 'execution-only: 근거 누락 위험'];

  const explanationEnvelope = {
    version: 1,
    route,
    evidenceBundleId,
    citationCount: citations.length,
    whyPath,
    alternatives,
  };

  const citationText = citations.length > 0
    ? citations.map((id) => `- memory:${id}`).join('\n')
    : '- 근거 부족: memory 힌트에서 직접 인용 가능한 항목을 찾지 못했습니다.';

  return [
    '## Deliverable',
    conclusion,
    '',
    '## Verification',
    `- evidence_bundle_id: ${evidenceBundleId}`,
    citationText,
    '',
    '## Why This Path',
    `- ${whyPath}`,
    ...alternatives.map((item) => `- rejected: ${item}`),
    '',
    '## ExplanationEnvelope',
    JSON.stringify(explanationEnvelope),
    '',
    `## Confidence: ${confidence}`,
  ].join('\n');
};

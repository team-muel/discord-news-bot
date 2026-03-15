import type { SkillDefinition, SkillId } from './types';
import { parseIntegerEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';

const SKILL_CATALOG_CACHE_TTL_MS = Math.max(5_000, parseIntegerEnv(process.env.AGENT_SKILL_CATALOG_CACHE_TTL_MS, 60_000));
const SKILL_CATALOG_CACHE_ERROR_LOG_THROTTLE_MS = Math.max(30_000, parseIntegerEnv(process.env.AGENT_SKILL_CATALOG_CACHE_ERROR_LOG_THROTTLE_MS, 5 * 60_000));
const SUPPORTED_EXECUTOR_KEYS = new Set([
  'casual_chat',
  'ops-plan',
  'ops-execution',
  'ops-critique',
  'guild-onboarding-blueprint',
  'incident-review',
  'webhook',
]);

const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    id: 'casual_chat',
    executorKey: 'casual_chat',
    title: '일상 대화 응답',
    description: '감정 표현/잡담 입력을 공감형 자연어로 응답합니다.',
    inputGuide: '감정 표현, 안부, 짧은 일상 발화',
    outputGuide: '도구 없이 공감 + 필요 시 1개 되묻기',
    systemPrompt: [
      '너는 공감형 한국어 대화 파트너다.',
      '작업 실행/검색 도구 호출 없이 자연스럽게 반응한다.',
      '감정/짧은 일상 발화는 장기기억 조회보다 현재 공감과 가벼운 질문을 우선한다.',
    ].join(' '),
    temperature: 0.5,
    maxTokens: 220,
  },
  {
    id: 'ops-plan',
    executorKey: 'ops-plan',
    title: '운영 계획 수립',
    description: '목표를 실행 가능한 단계로 분해하고 우선순위를 제안합니다.',
    inputGuide: '운영 목표, 제한사항, 기간, 성공조건',
    outputGuide: '단계별 실행계획 + 실패시 대안 + 우선순위',
    systemPrompt: [
      '너는 디스코드 서버 운영 자동화 계획가다.',
      '한국어로 간결하고 실행 가능한 계획만 제시한다.',
      '추측이나 단정은 피하고, 관측 가능한 사실 중심으로 작성한다.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 900,
  },
  {
    id: 'ops-execution',
    executorKey: 'ops-execution',
    title: '운영 실행안 생성',
    description: '계획을 실제 운영자가 사용할 수 있는 체크리스트로 변환합니다.',
    inputGuide: '목표 + 계획안 + 리소스 제약',
    outputGuide: '즉시 실행 체크리스트 + 자동화 포인트 + 관찰 지표',
    systemPrompt: [
      '너는 서버 운영 실행 담당 에이전트다.',
      '운영자가 바로 실행할 수 있는 단계와 확인 포인트를 제공한다.',
      '모호한 조언보다 명확한 액션 아이템을 우선한다.',
    ].join(' '),
    temperature: 0.25,
    maxTokens: 1000,
  },
  {
    id: 'ops-critique',
    executorKey: 'ops-critique',
    title: '운영 리스크 검토',
    description: '실행안의 리스크와 보완책을 검토합니다.',
    inputGuide: '목표 + 실행안',
    outputGuide: '리스크 목록 + 완화안 + 즉시 적용 가드레일',
    systemPrompt: [
      '너는 운영 품질/보안 검토 에이전트다.',
      '개인정보, 권한, 비용, 운영중단 위험을 우선 검토한다.',
      '위험 지적만 하지 말고 실행 가능한 보완안까지 제공한다.',
    ].join(' '),
    temperature: 0.1,
    maxTokens: 800,
  },
  {
    id: 'guild-onboarding-blueprint',
    executorKey: 'guild-onboarding-blueprint',
    title: '길드 온보딩 설계',
    description: '서버 초대 후 온보딩 절차와 동의 기반 학습 플로우를 설계합니다.',
    inputGuide: '서버 성격, 권한 정책, 수집 범위',
    outputGuide: '온보딩 상태머신 + 동의 UX + 초기 데이터 수집 전략',
    systemPrompt: [
      '너는 디스코드 길드 온보딩 아키텍트다.',
      'opt-in, 데이터 최소수집, 관리자 제어권을 기본 원칙으로 둔다.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 1200,
  },
  {
    id: 'incident-review',
    executorKey: 'incident-review',
    adminOnly: true,
    title: '장애/오답 회고',
    description: '장애나 오답 사례를 회고하고 재발 방지 규칙을 도출합니다.',
    inputGuide: '사건 요약, 영향, 현재 대응',
    outputGuide: '원인 가설 + 검증 절차 + 재발 방지 체크리스트',
    systemPrompt: [
      '너는 운영 회고 에이전트다.',
      '비난이 아닌 사실 기반 원인 분석과 재발 방지에 집중한다.',
    ].join(' '),
    temperature: 0.15,
    maxTokens: 900,
  },
  {
    id: 'webhook',
    executorKey: 'webhook',
    title: '웹훅 설계/운영',
    description: '웹훅 이벤트 계약, 검증, 재시도, 운영 가드레일까지 포함한 실행안을 생성합니다.',
    inputGuide: '이벤트 종류, 공급자, 인증 방식, 처리 목표, 실패 정책',
    outputGuide: '엔드포인트 계약 + 검증/보안 + 재시도/멱등성 + 운영 체크리스트',
    systemPrompt: [
      '너는 웹훅 통합 아키텍트다.',
      '이벤트 계약과 보안 검증(HMAC/서명), 멱등성 키, 재시도 전략을 필수로 포함한다.',
      '실제 운영자가 바로 적용 가능한 단계와 예시를 한국어로 제공한다.',
    ].join(' '),
    temperature: 0.2,
    maxTokens: 1200,
  },
];

let dynamicSkills = new Map<SkillId, SkillDefinition>();
let catalogLoadedAt = 0;
let catalogLoading: Promise<void> | null = null;
let lastSkillCatalogErrorLogAt = 0;

const cloneSkill = (skill: SkillDefinition): SkillDefinition => ({ ...skill });

const getMergedSkillMap = (): Map<SkillId, SkillDefinition> => {
  const map = new Map<SkillId, SkillDefinition>(BUILTIN_SKILLS.map((skill) => [skill.id, cloneSkill(skill)]));
  for (const [id, skill] of dynamicSkills.entries()) {
    map.set(id, cloneSkill(skill));
  }
  return map;
};

const isCatalogFresh = () => Date.now() - catalogLoadedAt < SKILL_CATALOG_CACHE_TTL_MS;

const toBoundedNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return n;
};

export const refreshSkillCatalogCache = async (): Promise<void> => {
  if (!isSupabaseConfigured()) {
    dynamicSkills = new Map();
    catalogLoadedAt = Date.now();
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_skill_catalog')
    .select('guild_id, skill_id, title, description, input_guide, output_guide, system_prompt, executor_key, admin_only, enabled, temperature, max_tokens')
    .eq('enabled', true)
    .or('guild_id.eq.*,guild_id.is.null')
    .limit(1000);

  if (error) {
    return;
  }

  const next = new Map<SkillId, SkillDefinition>();
  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const skillId = String(row.skill_id || '').trim();
    if (!skillId) {
      continue;
    }

    const title = String(row.title || '').trim() || skillId;
    const description = String(row.description || '').trim() || '동적 스킬';
    const inputGuide = String(row.input_guide || '').trim() || '입력값';
    const outputGuide = String(row.output_guide || '').trim() || '출력값';
    const systemPrompt = String(row.system_prompt || '').trim() || '도구형 스킬 실행';
    const executorKey = String(row.executor_key || '').trim() || skillId;
    if (!SUPPORTED_EXECUTOR_KEYS.has(executorKey)) {
      logger.warn('[SKILL-REGISTRY] skip skill_id=%s unsupported executor_key=%s', skillId, executorKey || '(empty)');
      continue;
    }

    next.set(skillId, {
      id: skillId,
      title,
      description,
      inputGuide,
      outputGuide,
      systemPrompt,
      executorKey,
      adminOnly: Boolean(row.admin_only),
      enabled: row.enabled !== false,
      temperature: toBoundedNumber(row.temperature, 0.2),
      maxTokens: Math.max(64, Math.trunc(toBoundedNumber(row.max_tokens, 700))),
    });
  }

  dynamicSkills = next;
  catalogLoadedAt = Date.now();
};

export const primeSkillCatalogCache = (): void => {
  if (catalogLoading || isCatalogFresh()) {
    return;
  }

  catalogLoading = refreshSkillCatalogCache()
    .catch((error) => {
      const nowMs = Date.now();
      if (nowMs - lastSkillCatalogErrorLogAt >= SKILL_CATALOG_CACHE_ERROR_LOG_THROTTLE_MS) {
        lastSkillCatalogErrorLogAt = nowMs;
        logger.warn('[SKILL-REGISTRY] catalog refresh failed (throttled): %s', error instanceof Error ? error.message : String(error));
      }
    })
    .finally(() => {
      catalogLoading = null;
    });
};

export const listSkills = (): SkillDefinition[] => {
  primeSkillCatalogCache();
  return [...getMergedSkillMap().values()].map((skill) => cloneSkill(skill));
};

export const getSkill = (skillId: SkillId): SkillDefinition => {
  primeSkillCatalogCache();
  const skill = getMergedSkillMap().get(skillId);
  if (!skill) {
    throw new Error(`UNKNOWN_SKILL: ${skillId}`);
  }
  return cloneSkill(skill);
};

export const isSkillId = (value: string): value is SkillId => {
  primeSkillCatalogCache();
  return getMergedSkillMap().has(String(value || '').trim());
};

export const getSkillExecutorKey = (skillId: SkillId): string => {
  const skill = getSkill(skillId);
  return String(skill.executorKey || skill.id || '').trim();
};

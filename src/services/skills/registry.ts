import type { SkillDefinition, SkillId } from './types';

const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    id: 'ops-plan',
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

const SKILL_MAP = new Map<SkillId, SkillDefinition>(BUILTIN_SKILLS.map((skill) => [skill.id, skill]));

export const listSkills = (): SkillDefinition[] => BUILTIN_SKILLS.map((skill) => ({ ...skill }));

export const getSkill = (skillId: SkillId): SkillDefinition => {
  const skill = SKILL_MAP.get(skillId);
  if (!skill) {
    throw new Error(`UNKNOWN_SKILL: ${skillId}`);
  }
  return { ...skill };
};

export const isSkillId = (value: string): value is SkillId => SKILL_MAP.has(value as SkillId);

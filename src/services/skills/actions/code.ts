import { generateText } from '../../llmClient';
import type { ActionDefinition } from './types';
import { stripGoalNoise } from './queryUtils';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

type CodingTaskType = 'feature' | 'bugfix' | 'refactor' | 'test' | 'integration' | 'unknown';

type StructuredCodingContext = {
  objective: string;
  taskType: CodingTaskType;
  languages: string[];
  stacks: string[];
  constraints: string[];
  deliverables: string[];
  workflow: string[];
};

type ContextSevenPack = {
  basicInstructions: string[];
  currentQuestion: string;
  conversationHistory: string[];
  longTermMemory: string[];
  externalResources: string[];
  availableTools: string[];
  responseFormat: string[];
  contextWarnings: string[];
};

type ContextEngineeringBundle = {
  savedMemo: string;
  summarizedHistory: string[];
  selectedLongTermMemory: string[];
  selectedExternalResources: string[];
  selectedTools: string[];
  workPackages: string[];
  splitMode: 'single' | 'multi';
  splitHint: string;
};

type UserBackgroundBrief = {
  scenario: string;
  role: string;
  purpose: string;
};

const TASK_TYPE_RULES: Array<{ type: CodingTaskType; pattern: RegExp }> = [
  { type: 'bugfix', pattern: /(버그|오류|에러|고장|고쳐|수정|fix|bug|깨짐)/i },
  { type: 'refactor', pattern: /(리팩터|리팩토링|정리|구조개선|refactor|clean up)/i },
  { type: 'test', pattern: /(테스트|test|검증|단위테스트|integration test|e2e)/i },
  { type: 'integration', pattern: /(연동|통합|mcp|api|webhook|sdk|integration)/i },
  { type: 'feature', pattern: /(구현|추가|만들|생성|개발|build|create|implement)/i },
];

const LANGUAGE_HINTS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'TypeScript', pattern: /(typescript|\.ts\b|\.tsx\b|타입스크립트)/i },
  { label: 'JavaScript', pattern: /(javascript|\.js\b|\.jsx\b|자바스크립트)/i },
  { label: 'Python', pattern: /(python|\.py\b|파이썬)/i },
  { label: 'SQL', pattern: /(sql|postgres|mysql|query|쿼리)/i },
  { label: 'Shell', pattern: /(bash|shell|script|스크립트|powershell)/i },
];

const STACK_HINTS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Node.js', pattern: /(node|node\.js|npm|pnpm|yarn)/i },
  { label: 'Discord.js', pattern: /(discord\.js|discord bot|슬래시 명령|discord)/i },
  { label: 'Express', pattern: /(express|api 서버|router|route)/i },
  { label: 'Supabase', pattern: /(supabase|postgres|db)/i },
  { label: 'MCP Worker', pattern: /(mcp|worker|tool call|delegation)/i },
];

const CONSTRAINT_HINTS: Array<{ label: string; pattern: RegExp }> = [
  { label: '기존 API/동작 호환성 유지', pattern: /(호환|기존 동작 유지|breaking change 금지|회귀 금지)/i },
  { label: '성능 영향 최소화', pattern: /(성능|빠르게|latency|throughput|최적화)/i },
  { label: '보안/권한 검증 포함', pattern: /(보안|권한|인증|인가|security)/i },
  { label: '테스트 가능 구조 우선', pattern: /(테스트|검증|mock|unit|e2e)/i },
  { label: '가독성/유지보수성 우선', pattern: /(가독성|유지보수|클린코드|리팩터)/i },
];

const CONTEXT_INJECTION_PATTERN = /(ignore\s+previous|system\s+prompt|developer\s+message|jailbreak|override\s+instruction|규칙\s*무시|지침\s*무시|권한\s*상승)/i;

const normalizeContextLine = (value: unknown, maxLen = 260): string => {
  const stripped = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, maxLen);
};

const normalizeContextList = (value: unknown, maxItems = 8, maxLen = 260): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];
  for (const row of value) {
    const normalized = normalizeContextLine(row, maxLen);
    if (!normalized) {
      continue;
    }
    if (!out.includes(normalized)) {
      out.push(normalized);
    }
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
};

const extractKeywords = (goal: string): string[] => {
  const tokens = String(goal || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const deduped: string[] = [];
  for (const token of tokens) {
    if (!deduped.includes(token)) {
      deduped.push(token);
    }
    if (deduped.length >= 16) {
      break;
    }
  }
  return deduped;
};

const scoreRelevance = (line: string, keywords: string[]): number => {
  const lower = line.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      score += Math.min(3, keyword.length >= 5 ? 2 : 1);
    }
  }
  return score;
};

const selectRelevantLines = (lines: string[], goal: string, maxItems: number): string[] => {
  if (lines.length <= maxItems) {
    return lines;
  }

  const keywords = extractKeywords(goal);
  return lines
    .map((line, index) => ({ line, index, score: scoreRelevance(line, keywords) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, maxItems)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.line);
};

const summarizeConversationHistory = (history: string[]): string[] => {
  if (history.length <= 6) {
    return history;
  }

  const head = history.slice(0, 2);
  const tail = history.slice(-2);
  const middle = history.slice(2, -2);
  const keywords = middle
    .flatMap((line) => extractKeywords(line).slice(0, 4))
    .filter((token, index, arr) => arr.indexOf(token) === index)
    .slice(0, 6);

  return [
    ...head,
    `중간 대화 요약: ${keywords.length > 0 ? keywords.join(', ') : '핵심 맥락 유지'}`,
    ...tail,
  ];
};

const inferSplitMode = (goal: string): { splitMode: 'single' | 'multi'; splitHint: string } => {
  const lower = String(goal || '').toLowerCase();
  const hasResearchIntent = /(조사|리서치|찾아|검색|research|search|investigate)/i.test(lower);
  const hasWritingIntent = /(문서|글쓰기|정리문|보고서|write|draft|요약문)/i.test(lower);
  const hasCodingIntent = /(코드|구현|개발|refactor|fix|test|api)/i.test(lower);

  if ((hasResearchIntent && hasWritingIntent) || (hasResearchIntent && hasCodingIntent) || (hasWritingIntent && hasCodingIntent)) {
    return {
      splitMode: 'multi',
      splitHint: '복합 요청 감지: 조사/작성/구현을 분리하고 이번 응답은 구현 산출물 중심으로 제한합니다.',
    };
  }

  return {
    splitMode: 'single',
    splitHint: '단일 작업 흐름으로 처리합니다.',
  };
};

const buildWorkPackages = (goal: string, taskType: CodingTaskType): string[] => {
  const normalized = String(goal || '').replace(/[\r\n]+/g, ' ').trim();
  const chunks = normalized
    .split(/(?:\s+그리고\s+|\s+후\s+|\s+then\s+|\s+및\s+|\s*->\s*|\s*\/\s*)/i)
    .map((line) => compact(line))
    .filter(Boolean);

  if (chunks.length > 1) {
    return chunks.slice(0, 4);
  }

  if (taskType === 'bugfix') return ['재현 조건 정리', '원인 지점 수정', '회귀 방지 검증'];
  if (taskType === 'test') return ['핵심 시나리오 식별', '테스트 코드 작성', '실행/검증 기준 정리'];
  if (taskType === 'integration') return ['인터페이스 계약 정의', '연동 구현', '예외/장애 경로 점검'];
  return ['요구사항 분석', '핵심 구현', '검증 및 정리'];
};

const buildSavedMemo = (params: {
  goal: string;
  taskType: CodingTaskType;
  selectedLongTermMemory: string[];
  selectedExternalResources: string[];
  selectedTools: string[];
  workPackages: string[];
  splitMode: 'single' | 'multi';
}): string => {
  return [
    `목표: ${compact(params.goal).slice(0, 180)}`,
    `작업유형: ${params.taskType}`,
    `분할모드: ${params.splitMode}`,
    `핵심자료: ${params.selectedExternalResources.slice(0, 2).join(' | ') || 'none'}`,
    `장기기억: ${params.selectedLongTermMemory.slice(0, 2).join(' | ') || 'none'}`,
    `도구: ${params.selectedTools.slice(0, 4).join(', ')}`,
    `작업분할: ${params.workPackages.join(' -> ')}`,
  ].join(' | ');
};

const applyContextEngineering = (params: {
  goal: string;
  taskType: CodingTaskType;
  history: string[];
  longTermMemory: string[];
  externalResources: string[];
  tools: string[];
}): ContextEngineeringBundle => {
  const summarizedHistory = summarizeConversationHistory(params.history);
  const selectedLongTermMemory = selectRelevantLines(params.longTermMemory, params.goal, 5);
  const selectedExternalResources = selectRelevantLines(params.externalResources, params.goal, 5);
  const selectedTools = selectRelevantLines(params.tools, params.goal, 7);
  const workPackages = buildWorkPackages(params.goal, params.taskType);
  const split = inferSplitMode(params.goal);

  const savedMemo = buildSavedMemo({
    goal: params.goal,
    taskType: params.taskType,
    selectedLongTermMemory,
    selectedExternalResources,
    selectedTools,
    workPackages,
    splitMode: split.splitMode,
  });

  return {
    savedMemo,
    summarizedHistory,
    selectedLongTermMemory,
    selectedExternalResources,
    selectedTools,
    workPackages,
    splitMode: split.splitMode,
    splitHint: split.splitHint,
  };
};

const sanitizeContextList = (lines: string[], warnings: string[]): string[] => {
  const safe: string[] = [];
  for (const line of lines) {
    if (CONTEXT_INJECTION_PATTERN.test(line)) {
      warnings.push(`suspicious_context_filtered: ${line.slice(0, 64)}`);
      continue;
    }
    safe.push(line);
  }
  return safe;
};

const detectContextConflicts = (responseFormat: string[], basicInstructions: string[]): string[] => {
  const conflicts: string[] = [];
  const joinedResponseFormat = responseFormat.join(' ').toLowerCase();
  const joinedBasic = basicInstructions.join(' ').toLowerCase();

  if (joinedResponseFormat.includes('json') && joinedResponseFormat.includes('file 블록')) {
    conflicts.push('response_format_conflict: json_only_vs_file_blocks');
  }
  if (joinedBasic.includes('설명 금지') && joinedResponseFormat.includes('설명')) {
    conflicts.push('instruction_conflict: no_explanation_vs_need_explanation');
  }

  return conflicts;
};

const buildContextSevenPack = (goal: string, args?: Record<string, unknown>): ContextSevenPack => {
  const warnings: string[] = [];
  const userBasicInstructions = normalizeContextList(args?.basicInstructions, 8, 180);
  const userConversationHistory = normalizeContextList(args?.conversationHistory, 12, 200);
  const userLongTermMemory = normalizeContextList(args?.longTermMemory, 8, 200);
  const userExternalResources = normalizeContextList(args?.externalResources, 8, 220);
  const userAvailableTools = normalizeContextList(args?.availableTools, 12, 120);
  const userResponseFormat = normalizeContextList(args?.responseFormat, 8, 180);

  const basicInstructions = sanitizeContextList(
    userBasicInstructions.length > 0
      ? userBasicInstructions
      : [
        '요구사항 불명확 시 보수적으로 가정하고 위험한 변경을 피한다.',
        '기존 인터페이스와 동작 호환성을 우선한다.',
        '보안/권한/오류 처리 경로를 누락하지 않는다.',
      ],
    warnings,
  );

  const conversationHistory = sanitizeContextList(userConversationHistory, warnings);
  const longTermMemory = sanitizeContextList(userLongTermMemory, warnings);
  const externalResources = sanitizeContextList(userExternalResources, warnings);
  const availableTools = sanitizeContextList(
    userAvailableTools.length > 0 ? userAvailableTools : ['code.generate', 'rag.retrieve', 'web.fetch'],
    warnings,
  );
  const responseFormat = sanitizeContextList(
    userResponseFormat.length > 0
      ? userResponseFormat
      : [
        '한국어 설명 2~4문장 후 FILE 블록 제공',
        'FILE 블록 포맷: <<<FILE:path>>> ... <<<END_FILE>>>',
        '최대 3개 파일, 가능하면 테스트/사용 예시 1개 포함',
      ],
    warnings,
  );

  const conflicts = detectContextConflicts(responseFormat, basicInstructions);
  warnings.push(...conflicts);

  return {
    basicInstructions,
    currentQuestion: normalizeContextLine(goal, 600),
    conversationHistory,
    longTermMemory,
    externalResources,
    availableTools,
    responseFormat,
    contextWarnings: warnings,
  };
};

const pickByPattern = (goal: string, hints: Array<{ label: string; pattern: RegExp }>): string[] => {
  const selected: string[] = [];
  for (const hint of hints) {
    if (hint.pattern.test(goal) && !selected.includes(hint.label)) {
      selected.push(hint.label);
    }
  }
  return selected;
};

const inferTaskType = (goal: string): CodingTaskType => {
  for (const rule of TASK_TYPE_RULES) {
    if (rule.pattern.test(goal)) {
      return rule.type;
    }
  }
  return 'unknown';
};

const inferDeliverables = (taskType: CodingTaskType): string[] => {
  if (taskType === 'bugfix') return ['원인 반영 코드 수정', '재발 방지용 검증 포인트'];
  if (taskType === 'refactor') return ['리팩터링된 구현 코드', '변경 의도 요약'];
  if (taskType === 'test') return ['테스트 코드', '실행 방법 또는 테스트 포인트'];
  if (taskType === 'integration') return ['연동 로직 코드', '실패/예외 처리 경로'];
  return ['실행 가능한 구현 코드', '간단한 사용 또는 검증 안내'];
};

const inferWorkflow = (taskType: CodingTaskType): string[] => {
  const common = [
    '요구사항 핵심 추출 및 불명확 부분 최소 가정 선언',
    '변경 범위 최소화 설계 (영향 파일 우선순위)',
    '핵심 로직 구현 후 예외/실패 경로 보강',
    '결과를 바로 적용 가능한 형태로 정리',
  ];

  if (taskType === 'bugfix') {
    return ['재현 조건/오류 원인 가설 수립', '원인 지점 최소 수정', '회귀 방지 체크포인트 추가', ...common];
  }
  if (taskType === 'test') {
    return ['대상 로직의 정상/실패 경계 식별', '핵심 시나리오별 테스트 케이스 설계', '실행 단위 분리 및 fixture/mocking 최소화', ...common];
  }
  return common;
};

const buildStructuredCodingContext = (goal: string): StructuredCodingContext => {
  const cleaned = compact(goal);
  const taskType = inferTaskType(cleaned);
  const languages = pickByPattern(cleaned, LANGUAGE_HINTS);
  const stacks = pickByPattern(cleaned, STACK_HINTS);
  const constraints = pickByPattern(cleaned, CONSTRAINT_HINTS);

  return {
    objective: cleaned,
    taskType,
    languages: languages.length > 0 ? languages : ['TypeScript'],
    stacks,
    constraints: constraints.length > 0 ? constraints : ['요구사항 불명확 시 보수적 추론'],
    deliverables: inferDeliverables(taskType),
    workflow: inferWorkflow(taskType),
  };
};

const extractBriefValue = (goal: string, labels: string[]): string => {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(?:^|\\n|\\r|\\s)(?:${escaped})\\s*[:：-]\\s*([^\\n\\r]{2,220})`, 'i');
  const match = String(goal || '').match(regex);
  if (!match) return '';
  return normalizeContextLine(match[1], 180);
};

const buildUserBackgroundBrief = (goal: string): UserBackgroundBrief => {
  const scenario = extractBriefValue(goal, ['상황', '배경', 'context', 'scenario']) || '현재 요청 본문 기반';
  const role = extractBriefValue(goal, ['역할', 'role', 'persona']) || '실무형 구현 담당 에이전트';
  const purpose = extractBriefValue(goal, ['목적', 'goal', 'objective']) || '바로 적용 가능한 코드 산출물 제공';
  return { scenario, role, purpose };
};

const buildPrompt = (goal: string, args?: Record<string, unknown>): string => {
  const context = buildStructuredCodingContext(goal);
  const contextPack = buildContextSevenPack(goal, args);
  const brief = buildUserBackgroundBrief(goal);
  const strategy = applyContextEngineering({
    goal,
    taskType: context.taskType,
    history: contextPack.conversationHistory,
    longTermMemory: contextPack.longTermMemory,
    externalResources: contextPack.externalResources,
    tools: contextPack.availableTools,
  });

  const asBullets = (lines: string[], emptyText: string) => (lines.length > 0 ? lines.map((line) => `- ${line}`) : [`- ${emptyText}`]);

  return [
    '요청된 기능을 구현할 수 있는 실용적인 코드 초안을 생성하세요.',
    '',
    '[USER_BRIEF]',
    `상황: ${brief.scenario}`,
    `역할: ${brief.role}`,
    `목적: ${brief.purpose}`,
    '',
    '[CONTEXT_7]',
    '기본 지침:',
    ...asBullets(contextPack.basicInstructions, '기본 지침 없음'),
    '현재 질문:',
    `- ${contextPack.currentQuestion}`,
    '대화 기록:',
    ...asBullets(strategy.summarizedHistory, '대화 기록 없음'),
    '장기 기억:',
    ...asBullets(strategy.selectedLongTermMemory, '장기 기억 없음'),
    '외부 자료:',
    ...asBullets(strategy.selectedExternalResources, '외부 자료 없음'),
    '사용 가능한 도구:',
    ...asBullets(strategy.selectedTools, '도구 정보 없음'),
    '답변 형식:',
    ...asBullets(contextPack.responseFormat, '기본 형식 사용'),
    contextPack.contextWarnings.length > 0 ? '컨텍스트 경고:' : '',
    ...(contextPack.contextWarnings.length > 0 ? contextPack.contextWarnings.map((line) => `- ${line}`) : []),
    '',
    '[CONTEXT_ENGINEERING_STRATEGY]',
    '저장하기(대화 외부 요약 메모):',
    `- ${strategy.savedMemo}`,
    '골라주기(관련 정보만 선별):',
    `- 장기기억 ${strategy.selectedLongTermMemory.length}개, 외부자료 ${strategy.selectedExternalResources.length}개, 도구 ${strategy.selectedTools.length}개`,
    '정리하기(긴 대화 중간 요약):',
    `- 원본 ${contextPack.conversationHistory.length}개 -> 요약 ${strategy.summarizedHistory.length}개`,
    '나눠주기(작업 세분화):',
    ...strategy.workPackages.map((item, idx) => `- ${idx + 1}. ${item}`),
    `- 분할 모드: ${strategy.splitMode}`,
    `- 분할 힌트: ${strategy.splitHint}`,
    '',
    '[STRUCTURED_CONTEXT]',
    `objective: ${context.objective}`,
    `taskType: ${context.taskType}`,
    `languages: ${context.languages.join(', ')}`,
    `stacks: ${context.stacks.join(', ') || 'unspecified'}`,
    `constraints: ${context.constraints.join(' | ')}`,
    `deliverables: ${context.deliverables.join(' | ')}`,
    '',
    '[WORKFLOW]',
    ...context.workflow.map((step, index) => `${index + 1}. ${step}`),
    strategy.splitMode === 'multi' ? '복합 작업은 조사/작성/구현을 분리하고 이번 응답은 구현 단계 산출물에 집중' : '',
    '',
    '출력 규칙:',
    '1) 반드시 한국어 설명 2~4문장',
    '2) 이어서 FILE 블록 형식으로 파일별 코드를 제시',
    '3) 형식: <<<FILE:path/to/file.ext>>> 다음 줄부터 코드, 끝은 <<<END_FILE>>>',
    '4) 파일은 최대 3개',
    '5) 테스트 또는 사용 예시 파일 1개 포함 권장',
    `요청: ${goal}`,
  ].filter(Boolean).join('\n');
};

const parseFileBlocks = (raw: string): Array<{ path: string; code: string }> => {
  const out: Array<{ path: string; code: string }> = [];
  const regex = /<<<FILE:([^>]+)>>>\s*([\s\S]*?)\s*<<<END_FILE>>>/g;
  let match: RegExpExecArray | null = regex.exec(raw);
  while (match) {
    const filePath = compact(match[1]).slice(0, 120);
    const code = String(match[2] || '').trim();
    if (filePath && code) {
      out.push({ path: filePath, code });
    }
    match = regex.exec(raw);
  }
  return out.slice(0, 3);
};

const toExt = (filePath: string): string => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.js')) return 'js';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.json')) return 'json';
  return '';
};

export const codeGenerateAction: ActionDefinition = {
  name: 'code.generate',
  description: '요청 목표를 바탕으로 실제 코드 초안(파일별 블록)을 생성합니다.',
  execute: async ({ goal, args }) => {
    const query = typeof args?.query === 'string' && args.query.trim() ? args.query.trim() : stripGoalNoise(goal);

    if (!query) {
      return {
        ok: false,
        name: 'code.generate',
        summary: '코드 생성을 위한 요청이 비어 있습니다.',
        artifacts: [],
        verification: ['query empty'],
        error: 'QUERY_EMPTY',
      };
    }

    const raw = await generateText({
      system: [
        '너는 실무형 코드 생성 에이전트다.',
        '장황한 설명보다 바로 실행 가능한 코드 초안을 우선 제공한다.',
        '출력 형식은 사용자가 요구한 FILE 블록 포맷을 엄수한다.',
      ].join('\n'),
      user: buildPrompt(query, args),
      temperature: 0.15,
      maxTokens: 1400,
    });

    const files = parseFileBlocks(raw);
    const artifacts: string[] = [];

    const context = buildStructuredCodingContext(query);
    const contextPack = buildContextSevenPack(query, args);
    const strategy = applyContextEngineering({
      goal: query,
      taskType: context.taskType,
      history: contextPack.conversationHistory,
      longTermMemory: contextPack.longTermMemory,
      externalResources: contextPack.externalResources,
      tools: contextPack.availableTools,
    });

    artifacts.push(`[CONTEXT_MEMO] ${strategy.savedMemo}`);

    const intro = compact(raw).replace(/<<<FILE:[\s\S]*$/i, '').slice(0, 280);
    if (intro) {
      artifacts.push(intro);
    }

    for (const file of files) {
      const lang = toExt(file.path);
      artifacts.push([
        `파일: ${file.path}`,
        `\`\`\`${lang}`,
        file.code,
        '\`\`\`',
      ].join('\n'));
    }

    if (artifacts.length === 0) {
      artifacts.push(String(raw || '').slice(0, 3200));
    }

    return {
      ok: true,
      name: 'code.generate',
      summary: `코드 초안 ${Math.max(files.length, 1)}건 생성 완료`,
      artifacts: artifacts.slice(0, 4),
      verification: [
        'context-7 packaged',
        'user-brief packaged (scenario/role/purpose)',
        'context-engineering: save-important-info',
        'context-engineering: selective-context-delivery',
        'context-engineering: dialogue-summarization',
        'context-engineering: task-decomposition',
        'context-engineering: split-complex-workflow',
        'intent-aware structured context applied',
        'context contamination/conflict guard applied',
        'llm code generation completed',
      ],
    };
  },
};

import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';

export type PromptCompileResult = {
  originalGoal: string;
  normalizedGoal: string;
  executionGoal: string;
  compiledGoal: string;
  intentTags: string[];
  directives: string[];
  droppedNoise: boolean;
};

const PROMPT_COMPILER_ENABLED = parseBooleanEnv(process.env.PROMPT_COMPILER_ENABLED, true);
const PROMPT_COMPILER_MAX_LENGTH = Math.max(120, parseIntegerEnv(process.env.PROMPT_COMPILER_MAX_LENGTH, 1200));

const NOISE_PREFIXES = [
  /^요청\s*결과\s*[:：]?/i,
  /^요청\s*[:：]?/i,
  /^목표\s*[:：]?/i,
  /^세션\s*스킬\s*실행\s*[:：]?/i,
  /^역할\s*[:：]?/i,
];

const INTENT_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: 'news', re: /(뉴스|기사|속보|news)/i },
  { tag: 'youtube', re: /(youtube|유튜브|영상)/i },
  { tag: 'community', re: /(커뮤니티|디스코드|reddit|forum|포럼)/i },
  { tag: 'automation', re: /(자동화|워크플로|트리거|스케줄|automation)/i },
  { tag: 'ops', re: /(운영|장애|온콜|runbook|incident|ops)/i },
  { tag: 'coding', re: /(코드|리팩터|typescript|node|api|버그|에러)/i },
];

const DIRECTIVE_RULES: Array<{ directive: string; re: RegExp }> = [
  { directive: 'response.short', re: /(짧게|간단하게|요약)/i },
  { directive: 'response.detailed', re: /(자세히|상세히|깊게)/i },
  { directive: 'response.with-verification', re: /(근거|검증|출처|verify|verification)/i },
  { directive: 'response.step-by-step', re: /(단계별|순서대로|step by step)/i },
  { directive: 'response.risk-first', re: /(리스크|위험|주의|가드레일)/i },
];

const collapseWhitespace = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

const stripNoisePrefixes = (value: string): { text: string; droppedNoise: boolean } => {
  let text = String(value || '').trim();
  let droppedNoise = false;

  for (const prefix of NOISE_PREFIXES) {
    if (prefix.test(text)) {
      text = text.replace(prefix, '').trim();
      droppedNoise = true;
    }
  }

  return { text, droppedNoise };
};

const detectTags = (text: string): string[] => {
  const tags: string[] = [];
  for (const rule of INTENT_RULES) {
    if (rule.re.test(text)) {
      tags.push(rule.tag);
    }
  }
  return tags;
};

const detectDirectives = (text: string): string[] => {
  const directives: string[] = [];
  for (const rule of DIRECTIVE_RULES) {
    if (rule.re.test(text)) {
      directives.push(rule.directive);
    }
  }
  return directives;
};

export const compilePromptGoal = (goal: string): PromptCompileResult => {
  const originalGoal = String(goal || '');
  const normalizedGoal = collapseWhitespace(originalGoal).slice(0, PROMPT_COMPILER_MAX_LENGTH);

  if (!PROMPT_COMPILER_ENABLED) {
    return {
      originalGoal,
      normalizedGoal,
      executionGoal: normalizedGoal,
      compiledGoal: normalizedGoal,
      intentTags: [],
      directives: [],
      droppedNoise: false,
    };
  }

  const stripped = stripNoisePrefixes(normalizedGoal);
  const cleaned = collapseWhitespace(stripped.text).slice(0, PROMPT_COMPILER_MAX_LENGTH);
  const executionGoal = cleaned || normalizedGoal;
  const intentTags = detectTags(cleaned);
  const directives = detectDirectives(cleaned);

  const compiledParts = [
    cleaned || normalizedGoal,
    intentTags.length > 0 ? `[intent-tags] ${intentTags.join(', ')}` : '',
    directives.length > 0 ? `[response-directives] ${directives.join(', ')}` : '',
  ].filter(Boolean);

  return {
    originalGoal,
    normalizedGoal,
    executionGoal,
    compiledGoal: compiledParts.join(' | '),
    intentTags,
    directives,
    droppedNoise: stripped.droppedNoise,
  };
};

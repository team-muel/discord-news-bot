import { parseIntegerEnv } from '../utils/env';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const toRegex = (raw: string | undefined, fallbackSource: string): RegExp => {
  const source = String(raw || '').trim() || fallbackSource;
  try {
    return new RegExp(source, 'i');
  } catch {
    return new RegExp(fallbackSource, 'i');
  }
};

const DEFAULT_CODING_INTENT_PATTERN_SOURCE = '(코드|코딩|구현|함수|클래스|버그|리팩터|script|typescript|javascript|python|sql|api\\s*만들|코드\\s*짜|만들어|짜줘|작성해줘)';
const DEFAULT_AUTOMATION_INTENT_PATTERN_SOURCE = '(자동화|봇|워커|연동|알림|크롤|webhook|api.*만들|자동.*전송|데이터.*수집|주기적|스케줄)';

export const CODING_INTENT_PATTERN = toRegex(
  process.env.DISCORD_CODING_INTENT_PATTERN,
  DEFAULT_CODING_INTENT_PATTERN_SOURCE,
);

export const AUTOMATION_INTENT_PATTERN = toRegex(
  process.env.DISCORD_AUTOMATION_INTENT_PATTERN,
  DEFAULT_AUTOMATION_INTENT_PATTERN_SOURCE,
);

export const DISCORD_EMBED_DESCRIPTION_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_EMBED_DESCRIPTION_LIMIT, 3900),
  500,
  4000,
);

export const DISCORD_ADMIN_SUMMARY_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_ADMIN_SUMMARY_LIMIT, 2000),
  200,
  3000,
);

export const DISCORD_ADMIN_DETAILS_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_ADMIN_DETAILS_LIMIT, 1000),
  200,
  1024,
);

export const DISCORD_DOCS_MESSAGE_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_MESSAGE_LIMIT, 1900),
  500,
  4000,
);

export const DISCORD_DOCS_CONTEXT_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_CONTEXT_LIMIT, 4000),
  500,
  6000,
);

export const DISCORD_DOCS_ANSWER_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_ANSWER_LIMIT, 1400),
  300,
  3500,
);

export const DISCORD_DOCS_ANSWER_TARGET_CHARS = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_ANSWER_TARGET_CHARS, 400),
  100,
  1500,
);

export const DISCORD_DOCS_LLM_MAX_TOKENS = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_LLM_MAX_TOKENS, 700),
  100,
  3000,
);

export const DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT, 600),
  200,
  2000,
);

export const clipDocsFallbackContext = (value: string): string => {
  return String(value || '').slice(0, DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT);
};

export const DISCORD_MARKET_ANALYSIS_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_MARKET_ANALYSIS_LIMIT, 3900),
  500,
  4000,
);

export const DISCORD_AGENT_RESULT_PREVIEW_LIMIT = clamp(
  parseIntegerEnv(process.env.DISCORD_AGENT_RESULT_PREVIEW_LIMIT, 1200),
  200,
  3000,
);

export const DISCORD_VIBE_WORKER_REQUEST_CLIP = clamp(
  parseIntegerEnv(process.env.DISCORD_VIBE_WORKER_REQUEST_CLIP, 200),
  60,
  500,
);

export const DISCORD_VIBE_DEDUP_MAX_ENTRIES = clamp(
  parseIntegerEnv(process.env.DISCORD_VIBE_DEDUP_MAX_ENTRIES, 500),
  100,
  5000,
);

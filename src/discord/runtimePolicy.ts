import { parseIntegerEnv } from '../utils/env';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const REDOS_SUSPECT_RE = /([+*]|\{[0-9,]+\})\s*\)\s*[+*?]/;

const toRegex = (raw: string | undefined, fallbackSource: string): RegExp => {
  const source = String(raw || '').trim() || fallbackSource;
  if (REDOS_SUSPECT_RE.test(source)) {
    return new RegExp(fallbackSource, 'i');
  }
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

// ─── H-001: Simple command allowlist ──────────────────────────────────────────
const parseCommandAllowlist = (): ReadonlySet<string> => {
  const override = String(process.env.DISCORD_SIMPLE_COMMAND_ALLOWLIST || '').trim();
  if (override) {
    return new Set(override.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return new Set([
    'ping', 'help', '도움말', '로그인', '구독', '해줘', '만들어줘',
    '주가', '차트', '상태', '설정', '정책', '세션', '관리설정',
    '잊어줘', '학습', '유저', '유저 프로필 보기', '유저 메모 추가',
  ]);
};
export const SIMPLE_COMMAND_ALLOWLIST: ReadonlySet<string> = parseCommandAllowlist();

// ─── H-003: Session streaming / timeout ───────────────────────────────────────
const parsePositiveInt = (value: string | undefined, fallback: number, min = 1): number => {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) ? Math.max(min, Math.floor(parsed)) : fallback;
};

export const SESSION_PROGRESS_TIMEOUT_MS = parsePositiveInt(process.env.DISCORD_SESSION_PROGRESS_TIMEOUT_MS, 3 * 60 * 1000, 10_000);
export const SESSION_PROGRESS_INTERVAL_MS = parsePositiveInt(process.env.DISCORD_SESSION_PROGRESS_INTERVAL_MS, 2200, 500);
export const SESSION_PROGRESS_UPDATE_BUCKET_MS = parsePositiveInt(process.env.DISCORD_SESSION_PROGRESS_UPDATE_BUCKET_MS, 10_000, 1000);
export const SESSION_RESULT_CLIP_LIMIT_DEBUG = parsePositiveInt(process.env.DISCORD_SESSION_RESULT_CLIP_LIMIT_DEBUG, 1700, 200);
export const SESSION_RESULT_CLIP_LIMIT_USER = parsePositiveInt(process.env.DISCORD_SESSION_RESULT_CLIP_LIMIT_USER, 1200, 200);

// ─── Auth cache limits ────────────────────────────────────────────────────────
export const AUTH_MAX_GUILDS_IN_CACHE = parsePositiveInt(process.env.DISCORD_AUTH_MAX_GUILDS_IN_CACHE, 500, 10);
export const AUTH_MAX_USERS_PER_GUILD = parsePositiveInt(process.env.DISCORD_AUTH_MAX_USERS_PER_GUILD, 5000, 50);

// ─── Passive memory capture ───────────────────────────────────────────────────
export const PASSIVE_MEMORY_LEARNING_POLICY_TTL_MS = parsePositiveInt(process.env.DISCORD_LEARNING_POLICY_TTL_MS, 30_000, 5_000);
export const PASSIVE_MEMORY_CO_PRESENCE_WINDOW_MS = parsePositiveInt(process.env.DISCORD_CO_PRESENCE_WINDOW_MS, 30 * 60 * 1000, 60_000);
export const PASSIVE_MEMORY_CO_PRESENCE_MAX_TARGETS = parsePositiveInt(process.env.DISCORD_CO_PRESENCE_MAX_TARGETS, 2, 1);
export const PASSIVE_MEMORY_CONTENT_LIMIT = parsePositiveInt(process.env.DISCORD_PASSIVE_MEMORY_CONTENT_LIMIT, 2000, 100);
export const PASSIVE_MEMORY_EXCERPT_LIMIT = parsePositiveInt(process.env.DISCORD_PASSIVE_MEMORY_EXCERPT_LIMIT, 300, 50);

// ─── Feedback reaction seeding ────────────────────────────────────────────────
export const FEEDBACK_REACTION_SEED_ENABLED = (() => {
  const raw = String(process.env.DISCORD_FEEDBACK_REACTION_SEED_ENABLED || 'true').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
})();
export const FEEDBACK_REACTION_SEED_UP = String(process.env.DISCORD_FEEDBACK_REACTION_SEED_UP || '👍').trim();
export const FEEDBACK_REACTION_SEED_DOWN = String(process.env.DISCORD_FEEDBACK_REACTION_SEED_DOWN || '👎').trim();

// ─── Vibe worker proposal ─────────────────────────────────────────────────────
export const DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES = clamp(
  parseIntegerEnv(process.env.DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES, 500),
  50,
  5000,
);

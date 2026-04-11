import {
  DISCORD_CODING_INTENT_PATTERN_RAW,
  DISCORD_AUTOMATION_INTENT_PATTERN_RAW,
  DISCORD_EMBED_DESCRIPTION_LIMIT_RAW,
  DISCORD_ADMIN_SUMMARY_LIMIT_RAW,
  DISCORD_ADMIN_DETAILS_LIMIT_RAW,
  DISCORD_DOCS_MESSAGE_LIMIT_RAW,
  DISCORD_DOCS_CONTEXT_LIMIT_RAW,
  DISCORD_DOCS_ANSWER_LIMIT_RAW,
  DISCORD_DOCS_ANSWER_TARGET_CHARS_RAW,
  DISCORD_DOCS_LLM_MAX_TOKENS_RAW,
  DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT_RAW,
  DISCORD_MARKET_ANALYSIS_LIMIT_RAW,
  DISCORD_AGENT_RESULT_PREVIEW_LIMIT_RAW,
  DISCORD_VIBE_WORKER_REQUEST_CLIP_RAW,
  DISCORD_VIBE_DEDUP_MAX_ENTRIES_RAW,
  DISCORD_SIMPLE_COMMAND_ALLOWLIST_RAW,
  DISCORD_SESSION_PROGRESS_TIMEOUT_MS_RAW,
  DISCORD_SESSION_PROGRESS_INTERVAL_MS_RAW,
  DISCORD_SESSION_PROGRESS_UPDATE_BUCKET_MS_RAW,
  DISCORD_SESSION_RESULT_CLIP_LIMIT_DEBUG_RAW,
  DISCORD_SESSION_RESULT_CLIP_LIMIT_USER_RAW,
  DISCORD_AUTH_MAX_GUILDS_IN_CACHE_RAW,
  DISCORD_AUTH_MAX_USERS_PER_GUILD_RAW,
  DISCORD_LEARNING_POLICY_TTL_MS_RAW,
  DISCORD_CO_PRESENCE_WINDOW_MS_RAW,
  DISCORD_CO_PRESENCE_MAX_TARGETS_RAW,
  DISCORD_PASSIVE_MEMORY_CONTENT_LIMIT_RAW,
  DISCORD_PASSIVE_MEMORY_EXCERPT_LIMIT_RAW,
  DISCORD_FEEDBACK_REACTION_SEED_ENABLED_RAW,
  DISCORD_FEEDBACK_REACTION_SEED_UP_RAW,
  DISCORD_FEEDBACK_REACTION_SEED_DOWN_RAW,
  DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES_RAW,
} from '../config';
import { parseCsvList } from '../utils/env';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const REDOS_SUSPECT_RE = /([+*]|\{[0-9,]+\})\s*\)\s*[+*?]/;

type IntentPatternStatus = 'default' | 'custom' | 'disabled-invalid';
type IntentPatternReason = 'missing' | 'ok' | 'redos-suspect' | 'invalid-regex';

export type IntentPatternDiagnostics = {
  label: 'coding' | 'automation';
  status: IntentPatternStatus;
  reason: IntentPatternReason;
  source: string;
};

const NEVER_MATCH_PATTERN_SOURCE = '(?!)';

const buildIntentPattern = (
  raw: string | undefined,
  fallbackSource: string,
  label: IntentPatternDiagnostics['label'],
): { regex: RegExp; diagnostics: IntentPatternDiagnostics } => {
  const source = String(raw || '').trim();
  if (!source) {
    return {
      regex: new RegExp(fallbackSource, 'i'),
      diagnostics: {
        label,
        status: 'default',
        reason: 'missing',
        source: fallbackSource,
      },
    };
  }

  if (REDOS_SUSPECT_RE.test(source)) {
    console.error('[discord-runtime-policy] invalid %s intent regex rejected (redos-suspect); override disabled', label);
    return {
      regex: new RegExp(NEVER_MATCH_PATTERN_SOURCE, 'i'),
      diagnostics: {
        label,
        status: 'disabled-invalid',
        reason: 'redos-suspect',
        source,
      },
    };
  }

  try {
    return {
      regex: new RegExp(source, 'i'),
      diagnostics: {
        label,
        status: 'custom',
        reason: 'ok',
        source,
      },
    };
  } catch {
    console.error('[discord-runtime-policy] invalid %s intent regex rejected (syntax); override disabled', label);
    return {
      regex: new RegExp(NEVER_MATCH_PATTERN_SOURCE, 'i'),
      diagnostics: {
        label,
        status: 'disabled-invalid',
        reason: 'invalid-regex',
        source,
      },
    };
  }
};

const DEFAULT_CODING_INTENT_PATTERN_SOURCE = '(코드|코딩|구현|함수|클래스|버그|리팩터|script|typescript|javascript|python|sql|api\\s*만들|코드\\s*짜|만들어|짜줘|작성해줘)';
const DEFAULT_AUTOMATION_INTENT_PATTERN_SOURCE = '(자동화|봇|워커|연동|알림|크롤|webhook|api.*만들|자동.*전송|데이터.*수집|주기적|스케줄)';

const CODING_INTENT_PATTERN_STATE = buildIntentPattern(
  DISCORD_CODING_INTENT_PATTERN_RAW || undefined,
  DEFAULT_CODING_INTENT_PATTERN_SOURCE,
  'coding',
);

const AUTOMATION_INTENT_PATTERN_STATE = buildIntentPattern(
  DISCORD_AUTOMATION_INTENT_PATTERN_RAW || undefined,
  DEFAULT_AUTOMATION_INTENT_PATTERN_SOURCE,
  'automation',
);

export const CODING_INTENT_PATTERN = CODING_INTENT_PATTERN_STATE.regex;

export const AUTOMATION_INTENT_PATTERN = AUTOMATION_INTENT_PATTERN_STATE.regex;

export const INTENT_PATTERN_DIAGNOSTICS = {
  coding: CODING_INTENT_PATTERN_STATE.diagnostics,
  automation: AUTOMATION_INTENT_PATTERN_STATE.diagnostics,
};

export const DISCORD_EMBED_DESCRIPTION_LIMIT = clamp(DISCORD_EMBED_DESCRIPTION_LIMIT_RAW, 500, 4000);
export const DISCORD_ADMIN_SUMMARY_LIMIT = clamp(DISCORD_ADMIN_SUMMARY_LIMIT_RAW, 200, 3000);
export const DISCORD_ADMIN_DETAILS_LIMIT = clamp(DISCORD_ADMIN_DETAILS_LIMIT_RAW, 200, 1024);
export const DISCORD_DOCS_MESSAGE_LIMIT = clamp(DISCORD_DOCS_MESSAGE_LIMIT_RAW, 500, 4000);
export const DISCORD_DOCS_CONTEXT_LIMIT = clamp(DISCORD_DOCS_CONTEXT_LIMIT_RAW, 500, 6000);
export const DISCORD_DOCS_ANSWER_LIMIT = clamp(DISCORD_DOCS_ANSWER_LIMIT_RAW, 300, 3500);
export const DISCORD_DOCS_ANSWER_TARGET_CHARS = clamp(DISCORD_DOCS_ANSWER_TARGET_CHARS_RAW, 100, 1500);
export const DISCORD_DOCS_LLM_MAX_TOKENS = clamp(DISCORD_DOCS_LLM_MAX_TOKENS_RAW, 100, 3000);
export const DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT = clamp(DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT_RAW, 200, 2000);

export const clipDocsFallbackContext = (value: string): string => {
  return String(value || '').slice(0, DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT);
};

export const DISCORD_MARKET_ANALYSIS_LIMIT = clamp(DISCORD_MARKET_ANALYSIS_LIMIT_RAW, 500, 4000);
export const DISCORD_AGENT_RESULT_PREVIEW_LIMIT = clamp(DISCORD_AGENT_RESULT_PREVIEW_LIMIT_RAW, 200, 3000);
export const DISCORD_VIBE_WORKER_REQUEST_CLIP = clamp(DISCORD_VIBE_WORKER_REQUEST_CLIP_RAW, 60, 500);
export const DISCORD_VIBE_DEDUP_MAX_ENTRIES = clamp(DISCORD_VIBE_DEDUP_MAX_ENTRIES_RAW, 100, 5000);

// ─── H-001: Simple command allowlist ──────────────────────────────────────────
const parseCommandAllowlist = (): ReadonlySet<string> => {
  if (DISCORD_SIMPLE_COMMAND_ALLOWLIST_RAW) {
    return new Set(parseCsvList(DISCORD_SIMPLE_COMMAND_ALLOWLIST_RAW));
  }
  return new Set([
    'ping', 'help', '도움말', '로그인', '구독', '뮤엘', '해줘', '만들어줘',
    '주가', '차트', '상태', '설정', '정책', '세션', '관리설정',
    '잊어줘', '학습', '유저', '프로필', '메모', '유저 프로필 보기', '유저 메모 추가',
  ]);
};
export const SIMPLE_COMMAND_ALLOWLIST: ReadonlySet<string> = parseCommandAllowlist();

// ─── H-003: Session streaming / timeout ───────────────────────────────────────

export const SESSION_PROGRESS_TIMEOUT_MS = Math.max(10_000, DISCORD_SESSION_PROGRESS_TIMEOUT_MS_RAW);
export const SESSION_PROGRESS_INTERVAL_MS = Math.max(500, DISCORD_SESSION_PROGRESS_INTERVAL_MS_RAW);
export const SESSION_PROGRESS_UPDATE_BUCKET_MS = Math.max(1000, DISCORD_SESSION_PROGRESS_UPDATE_BUCKET_MS_RAW);
export const SESSION_RESULT_CLIP_LIMIT_DEBUG = Math.max(200, DISCORD_SESSION_RESULT_CLIP_LIMIT_DEBUG_RAW);
export const SESSION_RESULT_CLIP_LIMIT_USER = Math.max(200, DISCORD_SESSION_RESULT_CLIP_LIMIT_USER_RAW);

// ─── Auth cache limits ────────────────────────────────────────────────────────
export const AUTH_MAX_GUILDS_IN_CACHE = Math.max(10, DISCORD_AUTH_MAX_GUILDS_IN_CACHE_RAW);
export const AUTH_MAX_USERS_PER_GUILD = Math.max(50, DISCORD_AUTH_MAX_USERS_PER_GUILD_RAW);

// ─── Passive memory capture ───────────────────────────────────────────────────
export const PASSIVE_MEMORY_LEARNING_POLICY_TTL_MS = Math.max(5_000, DISCORD_LEARNING_POLICY_TTL_MS_RAW);
export const PASSIVE_MEMORY_CO_PRESENCE_WINDOW_MS = Math.max(60_000, DISCORD_CO_PRESENCE_WINDOW_MS_RAW);
export const PASSIVE_MEMORY_CO_PRESENCE_MAX_TARGETS = Math.max(1, DISCORD_CO_PRESENCE_MAX_TARGETS_RAW);
export const PASSIVE_MEMORY_CONTENT_LIMIT = Math.max(100, DISCORD_PASSIVE_MEMORY_CONTENT_LIMIT_RAW);
export const PASSIVE_MEMORY_EXCERPT_LIMIT = Math.max(50, DISCORD_PASSIVE_MEMORY_EXCERPT_LIMIT_RAW);

// ─── Feedback reaction seeding ────────────────────────────────────────────────
export const FEEDBACK_REACTION_SEED_ENABLED = DISCORD_FEEDBACK_REACTION_SEED_ENABLED_RAW;
export const FEEDBACK_REACTION_SEED_UP = DISCORD_FEEDBACK_REACTION_SEED_UP_RAW;
export const FEEDBACK_REACTION_SEED_DOWN = DISCORD_FEEDBACK_REACTION_SEED_DOWN_RAW;

// ─── Vibe worker proposal ─────────────────────────────────────────────────────
export const DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES = clamp(DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES_RAW, 50, 5000);

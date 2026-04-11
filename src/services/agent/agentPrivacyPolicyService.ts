import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

export type AgentPrivacyMode = 'direct' | 'plan_act' | 'deliberate' | 'guarded';

export type AgentPrivacyRuleInput = {
  pattern: string;
  score: number;
  reason: string;
};

export type AgentPrivacyCompiledRule = {
  re: RegExp;
  score: number;
  reason: string;
  pattern: string;
};

export type AgentPrivacyPolicySnapshot = {
  modeDefault: AgentPrivacyMode;
  reviewScore: number;
  blockScore: number;
  reviewRules: AgentPrivacyCompiledRule[];
  blockRules: AgentPrivacyCompiledRule[];
};

type AgentPrivacyRuleValidationResult =
  | { ok: true; rules: AgentPrivacyRuleInput[] }
  | { ok: false; message: string };

const AGENT_PRIVACY_POLICY_CACHE_TTL_MS = parseMinIntEnv(process.env.AGENT_PRIVACY_POLICY_CACHE_TTL_MS, 60_000, 5_000);
const AGENT_PRIVACY_POLICY_CACHE_ERROR_LOG_THROTTLE_MS = parseMinIntEnv(process.env.AGENT_PRIVACY_POLICY_CACHE_ERROR_LOG_THROTTLE_MS, 5 * 60_000, 30_000);

const DEFAULT_MODE: AgentPrivacyMode = parseBooleanEnv(process.env.AGENT_PRIVACY_GUARDED_DEFAULT, true)
  ? 'guarded'
  : 'direct';
const DEFAULT_REVIEW_SCORE = parseBoundedNumberEnv(process.env.AGENT_PRIVACY_REVIEW_SCORE, 60, 0, 100);
const DEFAULT_BLOCK_SCORE = Math.max(DEFAULT_REVIEW_SCORE + 1, parseBoundedNumberEnv(process.env.AGENT_PRIVACY_BLOCK_SCORE, 80, 0, 100));

const DEFAULT_REVIEW_RULES: AgentPrivacyRuleInput[] = [
  { pattern: '(이메일|전화번호|연락처|주소|주민등록|신분증|여권|계좌|카드번호|토큰|비밀번호|api key)', score: 28, reason: 'personal_or_secret_identifier' },
  { pattern: '(실명|본명|생년월일|birthday|dob|주번|학번)', score: 20, reason: 'identity_attribute' },
  { pattern: '(환자|의료|진단|건강기록|병력|상담기록)', score: 24, reason: 'health_sensitive_domain' },
  { pattern: '(청소년|미성년|학생 개인정보|아동)', score: 24, reason: 'minor_sensitive_context' },
];

const DEFAULT_BLOCK_RULES: AgentPrivacyRuleInput[] = [
  { pattern: '(원본.*(대량 공유|전송)|전체.*덤프|raw.*log|전건 다운 파일)', score: 55, reason: 'bulk_sensitive_export' },
  { pattern: '(토큰.*보여|비밀번호.*출력|패스워드.*공개|credentials?.*dump)', score: 60, reason: 'secret_exposure_attempt' },
  { pattern: '(개인정보.*수집.*자동|동의 없이|무단 수집)', score: 50, reason: 'non_consensual_collection' },
];

const MAX_POLICY_RULE_COUNT = 64;
const MAX_POLICY_RULE_PATTERN_LENGTH = 240;
const MAX_POLICY_RULE_REASON_LENGTH = 120;

// Reject patterns with nested quantifiers that could cause catastrophic backtracking
const REDOS_SUSPECT_RE = /([+*]|\{[0-9,]+\})\s*\)\s*[+*?]|\(\?=.*[+*].*\)\s*[+*]/;

export const validateAgentPrivacyRuleInputs = (
  value: unknown,
  fieldName: string,
): AgentPrivacyRuleValidationResult => {
  if (value === undefined || value === null) {
    return { ok: true, rules: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: `${fieldName} must be an array of rule objects` };
  }
  if (value.length > MAX_POLICY_RULE_COUNT) {
    return { ok: false, message: `${fieldName} cannot exceed ${MAX_POLICY_RULE_COUNT} rules` };
  }

  const rules: AgentPrivacyRuleInput[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: `${fieldName}[${index}] must be an object with pattern, score, and optional reason` };
    }

    const row = item as Record<string, unknown>;
    const pattern = String(row.pattern || '').trim();
    if (!pattern) {
      return { ok: false, message: `${fieldName}[${index}].pattern is required` };
    }
    if (pattern.length > MAX_POLICY_RULE_PATTERN_LENGTH) {
      return {
        ok: false,
        message: `${fieldName}[${index}].pattern must be ${MAX_POLICY_RULE_PATTERN_LENGTH} characters or fewer`,
      };
    }
    if (REDOS_SUSPECT_RE.test(pattern)) {
      return { ok: false, message: `${fieldName}[${index}].pattern looks unsafe for regex execution` };
    }
    try {
      void new RegExp(pattern, 'i');
    } catch {
      return { ok: false, message: `${fieldName}[${index}].pattern is not a valid regex` };
    }

    const scoreNumber = Number(row.score);
    const score = Number.isFinite(scoreNumber) ? Math.trunc(scoreNumber) : NaN;
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return { ok: false, message: `${fieldName}[${index}].score must be a number between 0 and 100` };
    }

    const reason = String(row.reason || '').trim() || 'policy_rule';
    if (reason.length > MAX_POLICY_RULE_REASON_LENGTH) {
      return {
        ok: false,
        message: `${fieldName}[${index}].reason must be ${MAX_POLICY_RULE_REASON_LENGTH} characters or fewer`,
      };
    }

    rules.push({ pattern, score, reason });
  }

  return { ok: true, rules };
};

const compileRules = (rules: AgentPrivacyRuleInput[]): AgentPrivacyCompiledRule[] => {
  const out: AgentPrivacyCompiledRule[] = [];
  for (const raw of rules) {
    const pattern = String(raw.pattern || '').trim();
    if (!pattern) {
      continue;
    }

    if (REDOS_SUSPECT_RE.test(pattern)) {
      continue;
    }

    try {
      out.push({
        re: new RegExp(pattern, 'i'),
        score: Math.max(1, Math.min(100, Math.trunc(Number(raw.score) || 0))),
        reason: String(raw.reason || 'policy_rule').trim() || 'policy_rule',
        pattern,
      });
    } catch {
      // ignore malformed pattern
    }
  }
  return out;
};

const DEFAULT_POLICY: AgentPrivacyPolicySnapshot = {
  modeDefault: DEFAULT_MODE,
  reviewScore: DEFAULT_REVIEW_SCORE,
  blockScore: DEFAULT_BLOCK_SCORE,
  reviewRules: compileRules(DEFAULT_REVIEW_RULES),
  blockRules: compileRules(DEFAULT_BLOCK_RULES),
};

type CacheRow = {
  modeDefault: AgentPrivacyMode;
  reviewScore: number;
  blockScore: number;
  reviewRules: AgentPrivacyCompiledRule[];
  blockRules: AgentPrivacyCompiledRule[];
};

let cache = new Map<string, CacheRow>();
let cacheLoadedAt = 0;
let cacheLoading: Promise<void> | null = null;
let lastErrorLogAt = 0;

const isFresh = () => Date.now() - cacheLoadedAt < AGENT_PRIVACY_POLICY_CACHE_TTL_MS;

const toMode = (value: unknown): AgentPrivacyMode => {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'direct' || mode === 'plan_act' || mode === 'deliberate' || mode === 'guarded') {
    return mode;
  }
  return DEFAULT_MODE;
};

const toScore = (value: unknown, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.trunc(n)));
};

const toRuleInputs = (value: unknown, fallback: AgentPrivacyRuleInput[]): AgentPrivacyRuleInput[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const out: AgentPrivacyRuleInput[] = [];
  for (const item of value) {
    const row = item as Record<string, unknown>;
    out.push({
      pattern: String(row.pattern || '').trim(),
      score: Number(row.score || 0),
      reason: String(row.reason || '').trim() || 'policy_rule',
    });
  }
  return out;
};

export const refreshAgentPrivacyPolicyCache = async (): Promise<void> => {
  if (!isSupabaseConfigured()) {
    cache = new Map();
    cacheLoadedAt = Date.now();
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_privacy_policies')
    .select('guild_id, enabled, mode_default, review_score, block_score, review_patterns, block_patterns')
    .eq('enabled', true)
    .limit(300);

  if (error) {
    return;
  }

  const next = new Map<string, CacheRow>();
  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const guildId = String(row.guild_id || '').trim() || '*';
    const modeDefault = toMode(row.mode_default);
    const reviewScore = toScore(row.review_score, DEFAULT_REVIEW_SCORE);
    const blockScore = Math.max(reviewScore + 1, toScore(row.block_score, DEFAULT_BLOCK_SCORE));
    const reviewRules = compileRules(toRuleInputs(row.review_patterns, DEFAULT_REVIEW_RULES));
    const blockRules = compileRules(toRuleInputs(row.block_patterns, DEFAULT_BLOCK_RULES));

    next.set(guildId, {
      modeDefault,
      reviewScore,
      blockScore,
      reviewRules: reviewRules.length > 0 ? reviewRules : DEFAULT_POLICY.reviewRules,
      blockRules: blockRules.length > 0 ? blockRules : DEFAULT_POLICY.blockRules,
    });
  }

  cache = next;
  cacheLoadedAt = Date.now();
};

export const primeAgentPrivacyPolicyCache = (): void => {
  if (cacheLoading || isFresh()) {
    return;
  }

  cacheLoading = refreshAgentPrivacyPolicyCache()
    .catch((error) => {
      const now = Date.now();
      if (now - lastErrorLogAt >= AGENT_PRIVACY_POLICY_CACHE_ERROR_LOG_THROTTLE_MS) {
        lastErrorLogAt = now;
        logger.warn('[AGENT-PRIVACY-POLICY] cache refresh failed (throttled): %s', getErrorMessage(error));
      }
    })
    .finally(() => {
      cacheLoading = null;
    });
};

export const getAgentPrivacyPolicySnapshot = (guildId?: string): AgentPrivacyPolicySnapshot => {
  primeAgentPrivacyPolicyCache();
  const key = String(guildId || '').trim();
  const row = (key && cache.get(key)) || cache.get('*');
  if (!row) {
    return {
      modeDefault: DEFAULT_POLICY.modeDefault,
      reviewScore: DEFAULT_POLICY.reviewScore,
      blockScore: DEFAULT_POLICY.blockScore,
      reviewRules: [...DEFAULT_POLICY.reviewRules],
      blockRules: [...DEFAULT_POLICY.blockRules],
    };
  }

  return {
    modeDefault: row.modeDefault,
    reviewScore: row.reviewScore,
    blockScore: row.blockScore,
    reviewRules: [...row.reviewRules],
    blockRules: [...row.blockRules],
  };
};

export const upsertAgentPrivacyPolicy = async (params: {
  guildId: string;
  modeDefault: AgentPrivacyMode;
  reviewScore: number;
  blockScore: number;
  reviewPatterns: AgentPrivacyRuleInput[];
  blockPatterns: AgentPrivacyRuleInput[];
  enabled?: boolean;
  updatedBy?: string;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const reviewValidation = validateAgentPrivacyRuleInputs(params.reviewPatterns, 'reviewPatterns');
  if (!reviewValidation.ok) {
    throw new Error(reviewValidation.message);
  }
  const blockValidation = validateAgentPrivacyRuleInputs(params.blockPatterns, 'blockPatterns');
  if (!blockValidation.ok) {
    throw new Error(blockValidation.message);
  }

  const client = getSupabaseClient();
  const payload = {
    guild_id: params.guildId,
    enabled: params.enabled !== false,
    mode_default: params.modeDefault,
    review_score: Math.max(0, Math.min(100, Math.trunc(params.reviewScore))),
    block_score: Math.max(0, Math.min(100, Math.trunc(params.blockScore))),
    review_patterns: reviewValidation.rules,
    block_patterns: blockValidation.rules,
    updated_by: params.updatedBy || null,
  };

  const { data, error } = await client
    .from('agent_privacy_policies')
    .upsert(payload, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'AGENT_PRIVACY_POLICY_UPSERT_FAILED');
  }

  await refreshAgentPrivacyPolicyCache();
  return data;
};

import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv, parseNumberEnv, parseStringEnv } from '../utils/env';

import type { AutonomyLevelConfig } from './configCore';

// ──── Sprint Pipeline (Autonomous Agent) ────
export const SPRINT_ENABLED = parseBooleanEnv(process.env.SPRINT_ENABLED, true);
export const SPRINT_AUTONOMY_LEVEL = parseStringEnv(process.env.SPRINT_AUTONOMY_LEVEL, 'approve-ship') as AutonomyLevelConfig;
export const SPRINT_BUGFIX_AUTONOMY_LEVEL = parseStringEnv(process.env.SPRINT_BUGFIX_AUTONOMY_LEVEL, 'approve-ship') as AutonomyLevelConfig;
export const SPRINT_MAX_IMPL_REVIEW_LOOPS = parseIntegerEnv(process.env.SPRINT_MAX_IMPL_REVIEW_LOOPS, 3);
export const SPRINT_MAX_TOTAL_PHASES = parseIntegerEnv(process.env.SPRINT_MAX_TOTAL_PHASES, 12);
export const SPRINT_CHANGED_FILE_CAP = parseIntegerEnv(process.env.SPRINT_CHANGED_FILE_CAP, 10);
export const SPRINT_NEW_FILE_CAP = parseIntegerEnv(process.env.SPRINT_NEW_FILE_CAP, 3);
export const SPRINT_PHASE_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_PHASE_TIMEOUT_MS, 120_000);
export const SPRINT_TRIGGER_ERROR_THRESHOLD = parseIntegerEnv(process.env.SPRINT_TRIGGER_ERROR_THRESHOLD, 5);
export const SPRINT_TRIGGER_CS_CHANNEL_IDS = parseStringEnv(process.env.SPRINT_TRIGGER_CS_CHANNEL_IDS, '');
export const SPRINT_TRIGGER_CRON_SECURITY_AUDIT = parseStringEnv(process.env.SPRINT_TRIGGER_CRON_SECURITY_AUDIT, '');
export const SPRINT_TRIGGER_CRON_IMPROVEMENT = parseStringEnv(process.env.SPRINT_TRIGGER_CRON_IMPROVEMENT, '');
export const SPRINT_GIT_ENABLED = parseBooleanEnv(process.env.SPRINT_GIT_ENABLED, false);
export const SPRINT_GITHUB_TOKEN = parseStringEnv(process.env.SPRINT_GITHUB_TOKEN, '');
export const SPRINT_GITHUB_OWNER = parseStringEnv(process.env.SPRINT_GITHUB_OWNER, '');
export const SPRINT_GITHUB_REPO = parseStringEnv(process.env.SPRINT_GITHUB_REPO, '');
export const SPRINT_PIPELINES_TABLE = parseStringEnv(process.env.SPRINT_PIPELINES_TABLE, 'sprint_pipelines');
export const VENTYD_EVENTS_TABLE = parseStringEnv(process.env.VENTYD_EVENTS_TABLE, 'ventyd_events');
export const VENTYD_ENABLED = parseBooleanEnv(process.env.VENTYD_ENABLED, true);
export const SPRINT_DRY_RUN = parseBooleanEnv(process.env.SPRINT_DRY_RUN, false);
export const SPRINT_FAST_PATH_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_ENABLED, true);
export const SPRINT_FAST_PATH_VITEST_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_VITEST_TIMEOUT_MS, 60_000);
export const SPRINT_FAST_PATH_TSC_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_TSC_TIMEOUT_MS, 30_000);
export const SPRINT_FAST_PATH_SANDBOX_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_SANDBOX_ENABLED, false);
export const SPRINT_FAST_PATH_SANDBOX_ID = parseStringEnv(process.env.SPRINT_FAST_PATH_SANDBOX_ID, '');

// ──── Cross-Model Outside Voice ────
export const SPRINT_CROSS_MODEL_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_ENABLED, false);
export const SPRINT_CROSS_MODEL_PROVIDER = parseStringEnv(process.env.SPRINT_CROSS_MODEL_PROVIDER, '');
export const SPRINT_CROSS_MODEL_PHASES = parseStringEnv(process.env.SPRINT_CROSS_MODEL_PHASES, 'review,security-audit');
export const SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED, false);

// ──── Scope Guard (freeze/guard) ────
export const SPRINT_SCOPE_GUARD_ENABLED = parseBooleanEnv(process.env.SPRINT_SCOPE_GUARD_ENABLED, true);
export const SPRINT_SCOPE_GUARD_ALLOWED_DIRS = parseStringEnv(process.env.SPRINT_SCOPE_GUARD_ALLOWED_DIRS, 'src,scripts,tests,.github/skills');
export const SPRINT_SCOPE_GUARD_PROTECTED_FILES = parseStringEnv(process.env.SPRINT_SCOPE_GUARD_PROTECTED_FILES, 'package.json,.env,ecosystem.config.cjs,render.yaml');

// ──── LLM-as-Judge (Tier 3 eval) ────
export const SPRINT_LLM_JUDGE_ENABLED = parseBooleanEnv(process.env.SPRINT_LLM_JUDGE_ENABLED, false);
export const SPRINT_LLM_JUDGE_PHASES = parseStringEnv(process.env.SPRINT_LLM_JUDGE_PHASES, 'review,retro');

// ──── Autoplan Sub-Pipeline ────
export const SPRINT_AUTOPLAN_ENABLED = parseBooleanEnv(process.env.SPRINT_AUTOPLAN_ENABLED, false);
export const SPRINT_AUTOPLAN_LENSES = parseStringEnv(process.env.SPRINT_AUTOPLAN_LENSES, 'ceo,engineering,security');

// ──── Sprint Learning Journal ────
export const SPRINT_LEARNING_JOURNAL_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_ENABLED, true);
export const SPRINT_LEARNING_JOURNAL_GUILD_ID = parseStringEnv(process.env.SPRINT_LEARNING_JOURNAL_GUILD_ID, 'system');
export const SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW = parseMinIntEnv(process.env.SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW, 10, 3);
export const SPRINT_LEARNING_JOURNAL_LLM_RECONFIG_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_LLM_RECONFIG_ENABLED, true);
export const SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED, false);
const _rawMinConf = parseNumberEnv(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE, 75);
export const SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE = Math.max(0.5, Math.min(1, _rawMinConf > 1 ? _rawMinConf / 100 : _rawMinConf));

// ──── MCP Worker Fast-Fail ────
const _phaseTimeoutMs = parseIntegerEnv(process.env.SPRINT_PHASE_TIMEOUT_MS, 120_000);
const _fastFailRaw = parseIntegerEnv(process.env.MCP_FAST_FAIL_TIMEOUT_MS, 10_000);
export const MCP_FAST_FAIL_TIMEOUT_MS = Math.max(3_000, Math.min(_fastFailRaw, Math.floor(_phaseTimeoutMs * 0.5)));
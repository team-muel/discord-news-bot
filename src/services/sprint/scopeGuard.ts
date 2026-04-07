/**
 * Scope guard for autonomous sprint execution.
 *
 * Inspired by gstack's /freeze + /guard safety hooks:
 * - Restricts file edits to allowed directories
 * - Protects critical config files from modification
 * - Prevents accidental changes outside sprint scope
 */

import path from 'node:path';
import logger from '../../logger';
import {
  SPRINT_SCOPE_GUARD_ENABLED,
  SPRINT_SCOPE_GUARD_ALLOWED_DIRS,
  SPRINT_SCOPE_GUARD_PROTECTED_FILES,
  SPRINT_NEW_FILE_CAP,
} from '../../config';
import { parseCsvList } from '../../utils/env';

export type ScopeCheckResult = {
  allowed: boolean;
  reason?: string;
};

export type ScopeGuardSnapshot = {
  enabled: boolean;
  allowedDirs: string[];
  protectedFiles: string[];
  immutableSafetyFiles: string[];
  blockedAttempts: number;
  recentBlocked: Array<{ file: string; reason: string; at: string }>;
  newFileCap: number;
  newFilesCreated: Map<string, string[]>;
};

// ──── State ───────────────────────────────────────────────────────────────────

const ALLOWED_DIRS = parseCsvList(SPRINT_SCOPE_GUARD_ALLOWED_DIRS);

const PROTECTED_FILES = new Set(parseCsvList(SPRINT_SCOPE_GUARD_PROTECTED_FILES));

// ──── Immutable self-protection ───────────────────────────────────────────────
// Hardcoded list of safety-critical files that the autonomous pipeline must
// NEVER modify. This list is intentionally NOT configurable via environment
// variables — an agent that can reconfigure its own safety constraints can
// effectively disable them.
const IMMUTABLE_SAFETY_PATHS = new Set([
  'src/services/sprint/scopeGuard.ts',
  'src/services/sprint/sprintOrchestrator.ts',
  'src/services/sprint/sprintCodeWriter.ts',
  'src/services/sprint/autonomousGit.ts',
  'src/services/sprint/trustScoreService.ts',
  'src/services/sprint/selfImprovementLoop.ts',
  'src/config.ts',
]);

// Destructive patterns that should always be blocked
const DESTRUCTIVE_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s/i,
  /DROP\s+(TABLE|DATABASE)/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard/i,
  /truncate\s+table/i,
];

let blockedAttempts = 0;
const recentBlocked: Array<{ file: string; reason: string; at: string }> = [];

// ──── New-file creation tracking (per sprint) ─────────────────────────────────
// Tracks how many brand-new files each sprint has created.
// Prevents the common agent anti-pattern of creating 10+ new files instead of
// extending existing ones.

const newFilesPerSprint = new Map<string, string[]>();
const MAX_RECENT = 20;

const recordBlocked = (file: string, reason: string): void => {
  blockedAttempts++;
  recentBlocked.push({ file, reason, at: new Date().toISOString() });
  if (recentBlocked.length > MAX_RECENT) {
    recentBlocked.shift();
  }
  logger.warn('[SCOPE-GUARD] blocked: file=%s reason=%s', file, reason);
};

// ──── File scope check ────────────────────────────────────────────────────────

/**
 * Check if a file path is within the allowed scope for autonomous editing.
 */
export const checkFileScope = (filePath: string): ScopeCheckResult => {
  if (!SPRINT_SCOPE_GUARD_ENABLED) {
    return { allowed: true };
  }

  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalized);

  // Immutable self-protection: safety-critical files cannot be modified by
  // the autonomous pipeline regardless of env configuration
  const stripped = normalized.replace(/^\.\//, '');
  if (IMMUTABLE_SAFETY_PATHS.has(stripped)) {
    const reason = `Immutable safety file: ${basename}. Cannot be modified by autonomous pipeline.`;
    recordBlocked(filePath, reason);
    return { allowed: false, reason };
  }

  // Check protected files (env-configurable)
  if (PROTECTED_FILES.has(basename) || PROTECTED_FILES.has(normalized)) {
    const reason = `Protected file: ${basename}. Manual modification required.`;
    recordBlocked(filePath, reason);
    return { allowed: false, reason };
  }

  // Check directory allowlist
  if (ALLOWED_DIRS.length > 0) {
    const inAllowed = ALLOWED_DIRS.some((dir) =>
      normalized.startsWith(dir + '/') || normalized.startsWith('./' + dir + '/') || normalized === dir,
    );
    if (!inAllowed) {
      const reason = `File outside allowed directories [${ALLOWED_DIRS.join(', ')}]. Add the directory to SPRINT_SCOPE_GUARD_ALLOWED_DIRS if intentional.`;
      recordBlocked(filePath, reason);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
};

/**
 * Check if a set of changed files are all within scope. Returns the first violation.
 */
export const checkFilesScope = (files: string[]): ScopeCheckResult => {
  for (const file of files) {
    const result = checkFileScope(file);
    if (!result.allowed) {
      return result;
    }
  }
  return { allowed: true };
};

// ──── Command safety check ────────────────────────────────────────────────────

/**
 * Check if a shell command contains destructive patterns.
 * gstack's /careful equivalent.
 */
export const checkCommandSafety = (command: string): ScopeCheckResult => {
  if (!SPRINT_SCOPE_GUARD_ENABLED) {
    return { allowed: true };
  }

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      const reason = `Destructive command detected: "${command.slice(0, 80)}". This command requires manual execution.`;
      recordBlocked(command.slice(0, 80), reason);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
};

// ──── New-file creation gate ──────────────────────────────────────────────────

/**
 * Check if creating a new file is allowed within the sprint's new-file budget.
 * Returns allowed:true if the file already exists (modification, not creation)
 * or if the sprint hasn't hit its cap yet.
 *
 * Why: agents frequently create 10+ new files per sprint instead of extending
 * existing services. This gate forces reuse-first behavior.
 */
export const checkNewFileCreation = (
  sprintId: string,
  filePath: string,
  fileAlreadyExists: boolean,
): ScopeCheckResult => {
  if (!SPRINT_SCOPE_GUARD_ENABLED) return { allowed: true };
  if (fileAlreadyExists) return { allowed: true }; // modification, not creation

  const cap = SPRINT_NEW_FILE_CAP;
  const created = newFilesPerSprint.get(sprintId) ?? [];

  // Already tracked this file
  if (created.includes(filePath)) return { allowed: true };

  if (created.length >= cap) {
    const reason = `New-file cap reached (${created.length}/${cap}). Extend an existing file instead of creating "${filePath}". Override with SPRINT_NEW_FILE_CAP env var.`;
    recordBlocked(filePath, reason);
    return { allowed: false, reason };
  }

  // Track this new file
  created.push(filePath);
  newFilesPerSprint.set(sprintId, created);
  logger.info('[SCOPE-GUARD] new file %d/%d: %s (sprint=%s)', created.length, cap, filePath, sprintId);
  return { allowed: true };
};

/** Get how many new files a sprint has created so far. */
export const getNewFileCount = (sprintId: string): number =>
  (newFilesPerSprint.get(sprintId) ?? []).length;

/** Clear new-file tracking for a completed sprint. */
export const clearNewFileTracking = (sprintId: string): void => {
  newFilesPerSprint.delete(sprintId);
};

// ──── Snapshot ─────────────────────────────────────────────────────────────────

export const getScopeGuardSnapshot = (): ScopeGuardSnapshot => ({
  enabled: SPRINT_SCOPE_GUARD_ENABLED,
  allowedDirs: ALLOWED_DIRS,
  protectedFiles: Array.from(PROTECTED_FILES),
  immutableSafetyFiles: Array.from(IMMUTABLE_SAFETY_PATHS),
  blockedAttempts,
  recentBlocked: recentBlocked.slice(-10),
  newFileCap: SPRINT_NEW_FILE_CAP,
  newFilesCreated: newFilesPerSprint,
});

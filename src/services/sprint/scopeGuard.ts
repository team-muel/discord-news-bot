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
} from '../../config';

// ──── Types ───────────────────────────────────────────────────────────────────

export type ScopeCheckResult = {
  allowed: boolean;
  reason?: string;
};

export type ScopeGuardSnapshot = {
  enabled: boolean;
  allowedDirs: string[];
  protectedFiles: string[];
  blockedAttempts: number;
  recentBlocked: Array<{ file: string; reason: string; at: string }>;
};

// ──── State ───────────────────────────────────────────────────────────────────

const ALLOWED_DIRS = SPRINT_SCOPE_GUARD_ALLOWED_DIRS
  .split(',').map((d) => d.trim()).filter(Boolean);

const PROTECTED_FILES = new Set(
  SPRINT_SCOPE_GUARD_PROTECTED_FILES
    .split(',').map((f) => f.trim()).filter(Boolean),
);

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

  // Check protected files
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

// ──── Snapshot ─────────────────────────────────────────────────────────────────

export const getScopeGuardSnapshot = (): ScopeGuardSnapshot => ({
  enabled: SPRINT_SCOPE_GUARD_ENABLED,
  allowedDirs: ALLOWED_DIRS,
  protectedFiles: Array.from(PROTECTED_FILES),
  blockedAttempts,
  recentBlocked: recentBlocked.slice(-10),
});

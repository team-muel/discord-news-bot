import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SANDBOX_ROOT = path.join(os.tmpdir(), 'muel-worker-sandbox');

// ─── Security scanner ─────────────────────────────────────────────────────────

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\beval\s*\(/, reason: 'eval() is not allowed' },
  { pattern: /new\s+Function\s*\(/, reason: 'new Function() is not allowed' },
  { pattern: /require\s*\(\s*['"]child_process['"]/, reason: 'child_process import is not allowed' },
  { pattern: /\bspawnSync\b|\bexecSync\b|\bexecFileSync\b/, reason: 'sync process execution is not allowed' },
  { pattern: /process\.env\s*\[/, reason: 'dynamic env key access is not allowed' },
  { pattern: /\bfs\s*\.\s*(rm|rmdir|unlink|writeFile|appendFile|chmod|chown)\b/, reason: 'filesystem mutation is not allowed' },
  { pattern: /process\.exit\s*\(/, reason: 'process.exit() is not allowed' },
  { pattern: /import\s*\(\s*['"`][^'"`]*\.\.[/\\]/, reason: 'path traversal in dynamic import is not allowed' },
  { pattern: /\bsetInterval\b|\bsetTimeout\b/, reason: 'timer creation inside execute() is not allowed' },
];

// ─── Structure validator ──────────────────────────────────────────────────────

const EXPORT_PATTERN = /export\s+(const|let|var)\s+\w+\s*=/;
const EXECUTE_PATTERN = /execute\s*:\s*async\s*(function|\()/;
const ACTION_NAME_PATTERN = /name\s*:\s*['"`][a-z][a-z0-9._-]+['"`]/;

export type SandboxValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export const validateSandboxCode = (code: string): SandboxValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(code)) errors.push(reason);
  }

  if (!EXPORT_PATTERN.test(code)) errors.push('no exported variable found (expected: export const action = {...})');
  if (!ACTION_NAME_PATTERN.test(code)) errors.push('action must have a name property (e.g. name: "my.action")');
  if (!EXECUTE_PATTERN.test(code)) errors.push('action must have an execute: async function property');

  if (code.length > 24_000) warnings.push('generated code is unusually large (>24 KB)');
  if (code.length < 80) warnings.push('generated code is suspiciously small (<80 chars)');

  return { ok: errors.length === 0, errors, warnings };
};

// ─── File I/O ────────────────────────────────────────────────────────────────

export type SandboxWriteResult = {
  sandboxDir: string;
  filePath: string;
};

export const writeSandboxFile = async (code: string): Promise<SandboxWriteResult> => {
  const id = crypto.randomUUID();
  const sandboxDir = path.join(SANDBOX_ROOT, id);
  await fs.mkdir(sandboxDir, { recursive: true });
  const filePath = path.join(sandboxDir, 'worker.mjs');
  await fs.writeFile(filePath, code, 'utf-8');
  return { sandboxDir, filePath };
};

export const cleanupSandbox = async (sandboxDir: string): Promise<void> => {
  try {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
};

/** Read the mjs file back (useful for admin display). */
export const readSandboxFile = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
};

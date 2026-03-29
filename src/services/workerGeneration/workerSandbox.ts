import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SANDBOX_ROOT = path.join(os.tmpdir(), 'muel-worker-sandbox');

// ─── Security scanner ─────────────────────────────────────────────────────────

/**
 * Dangerous Node.js built-in modules that must never be imported (static or dynamic).
 * Static ESM imports like `import { exec } from 'child_process'` bypass `require()` checks.
 */
const DANGEROUS_MODULES = [
  'child_process', 'cluster', 'dgram', 'dns', 'http', 'http2', 'https',
  'net', 'tls', 'vm', 'worker_threads', 'perf_hooks', 'async_hooks',
  'module', 'repl', 'inspector',
];
const dangerousModulePattern = new RegExp(
  `(?:import\\s+.*?from\\s+|import\\s*\\(|require\\s*\\(\\s*)['"\`](?:node:)?(?:${DANGEROUS_MODULES.join('|')})['"\`]`,
);

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // ── Eval / Function constructor (including aliasing) ──
  { pattern: /\beval\b/, reason: 'eval is not allowed (including aliased references)' },
  { pattern: /\bFunction\b/, reason: 'Function constructor access is not allowed' },
  // ── Module system ──
  { pattern: dangerousModulePattern, reason: 'importing dangerous built-in modules is not allowed' },
  { pattern: /import\s*\(/, reason: 'dynamic import() is not allowed' },
  { pattern: /\bcreateRequire\b/, reason: 'createRequire is not allowed' },
  { pattern: /\brequire\b/, reason: 'require() is not allowed' },
  // ── Process / execution ──
  { pattern: /\bspawnSync\b|\bexecSync\b|\bexecFileSync\b|\bspawn\s*\(|\bexecFile\s*\(/, reason: 'process execution is not allowed' },
  { pattern: /child_process|\.exec\s*\(/, reason: 'child_process exec is not allowed' },
  { pattern: /process\.env/, reason: 'process.env access is not allowed' },
  { pattern: /process\s*\[/, reason: 'dynamic process property access is not allowed' },
  { pattern: /process\.exit\s*\(/, reason: 'process.exit() is not allowed' },
  { pattern: /process\.binding\b/, reason: 'process.binding is not allowed' },
  // ── Filesystem mutation ──
  { pattern: /\bfs\s*\.\s*(rm|rmdir|unlink|writeFile|appendFile|chmod|chown)\b/, reason: 'filesystem mutation is not allowed' },
  // ── Timers ──
  { pattern: /\bsetInterval\b|\bsetTimeout\b/, reason: 'timer creation inside execute() is not allowed' },
  // ── Global / prototype chain escapes ──
  { pattern: /\bglobalThis\b/, reason: 'globalThis access is not allowed' },
  { pattern: /\bglobal\s*[.\[]/, reason: 'global object access is not allowed' },
  { pattern: /\bReflect\b/, reason: 'Reflect API is not allowed' },
  { pattern: /\.constructor\b/, reason: '.constructor chain access is not allowed' },
  { pattern: /\.__proto__\b/, reason: '__proto__ access is not allowed' },
  { pattern: /Object\s*\.\s*getPrototypeOf/, reason: 'prototype traversal is not allowed' },
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

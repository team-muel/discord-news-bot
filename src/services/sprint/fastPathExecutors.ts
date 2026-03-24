/**
 * Fast-path (deterministic) executors for sprint phases that don't need LLM.
 *
 * These run subprocess commands directly and map exit codes to PhaseResult,
 * achieving ~100-500ms latency with zero token overhead.
 *
 * Phases covered:
 *   - qa        → vitest run
 *   - ops-validate → tsc --noEmit
 *   - ship      → autonomousGit (branch + commit + PR)
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../logger';
import type { CodeChange } from './sprintCodeWriter';
import {
  SPRINT_FAST_PATH_ENABLED,
  SPRINT_FAST_PATH_VITEST_TIMEOUT_MS,
  SPRINT_FAST_PATH_TSC_TIMEOUT_MS,
} from '../../config';
import { createSprintBranch, commitSprintChanges, createSprintPr } from './autonomousGit';
import type { SprintPhase } from './sprintOrchestrator';
import type { ActionExecutionResult } from '../skills/actions/types';

// ──── Subprocess helper ───────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

type SubprocessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const runCommand = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<SubprocessResult> => {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      shell: true,
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = error && 'code' in error ? (error.code as number ?? 1) : error ? 1 : 0;
      resolve({
        exitCode,
        stdout: String(stdout || '').slice(0, 4000),
        stderr: String(stderr || '').slice(0, 4000),
        durationMs,
      });
    });
  });
};

// ──── QA fast-path: vitest run ────────────────────────────────────────────────

const executeQaFastPath = async (
  objective: string,
  changedFiles: string[],
): Promise<ActionExecutionResult> => {
  logger.info('[FAST-PATH] qa: running vitest');
  const result = await runCommand('npx', ['vitest', 'run', '--reporter=verbose'], SPRINT_FAST_PATH_VITEST_TIMEOUT_MS);

  const passed = result.exitCode === 0;
  const output = result.stdout || result.stderr;

  // Extract test summary from vitest output
  const summaryMatch = output.match(/Tests\s+(\d+\s+passed.*)/i)
    || output.match(/(✓|✗).*test/gi);
  const summary = summaryMatch
    ? summaryMatch[0].slice(0, 500)
    : `exit code ${result.exitCode}`;

  return {
    ok: passed,
    name: 'qa.test',
    summary: passed
      ? `QA PASSED (${result.durationMs}ms): ${summary}`
      : `QA FAILED (${result.durationMs}ms): ${summary}`,
    artifacts: [
      `# Vitest Results (deterministic fast-path)\n\n` +
      `- exit_code: ${result.exitCode}\n` +
      `- duration: ${result.durationMs}ms\n` +
      `- changed_files: ${changedFiles.length}\n\n` +
      `## Output\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\``,
    ],
    verification: passed
      ? ['vitest exit code 0', 'all tests passed']
      : [`vitest exit code ${result.exitCode}`, 'test failures detected'],
    durationMs: result.durationMs,
    agentRole: 'implement',
  };
};

// ──── Ops-validate fast-path: tsc --noEmit ────────────────────────────────────

const executeOpsValidateFastPath = async (
  objective: string,
  changedFiles: string[],
): Promise<ActionExecutionResult> => {
  logger.info('[FAST-PATH] ops-validate: running tsc --noEmit');
  const result = await runCommand('npx', ['tsc', '--noEmit'], SPRINT_FAST_PATH_TSC_TIMEOUT_MS);

  const passed = result.exitCode === 0;
  const errorLines = result.stdout.split('\n').filter((l) => l.includes('error TS'));
  const errorCount = errorLines.length;

  return {
    ok: passed,
    name: 'operate.ops',
    summary: passed
      ? `OPS-VALIDATE PASSED (${result.durationMs}ms): tsc --noEmit clean`
      : `OPS-VALIDATE FAILED (${result.durationMs}ms): ${errorCount} type error(s)`,
    artifacts: [
      `# TypeCheck Results (deterministic fast-path)\n\n` +
      `- exit_code: ${result.exitCode}\n` +
      `- duration: ${result.durationMs}ms\n` +
      `- type_errors: ${errorCount}\n\n` +
      (errorCount > 0
        ? `## Errors\n\`\`\`\n${errorLines.slice(0, 20).join('\n')}\n\`\`\``
        : '## Result\nNo type errors found.'),
    ],
    verification: passed
      ? ['tsc exit code 0', 'no type errors']
      : [`tsc exit code ${result.exitCode}`, `${errorCount} type error(s)`],
    durationMs: result.durationMs,
    agentRole: 'operate',
  };
};

// ──── Ship fast-path: git branch + commit + PR ────────────────────────────────

const executeShipFastPath = async (
  sprintId: string,
  objective: string,
  changedFiles: string[],
  codeChanges?: CodeChange[],
): Promise<ActionExecutionResult> => {
  logger.info('[FAST-PATH] ship: creating branch + commit + PR');
  const start = Date.now();

  // 1. Create branch
  const branch = await createSprintBranch(sprintId);
  if (!branch.ok) {
    return {
      ok: false,
      name: 'release.ship',
      summary: `Ship failed: ${branch.error}`,
      artifacts: [],
      verification: ['branch creation failed'],
      error: branch.error,
      durationMs: Date.now() - start,
      agentRole: 'operate',
    };
  }

  // 2. Commit changes
  const commit = await commitSprintChanges({
    branchName: branch.branchName,
    message: `sprint(${sprintId}): ${objective.slice(0, 72)}`,
    files: await Promise.all(changedFiles.map(async (f) => {
      // Prefer content from codeChanges (authoritative), fall back to disk read
      const fromChanges = codeChanges?.find((c) => c.filePath === f);
      if (fromChanges) return { path: f, content: fromChanges.newContent };
      try {
        const content = await fs.readFile(path.resolve(PROJECT_ROOT, f), 'utf-8');
        return { path: f, content };
      } catch {
        logger.warn('[FAST-PATH] ship: cannot read file %s, skipping', f);
        return { path: f, content: '' };
      }
    })),
  });
  if (!commit.ok) {
    return {
      ok: false,
      name: 'release.ship',
      summary: `Ship failed at commit: ${commit.error}`,
      artifacts: [`branch: ${branch.branchName}`],
      verification: ['commit failed'],
      error: commit.error,
      durationMs: Date.now() - start,
      agentRole: 'operate',
    };
  }

  // 3. Create PR
  const pr = await createSprintPr({
    branchName: branch.branchName,
    title: `[Sprint] ${objective.slice(0, 120)}`,
    body: [
      `## Sprint: ${sprintId}`,
      '',
      `**Objective**: ${objective}`,
      '',
      `### Changed Files (${changedFiles.length})`,
      ...changedFiles.map((f) => `- \`${f}\``),
      '',
      `_Automated by sprint pipeline (deterministic ship)_`,
    ].join('\n'),
  });

  const durationMs = Date.now() - start;

  if (!pr.ok) {
    return {
      ok: false,
      name: 'release.ship',
      summary: `Ship failed at PR: ${pr.error}`,
      artifacts: [`branch: ${branch.branchName}`, `commit: ${commit.sha}`],
      verification: ['PR creation failed'],
      error: pr.error,
      durationMs,
      agentRole: 'operate',
    };
  }

  return {
    ok: true,
    name: 'release.ship',
    summary: `Ship completed (${durationMs}ms): ${pr.prUrl}`,
    artifacts: [
      `# Ship Report (deterministic fast-path)\n\n` +
      `- branch: ${branch.branchName}\n` +
      `- commit: ${commit.sha}\n` +
      `- pr: ${pr.prUrl}\n` +
      `- pr_number: ${pr.prNumber}\n` +
      `- duration: ${durationMs}ms\n` +
      `- changed_files: ${changedFiles.length}`,
    ],
    verification: ['branch created', 'changes committed', 'PR opened'],
    durationMs,
    agentRole: 'operate',
  };
};

// ──── Public API ──────────────────────────────────────────────────────────────

/** Phases that support deterministic (zero-LLM) execution */
export const DETERMINISTIC_PHASES = new Set<SprintPhase>(['qa', 'ops-validate', 'ship']);

/** Check if a phase can run deterministically */
export const isDeterministicPhase = (phase: SprintPhase): boolean =>
  SPRINT_FAST_PATH_ENABLED && DETERMINISTIC_PHASES.has(phase);

/**
 * Execute a sprint phase deterministically — no LLM tokens consumed.
 * Returns null if the phase is not supported for fast-path.
 */
export const executeFastPath = async (params: {
  phase: SprintPhase;
  sprintId: string;
  objective: string;
  changedFiles: string[];
  codeChanges?: CodeChange[];
}): Promise<ActionExecutionResult | null> => {
  if (!SPRINT_FAST_PATH_ENABLED) return null;

  switch (params.phase) {
    case 'qa':
      return executeQaFastPath(params.objective, params.changedFiles);
    case 'ops-validate':
      return executeOpsValidateFastPath(params.objective, params.changedFiles);
    case 'ship':
      return executeShipFastPath(params.sprintId, params.objective, params.changedFiles, params.codeChanges);
    default:
      return null;
  }
};

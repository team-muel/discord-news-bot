/**
 * Sprint Code Writer — the missing piece for genuine self-modification.
 *
 * Given a sprint objective and context, this module:
 * 1. Reads targeted source files from the working tree
 * 2. Asks the LLM to generate concrete code changes (unified diff format)
 * 3. Applies the changes to the working tree via fs.writeFile
 * 4. Returns the list of changed files for downstream phases (review, qa, ship)
 *
 * Safety: all writes go through scopeGuard.checkFileScope() before touching disk.
 */

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../../logger';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { checkFileScope } from './scopeGuard';
import { SPRINT_CHANGED_FILE_CAP, SPRINT_DRY_RUN } from '../../config';

const resolveProjectRoot = (): string => {
  const cwdRoot = path.resolve(process.cwd());
  if (existsSync(path.join(cwdRoot, 'package.json'))) return cwdRoot;
  const fallbackRoot = path.resolve(__dirname, '../../..');
  if (existsSync(path.join(fallbackRoot, 'package.json'))) return fallbackRoot;
  return cwdRoot;
};

const PROJECT_ROOT = resolveProjectRoot();

const MAX_FILE_READ_BYTES = 12_000;
const MAX_CONTEXT_FILES = 8;

// ──── Types ───────────────────────────────────────────────────────────────────

export type CodeChange = {
  filePath: string;
  originalContent: string;
  newContent: string;
};

export type CodeWriterResult = {
  ok: boolean;
  changes: CodeChange[];
  summary: string;
  error?: string;
};

// ──── File I/O helpers ────────────────────────────────────────────────────────

const readProjectFile = async (relativePath: string): Promise<string | null> => {
  try {
    const abs = path.resolve(PROJECT_ROOT, relativePath);
    // Prevent path traversal
    if (!abs.startsWith(PROJECT_ROOT)) return null;
    const content = await fs.readFile(abs, 'utf-8');
    return content.slice(0, MAX_FILE_READ_BYTES);
  } catch {
    return null;
  }
};

const writeProjectFile = async (relativePath: string, content: string): Promise<{ ok: boolean; error?: string }> => {
  // Scope guard check
  const scope = checkFileScope(relativePath);
  if (!scope.allowed) {
    return { ok: false, error: scope.reason };
  }

  const abs = path.resolve(PROJECT_ROOT, relativePath);
  // Prevent path traversal
  if (!abs.startsWith(PROJECT_ROOT)) {
    return { ok: false, error: 'Path traversal blocked' };
  }

  try {
    await fs.writeFile(abs, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ──── LLM-based code modification ─────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You are a code modification agent for a TypeScript Discord bot platform.',
  'Given an objective and source file contents, output ONLY the modified files.',
  '',
  'Output format (strict):',
  'For each file you modify, output:',
  '===FILE: <relative-path>===',
  '<entire new file content>',
  '===END===',
  '',
  'Rules:',
  '- Output the COMPLETE file content for each changed file, not just the diff.',
  '- Only output files you actually changed. Do not output unchanged files.',
  '- Preserve existing imports, types, and exports unless the change requires removing them.',
  '- Do not add unnecessary comments or documentation beyond what exists.',
  '- Keep changes minimal and focused on the objective.',
  '- If you cannot accomplish the objective safely, output: ===CANNOT_MODIFY=== followed by the reason.',
  '- Maximum files per change: ' + SPRINT_CHANGED_FILE_CAP,
].join('\n');

const buildUserPrompt = (
  objective: string,
  context: Array<{ path: string; content: string }>,
  previousOutput?: string,
): string => {
  const sections = [
    `## Objective\n${objective}`,
    '',
    '## Source Files',
  ];

  for (const file of context) {
    sections.push(`\n### ${file.path}\n\`\`\`typescript\n${file.content}\n\`\`\``);
  }

  if (previousOutput) {
    sections.push(`\n## Previous Phase Output\n${previousOutput.slice(0, 2000)}`);
  }

  sections.push('\n## Instructions\nModify the source files above to achieve the objective. Output modified files using the ===FILE:=== format.');

  return sections.join('\n');
};

// ──── Response parser ─────────────────────────────────────────────────────────

const parseCodeWriterResponse = (raw: string): Array<{ path: string; content: string }> => {
  if (raw.includes('===CANNOT_MODIFY===')) {
    return [];
  }

  const files: Array<{ path: string; content: string }> = [];
  const pattern = /===FILE:\s*(.+?)\s*===([\s\S]*?)===END===/g;
  let match;

  while ((match = pattern.exec(raw)) !== null) {
    const filePath = match[1].trim();
    let content = match[2];
    // Strip leading/trailing whitespace and optional code fence
    content = content.replace(/^\s*```\w*\n?/, '').replace(/\n?```\s*$/, '').trim();
    if (filePath && content) {
      files.push({ path: filePath, content });
    }
  }

  return files;
};

// ──── Context gathering ───────────────────────────────────────────────────────

/**
 * Infer which files are relevant to the objective by keyword matching.
 * This is a simple heuristic — a more advanced version could use the LLM.
 */
const inferRelevantFiles = async (objective: string, changedFiles: string[]): Promise<string[]> => {
  // Start with any already-changed files
  const candidates = new Set(changedFiles);

  // Extract file paths mentioned in the objective
  const filePathPattern = /(?:src\/|scripts\/|config\/)[a-zA-Z0-9_/.\\-]+\.(?:ts|js|mjs|json|yaml|yml|md)/g;
  const mentioned = objective.match(filePathPattern);
  if (mentioned) {
    for (const f of mentioned) {
      candidates.add(f.replace(/\\/g, '/'));
    }
  }

  // If objective mentions specific modules, add their paths
  const moduleHints: Record<string, string[]> = {
    'sprint': ['src/services/sprint/sprintOrchestrator.ts'],
    'llm': ['src/services/llmClient.ts'],
    'obsidian': ['src/services/obsidianRagService.ts'],
    'worker': ['src/services/workerGeneration/workerGenerationPipeline.ts'],
    'automation': ['src/services/automationBot.ts'],
    'discord': ['src/bot.ts'],
    'config': ['src/config.ts'],
  };

  const lowerObj = objective.toLowerCase();
  for (const [keyword, files] of Object.entries(moduleHints)) {
    if (lowerObj.includes(keyword)) {
      for (const f of files) candidates.add(f);
    }
  }

  // Verify files exist and are readable
  const verified: string[] = [];
  for (const f of candidates) {
    const content = await readProjectFile(f);
    if (content !== null) verified.push(f);
    if (verified.length >= MAX_CONTEXT_FILES) break;
  }

  return verified;
};

// ──── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate and apply code modifications to achieve the sprint objective.
 *
 * Flow:
 * 1. Gather relevant source files
 * 2. Ask LLM for modifications
 * 3. Parse response into file changes
 * 4. Apply changes through scope guard
 * 5. Return change list for downstream phases
 */
export const generateAndApplyCodeChanges = async (params: {
  objective: string;
  changedFiles: string[];
  previousPhaseOutput?: string;
  sprintId: string;
}): Promise<CodeWriterResult> => {
  if (SPRINT_DRY_RUN) {
    logger.info('[SPRINT-CODE-WRITER][DRY-RUN] would generate code changes for sprint=%s (skipped)', params.sprintId);
    return { ok: false, changes: [], summary: 'Dry-run mode: code modification skipped', error: 'DRY_RUN' };
  }

  if (!isAnyLlmConfigured()) {
    return { ok: false, changes: [], summary: 'No LLM configured for code generation', error: 'LLM_NOT_CONFIGURED' };
  }

  // 1. Gather context files
  const relevantFiles = await inferRelevantFiles(params.objective, params.changedFiles);
  if (relevantFiles.length === 0) {
    return {
      ok: false,
      changes: [],
      summary: 'Could not identify relevant source files for modification',
      error: 'NO_RELEVANT_FILES',
    };
  }

  const contextFiles: Array<{ path: string; content: string }> = [];
  for (const filePath of relevantFiles) {
    const content = await readProjectFile(filePath);
    if (content) {
      contextFiles.push({ path: filePath, content });
    }
  }

  logger.info('[SPRINT-CODE-WRITER] generating changes for sprint=%s context_files=%d', params.sprintId, contextFiles.length);

  // 2. Ask LLM for modifications
  let llmResponse: string;
  try {
    llmResponse = await generateText({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(params.objective, contextFiles, params.previousPhaseOutput),
      actionName: 'sprint.code.write',
      temperature: 0.1,
      maxTokens: 4000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, changes: [], summary: `LLM code generation failed: ${msg}`, error: 'LLM_GENERATION_FAILED' };
  }

  // 3. Parse response
  const parsedFiles = parseCodeWriterResponse(llmResponse);
  if (parsedFiles.length === 0) {
    // Check if LLM explicitly refused
    if (llmResponse.includes('===CANNOT_MODIFY===')) {
      const reason = llmResponse.split('===CANNOT_MODIFY===')[1]?.trim().slice(0, 500) || 'Unknown reason';
      return { ok: false, changes: [], summary: `Code modification declined: ${reason}`, error: 'CANNOT_MODIFY' };
    }
    return { ok: false, changes: [], summary: 'LLM response contained no parseable file changes', error: 'NO_CHANGES_PARSED' };
  }

  // 4. Cap check
  if (parsedFiles.length > SPRINT_CHANGED_FILE_CAP) {
    return {
      ok: false,
      changes: [],
      summary: `Too many files changed (${parsedFiles.length} > cap ${SPRINT_CHANGED_FILE_CAP})`,
      error: 'CHANGED_FILE_CAP_EXCEEDED',
    };
  }

  // 5. Apply changes through scope guard
  const changes: CodeChange[] = [];
  const errors: string[] = [];

  for (const file of parsedFiles) {
    const original = await readProjectFile(file.path);
    if (original === null) {
      errors.push(`Cannot read original: ${file.path}`);
      continue;
    }

    // Skip if content is identical
    if (original.trimEnd() === file.content.trimEnd()) {
      logger.debug('[SPRINT-CODE-WRITER] skipping unchanged file: %s', file.path);
      continue;
    }

    const writeResult = await writeProjectFile(file.path, file.content);
    if (!writeResult.ok) {
      errors.push(`Write blocked: ${file.path} — ${writeResult.error}`);
      continue;
    }

    changes.push({
      filePath: file.path,
      originalContent: original,
      newContent: file.content,
    });

    logger.info('[SPRINT-CODE-WRITER] modified: %s (original=%d bytes, new=%d bytes)', file.path, original.length, file.content.length);
  }

  if (changes.length === 0 && errors.length > 0) {
    return {
      ok: false,
      changes: [],
      summary: `All file writes failed: ${errors.join('; ')}`,
      error: 'ALL_WRITES_FAILED',
    };
  }

  if (changes.length === 0) {
    return {
      ok: true,
      changes: [],
      summary: 'No code changes were necessary',
    };
  }

  const summary = [
    `Modified ${changes.length} file(s): ${changes.map((c) => c.filePath).join(', ')}`,
    errors.length > 0 ? `Warnings: ${errors.join('; ')}` : '',
  ].filter(Boolean).join('. ');

  return { ok: true, changes, summary };
};

/**
 * Rollback changes by restoring original content.
 * Called when review or QA fails.
 */
export const rollbackCodeChanges = async (changes: CodeChange[]): Promise<void> => {
  for (const change of changes) {
    try {
      const abs = path.resolve(PROJECT_ROOT, change.filePath);
      if (!abs.startsWith(PROJECT_ROOT)) continue;
      await fs.writeFile(abs, change.originalContent, 'utf-8');
      logger.info('[SPRINT-CODE-WRITER] rolled back: %s', change.filePath);
    } catch (err) {
      logger.warn('[SPRINT-CODE-WRITER] rollback failed for %s: %s', change.filePath, err instanceof Error ? err.message : String(err));
    }
  }
};

/**
 * Sprint Diff Summarizer — structural code change summary for truncation-resilient review.
 *
 * Extracts signatures (exports, imports, functions, classes) from before/after code
 * to maximize information density within prompt character limits.
 * Uses regex-only — no AST parser dependency.
 */

import type { CodeChange } from './sprintCodeWriter';

// ──── Signature extraction (regex-based, no AST) ─────────────────────────────

const EXPORT_RE = /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/gm;
const IMPORT_RE = /^import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/gm;
const FUNCTION_SIG_RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\n{]+))?/gm;
const CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\n{]+))?/gm;
const ARROW_EXPORT_RE = /^export\s+const\s+(\w+)\s*(?::\s*([^=]+?))?\s*=/gm;

type SignatureSet = {
  exports: string[];
  imports: string[];
  functions: string[];
  classes: string[];
};

const extractSignatures = (code: string): SignatureSet => {
  const exports: string[] = [];
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  let m: RegExpExecArray | null;

  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(code))) exports.push(m[1]);

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) imports.push(m[1]);

  FUNCTION_SIG_RE.lastIndex = 0;
  while ((m = FUNCTION_SIG_RE.exec(code))) {
    const ret = m[3]?.trim() || 'void';
    functions.push(`${m[1]}(${m[2].trim()}) → ${ret}`);
  }

  ARROW_EXPORT_RE.lastIndex = 0;
  while ((m = ARROW_EXPORT_RE.exec(code))) {
    const type = m[2]?.trim();
    functions.push(type ? `${m[1]}: ${type}` : m[1]);
  }

  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(code))) {
    let desc = m[1];
    if (m[2]) desc += ` extends ${m[2]}`;
    if (m[3]) desc += ` implements ${m[3].trim()}`;
    classes.push(desc);
  }

  return { exports, imports, functions, classes };
};

// ──── Diff computation ───────────────────────────────────────────────────────

const setDiff = (before: string[], after: string[]): { added: string[]; removed: string[] } => {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((x) => !beforeSet.has(x)),
    removed: before.filter((x) => !afterSet.has(x)),
  };
};

// ──── Public API ─────────────────────────────────────────────────────────────

export type StructuralSummary = {
  filePath: string;
  stats: { linesAdded: number; linesRemoved: number; totalNewLines: number };
  signatureChanges: string[];
  /** Top portion of new content, for detailed review within budget */
  headContent: string;
};

/**
 * Summarize a single code change structurally.
 * @param change — CodeChange from sprintCodeWriter
 * @param headBudget — character budget for the head content snippet (default 1200)
 */
export const summarizeChange = (change: CodeChange, headBudget = 1200): StructuralSummary => {
  const oldLines = change.originalContent.split('\n');
  const newLines = change.newContent.split('\n');

  const oldSigs = extractSignatures(change.originalContent);
  const newSigs = extractSignatures(change.newContent);

  const changes: string[] = [];

  const exportDiff = setDiff(oldSigs.exports, newSigs.exports);
  for (const e of exportDiff.added) changes.push(`+ export ${e}`);
  for (const e of exportDiff.removed) changes.push(`- export ${e}`);

  const importDiff = setDiff(oldSigs.imports, newSigs.imports);
  for (const i of importDiff.added) changes.push(`+ import from '${i}'`);
  for (const i of importDiff.removed) changes.push(`- import from '${i}'`);

  const funcDiff = setDiff(oldSigs.functions, newSigs.functions);
  for (const f of funcDiff.added) changes.push(`+ fn ${f}`);
  for (const f of funcDiff.removed) changes.push(`- fn ${f}`);

  const classDiff = setDiff(oldSigs.classes, newSigs.classes);
  for (const c of classDiff.added) changes.push(`+ class ${c}`);
  for (const c of classDiff.removed) changes.push(`- class ${c}`);

  return {
    filePath: change.filePath,
    stats: {
      linesAdded: Math.max(0, newLines.length - oldLines.length),
      linesRemoved: Math.max(0, oldLines.length - newLines.length),
      totalNewLines: newLines.length,
    },
    signatureChanges: changes,
    headContent: change.newContent.slice(0, headBudget),
  };
};

/**
 * Build a structured diff section for prompt injection.
 * Replaces raw `.slice(0, 1500)` with signature-aware summary + head content.
 *
 * Budget allocation per file:
 *   ~300 chars for signature summary + stats
 *   ~1200 chars for head content
 *   = ~1500 chars total (same budget, 3× information density)
 */
export const buildStructuralDiffSection = (
  codeChanges: CodeChange[],
  totalBudget = 12_000,
): string => {
  if (codeChanges.length === 0) return '';

  const perFileBudget = Math.max(800, Math.floor(totalBudget / codeChanges.length));
  const headBudget = Math.max(400, perFileBudget - 300);

  const sections: string[] = ['[CODE_DIFFS] Structural summary of code modifications:'];

  for (const change of codeChanges) {
    const summary = summarizeChange(change, headBudget);
    const lines: string[] = [`\n### ${summary.filePath}`];
    lines.push(`Lines: +${summary.stats.linesAdded} -${summary.stats.linesRemoved} (total ${summary.stats.totalNewLines})`);

    if (summary.signatureChanges.length > 0) {
      lines.push('**Signature changes:**');
      lines.push(summary.signatureChanges.slice(0, 15).join('\n'));
    }

    if (summary.headContent) {
      lines.push(`**Modified code (head):**\n\`\`\`typescript\n${summary.headContent}\n\`\`\``);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n');
};

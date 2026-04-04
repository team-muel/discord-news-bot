/**
 * Security Candidate Generator
 *
 * Static analysis scanner for TypeScript/Express codebases.
 * Inspired by Toss tech blog's SAST → JSONL pipeline approach.
 *
 * Scans source files for untrusted input flows (Express req.params, req.query,
 * req.body, req.headers) and traces them to potentially dangerous sinks
 * (SQL interpolation, path manipulation, command execution, eval, unsanitized output).
 *
 * Output: JSONL file at tmp/security-candidates/latest.jsonl
 *
 * Usage:
 *   npx tsx scripts/generate-security-candidates.ts [--repo-root=.] [--output=tmp/security-candidates/latest.jsonl]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ──── Types ────────────────────────────────────────────────────────────────────

type CandidateKind =
  | 'untrusted-input-review'
  | 'output-boundary-review'
  | 'command-boundary-review'
  | 'path-boundary-review'
  | 'auth-boundary-review'
  | 'policy-boundary-review';

type SecurityCandidate = {
  id: string;
  commitSha: string;
  filePath: string;
  startLine: number;
  endLine: number;
  codeSnippet: string;
  ruleId: string;
  fingerprint: string;
  candidateKind: CandidateKind;
  sourceKind?: string;
  sinkKind?: string;
  symbolName?: string;
};

type ScanRule = {
  id: string;
  candidateKind: CandidateKind;
  sourcePattern: RegExp;
  sinkPattern?: RegExp;
  sourceKind: string;
  sinkKind?: string;
  description: string;
};

// ──── Config ───────────────────────────────────────────────────────────────────

const INDEXED_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);
const EXCLUDED_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules', '.venv', 'tmp']);
const CONTEXT_LINES_BEFORE = 2;
const CONTEXT_LINES_AFTER = 2;

// ──── Rules ────────────────────────────────────────────────────────────────────

const SCAN_RULES: ScanRule[] = [
  // Untrusted input → general sink (Express)
  {
    id: 'ts-express-req-params',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /\breq\.params\b/,
    sourceKind: 'express.req.params',
    description: 'Express route parameter accessed without validation',
  },
  {
    id: 'ts-express-req-query',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /\breq\.query\b/,
    sourceKind: 'express.req.query',
    description: 'Express query parameter accessed',
  },
  {
    id: 'ts-express-req-body',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /\breq\.body\b/,
    sourceKind: 'express.req.body',
    description: 'Express request body accessed',
  },
  {
    id: 'ts-express-req-headers',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /\breq\.headers\b/,
    sourceKind: 'express.req.headers',
    description: 'Express request headers accessed directly',
  },

  // Command injection boundaries
  {
    id: 'ts-command-exec',
    candidateKind: 'command-boundary-review',
    sourcePattern: /\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    sourceKind: 'child_process',
    sinkKind: 'os.command',
    description: 'Child process execution — potential command injection',
  },
  {
    id: 'ts-eval-usage',
    candidateKind: 'command-boundary-review',
    sourcePattern: /\b(?:eval|Function)\s*\(/,
    sourceKind: 'eval',
    sinkKind: 'code.execution',
    description: 'eval() or new Function() usage — potential code injection',
  },

  // Path traversal boundaries
  {
    id: 'ts-path-join-dynamic',
    candidateKind: 'path-boundary-review',
    sourcePattern: /path\.(?:join|resolve)\s*\([^)]*(?:req\.|args\.|params\.|query\.|input\.|user)/,
    sourceKind: 'path.manipulation',
    sinkKind: 'filesystem',
    description: 'Path construction with potentially untrusted input',
  },
  {
    id: 'ts-fs-read-dynamic',
    candidateKind: 'path-boundary-review',
    sourcePattern: /fs\.(?:readFile|readFileSync|readdir|readdirSync|stat|statSync|access|accessSync|writeFile|writeFileSync)\s*\(/,
    sinkKind: 'filesystem.access',
    sourceKind: 'fs.operation',
    description: 'Filesystem operation — verify path sanitization',
  },

  // Output boundary (XSS, unsanitized responses)
  {
    id: 'ts-express-res-send-interpolation',
    candidateKind: 'output-boundary-review',
    sourcePattern: /res\.(?:send|write|end)\s*\(\s*`/,
    sourceKind: 'response.template',
    sinkKind: 'http.response',
    description: 'Response with template literal — potential XSS',
  },
  {
    id: 'ts-innerhtml-assignment',
    candidateKind: 'output-boundary-review',
    sourcePattern: /\.innerHTML\s*=/,
    sourceKind: 'dom.innerHTML',
    sinkKind: 'dom.mutation',
    description: 'innerHTML assignment — potential XSS',
  },

  // Auth boundary
  {
    id: 'ts-jwt-verify-missing',
    candidateKind: 'auth-boundary-review',
    sourcePattern: /jwt\.(?:decode)\s*\(/,
    sourceKind: 'jwt.decode',
    sinkKind: 'auth.bypass',
    description: 'jwt.decode without verify — authentication bypass risk',
  },
  {
    id: 'ts-no-auth-middleware',
    candidateKind: 'auth-boundary-review',
    sourcePattern: /(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:async\s+)?\(/,
    sourceKind: 'route.handler',
    sinkKind: 'route.unprotected',
    description: 'Route handler without explicit auth middleware reference',
  },

  // SQL injection patterns
  {
    id: 'ts-sql-template-literal',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /(?:query|execute|run|prepare|raw)\s*\(\s*`[^`]*\$\{/,
    sourceKind: 'sql.template',
    sinkKind: 'sql.injection',
    description: 'SQL query with template literal interpolation',
  },
  {
    id: 'ts-sql-string-concat',
    candidateKind: 'untrusted-input-review',
    sourcePattern: /(?:query|execute|run|prepare|raw)\s*\(\s*['"].*\+/,
    sourceKind: 'sql.concat',
    sinkKind: 'sql.injection',
    description: 'SQL query with string concatenation',
  },

  // Deserialization
  {
    id: 'ts-json-parse-untrusted',
    candidateKind: 'policy-boundary-review',
    sourcePattern: /JSON\.parse\s*\(\s*(?:req\.|body|input|data|raw|text)/,
    sourceKind: 'json.parse',
    sinkKind: 'deserialization',
    description: 'JSON.parse on potentially untrusted input',
  },

  // Secrets in code
  {
    id: 'ts-hardcoded-secret',
    candidateKind: 'policy-boundary-review',
    sourcePattern: /(?:password|secret|token|apiKey|api_key|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    sourceKind: 'hardcoded.secret',
    sinkKind: 'secret.exposure',
    description: 'Potential hardcoded secret or credential',
  },
];

// ──── Scanner ──────────────────────────────────────────────────────────────────

const getCommitSha = async (repoRoot: string): Promise<string> => {
  try {
    const headContent = await fs.readFile(path.join(repoRoot, '.git', 'HEAD'), 'utf8');
    const refMatch = headContent.trim().match(/^ref:\s*(.+)$/);
    if (refMatch) {
      const refPath = path.join(repoRoot, '.git', refMatch[1].trim());
      return (await fs.readFile(refPath, 'utf8')).trim().slice(0, 12);
    }
    return headContent.trim().slice(0, 12);
  } catch {
    return 'workspace';
  }
};

const shouldSkipDir = (name: string): boolean => {
  if (name.startsWith('.')) return true;
  return EXCLUDED_DIRS.has(name);
};

const hasValidExtension = (filePath: string): boolean => {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return INDEXED_EXTENSIONS.has(ext);
};

const collectFiles = async (dir: string): Promise<string[]> => {
  const output: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) await walk(full);
      } else if (entry.isFile() && hasValidExtension(full)) {
        output.push(full);
      }
    }
  };
  await walk(dir);
  return output.sort();
};

const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/');

const buildSnippet = (lines: string[], matchLine: number): { startLine: number; endLine: number; snippet: string } => {
  const start = Math.max(0, matchLine - CONTEXT_LINES_BEFORE);
  const end = Math.min(lines.length - 1, matchLine + CONTEXT_LINES_AFTER);
  return {
    startLine: start + 1,
    endLine: end + 1,
    snippet: lines.slice(start, end + 1).join('\n'),
  };
};

const buildFingerprint = (filePath: string, line: number, ruleId: string): string => {
  const raw = `${filePath}:${line}:${ruleId}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
};

const inferSymbolName = (lines: string[], lineIndex: number): string | undefined => {
  // Walk backward to find enclosing function/method/class
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 30); i--) {
    const line = lines[i];
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?(?:function\s+)([A-Za-z_$][\w$]*)/);
    if (funcMatch) return funcMatch[1];
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (arrowMatch && (line.includes('=>') || line.includes('function'))) return arrowMatch[1];
    const methodMatch = line.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (methodMatch && !line.includes('if') && !line.includes('for') && !line.includes('while')) return methodMatch[1];
    const classMatch = line.match(/class\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) return classMatch[1];
  }
  return undefined;
};

const scanFile = (
  filePath: string,
  content: string,
  commitSha: string,
  repoRoot: string,
): SecurityCandidate[] => {
  const lines = content.split(/\r?\n/);
  const relativePath = normalizeSlashes(path.relative(repoRoot, filePath));
  const candidates: SecurityCandidate[] = [];
  let idCounter = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];

    // Skip comments
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    for (const rule of SCAN_RULES) {
      if (!rule.sourcePattern.test(lineText)) continue;

      idCounter++;
      const { startLine, endLine, snippet } = buildSnippet(lines, lineIndex);
      const fingerprint = buildFingerprint(relativePath, lineIndex + 1, rule.id);
      const symbolName = inferSymbolName(lines, lineIndex);

      candidates.push({
        id: `${relativePath}:${lineIndex + 1}:${rule.id}:${idCounter}`,
        commitSha,
        filePath: relativePath,
        startLine,
        endLine,
        codeSnippet: snippet,
        ruleId: rule.id,
        fingerprint,
        candidateKind: rule.candidateKind,
        sourceKind: rule.sourceKind,
        sinkKind: rule.sinkKind,
        symbolName,
      });
    }
  }

  return candidates;
};

// ──── Merge adjacent candidates (Toss-style line merging) ──────────────────────

type MergeableCandidate = SecurityCandidate;

const mergeCandidates = (candidates: MergeableCandidate[]): MergeableCandidate[] => {
  if (candidates.length === 0) return [];

  // Group by file + rule
  const groups = new Map<string, MergeableCandidate[]>();
  for (const c of candidates) {
    const key = `${c.filePath}::${c.ruleId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const merged: MergeableCandidate[] = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.startLine - b.startLine);

    let current = { ...bucket[0] };
    for (let i = 1; i < bucket.length; i++) {
      const next = bucket[i];
      // If lines are adjacent or overlapping (within 5 lines gap), merge
      if (next.startLine <= current.endLine + 5) {
        current.endLine = Math.max(current.endLine, next.endLine);
        current.codeSnippet = current.codeSnippet + '\n' + next.codeSnippet;
        current.id = `${current.filePath}:${current.startLine}-${current.endLine}:${current.ruleId}:merged`;
        current.fingerprint = buildFingerprint(current.filePath, current.startLine, current.ruleId + ':merged');
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }

  return merged.sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.startLine - b.startLine;
  });
};

// ──── Main ─────────────────────────────────────────────────────────────────────

const parseArgs = (): { repoRoot: string; outputPath: string; merge: boolean } => {
  const args = process.argv.slice(2);
  let repoRoot = process.cwd();
  let outputPath = 'tmp/security-candidates/latest.jsonl';
  let merge = true;

  for (const arg of args) {
    if (arg.startsWith('--repo-root=')) repoRoot = arg.slice('--repo-root='.length);
    else if (arg.startsWith('--output=')) outputPath = arg.slice('--output='.length);
    else if (arg === '--no-merge') merge = false;
  }

  return { repoRoot: path.resolve(repoRoot), outputPath, merge };
};

const main = async () => {
  const { repoRoot, outputPath, merge } = parseArgs();
  const commitSha = await getCommitSha(repoRoot);

  console.log(`[security-scan] repo: ${repoRoot}`);
  console.log(`[security-scan] commit: ${commitSha}`);
  console.log(`[security-scan] rules: ${SCAN_RULES.length}`);

  const files = await collectFiles(repoRoot);
  console.log(`[security-scan] files to scan: ${files.length}`);

  let allCandidates: SecurityCandidate[] = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const candidates = scanFile(filePath, content, commitSha, repoRoot);
    allCandidates.push(...candidates);
  }

  console.log(`[security-scan] raw candidates: ${allCandidates.length}`);

  if (merge) {
    allCandidates = mergeCandidates(allCandidates);
    console.log(`[security-scan] after merge: ${allCandidates.length}`);
  }

  // Summary by kind
  const kindCounts = new Map<string, number>();
  for (const c of allCandidates) {
    kindCounts.set(c.candidateKind, (kindCounts.get(c.candidateKind) || 0) + 1);
  }
  for (const [kind, count] of [...kindCounts.entries()].sort()) {
    console.log(`  ${kind}: ${count}`);
  }

  // Write JSONL
  const absoluteOutput = path.resolve(repoRoot, outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const jsonl = allCandidates.map((c) => JSON.stringify(c)).join('\n');
  await fs.writeFile(absoluteOutput, jsonl, 'utf8');

  console.log(`[security-scan] output: ${absoluteOutput}`);
  console.log(`[security-scan] done`);
};

main().catch((err) => {
  console.error('[security-scan] fatal:', err);
  process.exit(1);
});

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  mergeSecurityReviewUnits,
  normalizeMergedSecurityReviewUnit,
  normalizeSecurityCandidateAnchor,
  parseJsonl,
  type CandidateKind,
  type MergedSecurityReviewUnit,
  type SecurityCandidateAnchor,
} from '../securityCandidateContract';
import { getErrorMessage } from '../../utils/errorMessage';
import { parseStringEnv } from '../../utils/env';

type SymbolKind = 'function' | 'class' | 'interface' | 'enum' | 'type' | 'method';
type ReferenceKind = 'import' | 'call' | 'read' | 'write';
type ConfidenceLevel = 'high' | 'medium' | 'low';
type CandidateListView = 'raw' | 'merged';
type StalePolicy = 'warn' | 'fail';

type IndexedSymbol = {
  symbolId: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  isExported: boolean;
};

type IndexedFile = {
  filePath: string;
  imports: string[];
  symbols: IndexedSymbol[];
};

type RepositoryIndex = {
  repoId: string;
  repoRoot: string;
  generatedAt: string;
  files: IndexedFile[];
  symbols: IndexedSymbol[];
};

type SymbolSearchArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  query: string;
  kind?: string;
  limit?: number;
};

type SymbolDefineArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  symbolId?: string;
  name?: string;
  filePathHint?: string;
};

type ReferenceSearchArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  symbolId: string;
  limit?: number;
};

type FileOutlineArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  filePath: string;
};

type ScopeReadArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  filePath: string;
  symbolId?: string;
  line?: number;
  contextLines?: number;
};

type ContextBundleArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  goal: string;
  maxItems?: number;
  changedPaths?: string[];
};

type CandidateListArgs = {
  repoId: string;
  branch?: string;
  commitSha?: string;
  candidateKind?: string;
  limit?: number;
  view?: string;
};

type ReferenceMatch = {
  filePath: string;
  line: number;
  column: number;
  text: string;
  kind: ReferenceKind;
  confidence: ConfidenceLevel;
};

type RevisionInfo = {
  branch: string;
  commitSha: string;
};

type IndexResponseMetadata = {
  repoId: string;
  branch: string;
  commitSha: string;
  indexedAt: string;
  indexVersion: string;
  freshness: {
    ageMs: number;
    staleAfterMs: number;
    isStale: boolean;
    policy: StalePolicy;
  };
  warnings: string[];
};

const INDEX_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);
const EXCLUDED_DIRS = new Set(['.git', 'coverage', 'dist', 'node_modules']);
const DOC_HINTS = [
  { keywords: ['architecture', 'module', 'service'], filePath: 'docs/ARCHITECTURE_INDEX.md', reason: 'architecture index' },
  { keywords: ['route', 'api', 'endpoint'], filePath: 'docs/ROUTES_INVENTORY.md', reason: 'route inventory' },
  { keywords: ['schema', 'table', 'database', 'sql'], filePath: 'docs/SCHEMA_SERVICE_MAP.md', reason: 'schema map' },
  { keywords: ['dependency', 'import', 'graph'], filePath: 'docs/DEPENDENCY_GRAPH.md', reason: 'dependency graph' },
];
const INDEX_VERSION = '2026-03-21.1';

let cachedIndex: { key: string; expiresAt: number; value: Promise<RepositoryIndex> } | null = null;

const normalizeSlashes = (value: string): string => String(value || '').replace(/\\/g, '/');

const parseBooleanEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.floor(numeric);
};

const toRelativePath = (repoRoot: string, filePath: string): string => {
  return normalizeSlashes(path.relative(repoRoot, filePath));
};

const getConfiguredRepoId = (): string => {
  const envRepoId = parseStringEnv(process.env.INDEXING_MCP_REPO_ID, '');
  return envRepoId || 'muel-backend';
};

const getConfiguredRepoRoot = (): string => {
  const envRoot = parseStringEnv(process.env.INDEXING_MCP_REPO_ROOT, '');
  return path.resolve(envRoot || process.cwd());
};

const getIndexTtlMs = (): number => parsePositiveIntegerEnv(process.env.INDEXING_MCP_INDEX_TTL_MS, 15_000);

const isIndexingStrictMode = (): boolean => parseBooleanEnv(process.env.INDEXING_MCP_STRICT, false);

const getStalePolicy = (): StalePolicy => {
  const raw = parseStringEnv(process.env.INDEXING_MCP_STALE_POLICY, '').toLowerCase();
  if (raw === 'warn' || raw === 'fail') {
    return raw;
  }
  return isIndexingStrictMode() ? 'fail' : 'warn';
};

const resolveRepo = (repoId: string): { repoId: string; repoRoot: string } => {
  const configuredRepoId = getConfiguredRepoId();
  if (repoId !== configuredRepoId && repoId !== 'current') {
    throw new Error(`unsupported repoId: ${repoId}`);
  }

  return {
    repoId: configuredRepoId,
    repoRoot: getConfiguredRepoRoot(),
  };
};

const ensureRepoScopedPath = (repoRoot: string, filePath: string, fieldName = 'filePath'): string => {
  const normalized = normalizeSlashes(String(filePath || '').trim()).replace(/^\/+/, '');
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  const resolved = path.resolve(repoRoot, normalized);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} is outside repo root: ${filePath}`);
  }
  return resolved;
};

const ensureSafeRepoFilePath = (repoRoot: string, filePath: string): string => {
  return ensureRepoScopedPath(repoRoot, filePath, 'filePath');
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const shouldSkipDirectory = (name: string): boolean => {
  if (!name) {
    return false;
  }
  if (name.startsWith('.')) {
    return true;
  }
  return EXCLUDED_DIRS.has(name);
};

const hasIndexedExtension = (filePath: string): boolean => {
  const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return INDEX_EXTENSIONS.has(extension);
};

const extractImports = (content: string): string[] => {
  const imports = new Set<string>();
  const importRegex = /^\s*import\s+[^'"\n]+from\s+['"]([^'"]+)['"];?/gm;
  const sideEffectRegex = /^\s*import\s+['"]([^'"]+)['"];?/gm;
  const requireRegex = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = sideEffectRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }

  return [...imports].sort((left, right) => left.localeCompare(right));
};

const findOpeningBraceLine = (lines: string[], startIndex: number, lookahead = 12): number | null => {
  for (let index = startIndex; index < lines.length && index <= startIndex + lookahead; index += 1) {
    if (lines[index].includes('{')) {
      return index;
    }
  }
  return null;
};

const findBlockEndLine = (lines: string[], openingLineIndex: number): number => {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let escaping = false;

  for (let lineIndex = openingLineIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (!inDoubleQuote && !inTemplate && char === '\'') {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (!inSingleQuote && !inTemplate && char === '"') {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote && char === '`') {
        inTemplate = !inTemplate;
        continue;
      }
      if (inSingleQuote || inDoubleQuote || inTemplate) {
        continue;
      }
      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return lineIndex + 1;
        }
      }
    }
  }

  return Math.min(lines.length, openingLineIndex + 25);
};

const inferSymbolRange = (lines: string[], startLine: number): { startLine: number; endLine: number } => {
  const openingLineIndex = findOpeningBraceLine(lines, startLine - 1);
  if (openingLineIndex === null) {
    return {
      startLine,
      endLine: Math.min(lines.length, startLine + 8),
    };
  }

  return {
    startLine,
    endLine: findBlockEndLine(lines, openingLineIndex),
  };
};

const extractSymbols = (content: string, filePath: string): IndexedSymbol[] => {
  const lines = content.split(/\r?\n/);
  const output: IndexedSymbol[] = [];
  const seen = new Set<string>();

  const classRegex = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/;
  const functionRegex = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/;
  const arrowRegex = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
  const interfaceRegex = /^\s*(?:export\s+)?(?:default\s+)?interface\s+([A-Za-z_$][\w$]*)\b/;
  const enumRegex = /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\b/;
  const typeAliasRegex = /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/;
  const methodRegex = /^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/;
  const getterSetterRegex = /^\s*(?:(?:public|private|protected|static)\s+)*(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/;

  let insideClass = false;
  let classDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    let kind: SymbolKind | null = null;
    let name = '';

    // Track class depth for method detection
    if (insideClass) {
      for (const ch of raw) {
        if (ch === '{') classDepth++;
        else if (ch === '}') {
          classDepth--;
          if (classDepth <= 0) {
            insideClass = false;
            classDepth = 0;
          }
        }
      }
    }

    const classMatch = classRegex.exec(raw);
    if (classMatch?.[1]) {
      kind = 'class';
      name = classMatch[1];
      insideClass = true;
      classDepth = 0;
      for (const ch of raw) {
        if (ch === '{') classDepth++;
        else if (ch === '}') classDepth--;
      }
    }

    if (!kind) {
      const interfaceMatch = interfaceRegex.exec(raw);
      if (interfaceMatch?.[1]) {
        kind = 'interface';
        name = interfaceMatch[1];
      }
    }

    if (!kind) {
      const enumMatch = enumRegex.exec(raw);
      if (enumMatch?.[1]) {
        kind = 'enum';
        name = enumMatch[1];
      }
    }

    if (!kind) {
      const typeMatch = typeAliasRegex.exec(raw);
      if (typeMatch?.[1]) {
        kind = 'type';
        name = typeMatch[1];
      }
    }

    if (!kind) {
      const functionMatch = functionRegex.exec(raw);
      if (functionMatch?.[1]) {
        kind = 'function';
        name = functionMatch[1];
      }
    }

    if (!kind) {
      const arrowMatch = arrowRegex.exec(raw);
      if (arrowMatch?.[1]) {
        kind = 'function';
        name = arrowMatch[1];
      }
    }

    if (!kind && insideClass) {
      const gsMatch = getterSetterRegex.exec(raw);
      if (gsMatch?.[1]) {
        kind = 'method';
        name = gsMatch[1];
      }
    }

    if (!kind && insideClass) {
      const methodMatch = methodRegex.exec(raw);
      if (methodMatch?.[1] && !raw.trim().startsWith('if') && !raw.trim().startsWith('for') && !raw.trim().startsWith('while') && !raw.trim().startsWith('switch')) {
        kind = 'method';
        name = methodMatch[1];
      }
    }

    if (!kind || !name) {
      continue;
    }

    const startLine = index + 1;
    const dedupeKey = `${kind}:${name}:${startLine}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const range = inferSymbolRange(lines, startLine);
    output.push({
      symbolId: `${normalizeSlashes(filePath)}:${name}:${startLine}`,
      name,
      kind,
      filePath: normalizeSlashes(filePath),
      startLine: range.startLine,
      endLine: range.endLine,
      signature: raw.trim().slice(0, 240),
      isExported: /^\s*export\b/.test(raw),
    });
  }

  return output;
};

const collectIndexedFiles = async (repoRoot: string): Promise<string[]> => {
  const output: string[] = [];

  const walk = async (currentPath: string): Promise<void> => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !hasIndexedExtension(absolutePath)) {
        continue;
      }
      output.push(absolutePath);
    }
  };

  await walk(repoRoot);
  output.sort((left, right) => left.localeCompare(right));
  return output;
};

const buildRepositoryIndex = async (repoId: string, repoRoot: string): Promise<RepositoryIndex> => {
  const filePaths = await collectIndexedFiles(repoRoot);
  const files: IndexedFile[] = [];
  const symbols: IndexedSymbol[] = [];

  for (const absolutePath of filePaths) {
    const content = await fs.readFile(absolutePath, 'utf8');
    const relativePath = toRelativePath(repoRoot, absolutePath);
    const fileSymbols = extractSymbols(content, relativePath);
    files.push({
      filePath: relativePath,
      imports: extractImports(content),
      symbols: fileSymbols,
    });
    symbols.push(...fileSymbols);
  }

  return {
    repoId,
    repoRoot,
    generatedAt: new Date().toISOString(),
    files,
    symbols,
  };
};

const getRepositoryIndex = async (repoId: string): Promise<RepositoryIndex> => {
  const resolved = resolveRepo(repoId);
  const cacheKey = `${resolved.repoId}:${resolved.repoRoot}`;
  const now = Date.now();
  if (cachedIndex && cachedIndex.key === cacheKey && cachedIndex.expiresAt > now) {
    return cachedIndex.value;
  }

  const value = buildRepositoryIndex(resolved.repoId, resolved.repoRoot);
  cachedIndex = {
    key: cacheKey,
    expiresAt: now + getIndexTtlMs(),
    value,
  };

  return value;
};

const normalizeLimit = (value: unknown, fallback: number, max = 100): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.min(max, Math.floor(numeric));
};

const normalizeContextLines = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 6;
  }
  return Math.min(40, Math.floor(numeric));
};

const findFileEntry = (index: RepositoryIndex, filePath: string): IndexedFile => {
  const normalized = normalizeSlashes(String(filePath || '').trim()).replace(/^\/+/, '');
  const entry = index.files.find((item) => item.filePath === normalized);
  if (!entry) {
    throw new Error(`file not indexed: ${filePath}`);
  }
  return entry;
};

const normalizeCandidateListView = (value: unknown): CandidateListView => {
  return String(value || '').trim().toLowerCase() === 'merged' ? 'merged' : 'raw';
};

const readTextIfExists = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const resolveGitDir = async (repoRoot: string): Promise<string | null> => {
  const dotGitPath = path.join(repoRoot, '.git');
  try {
    const stat = await fs.stat(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const raw = await readTextIfExists(dotGitPath);
  const match = String(raw || '').trim().match(/^gitdir:\s+(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  return path.resolve(repoRoot, match[1].trim());
};

const resolvePackedRef = async (gitDir: string, refName: string): Promise<string | null> => {
  const packedRefs = await readTextIfExists(path.join(gitDir, 'packed-refs'));
  if (!packedRefs) {
    return null;
  }

  const line = packedRefs
    .split(/\r?\n/)
    .find((item) => item && !item.startsWith('#') && !item.startsWith('^') && item.endsWith(` ${refName}`));
  if (!line) {
    return null;
  }
  return line.split(' ')[0]?.trim() || null;
};

const resolveGitRevision = async (repoRoot: string): Promise<RevisionInfo | null> => {
  const gitDir = await resolveGitDir(repoRoot);
  if (!gitDir) {
    return null;
  }

  const headRaw = String(await readTextIfExists(path.join(gitDir, 'HEAD')) || '').trim();
  if (!headRaw) {
    return null;
  }

  if (!headRaw.startsWith('ref:')) {
    return {
      branch: 'detached',
      commitSha: headRaw,
    };
  }

  const refName = headRaw.replace(/^ref:\s*/, '').trim();
  const branch = refName.split('/').slice(2).join('/') || refName;
  const directRef = String(await readTextIfExists(path.join(gitDir, refName)) || '').trim();
  const commitSha = directRef || await resolvePackedRef(gitDir, refName);
  if (!commitSha) {
    return null;
  }

  return {
    branch,
    commitSha,
  };
};

const buildIndexMetadata = async (
  index: RepositoryIndex,
  branchHint?: string,
  commitHint?: string,
): Promise<IndexResponseMetadata> => {
  const revision = await resolveGitRevision(index.repoRoot);
  const hintedBranch = String(branchHint || '').trim();
  const hintedCommitSha = String(commitHint || '').trim();
  const failClosed = isIndexingStrictMode() || getStalePolicy() === 'fail';

  if (failClosed && revision?.branch && hintedBranch && revision.branch !== hintedBranch) {
    throw new Error(`branch mismatch: expected ${hintedBranch}, actual ${revision.branch}`);
  }
  if (failClosed && revision?.commitSha && hintedCommitSha && revision.commitSha !== hintedCommitSha) {
    throw new Error(`commitSha mismatch: expected ${hintedCommitSha}, actual ${revision.commitSha}`);
  }

  const indexedAtMs = Date.parse(index.generatedAt);
  const ageMs = Number.isFinite(indexedAtMs) ? Math.max(0, Date.now() - indexedAtMs) : 0;
  const staleAfterMs = getIndexTtlMs();
  const isStale = ageMs > staleAfterMs;
  const policy = getStalePolicy();
  if (isStale && policy === 'fail') {
    throw new Error(`stale index blocked by policy: ageMs=${ageMs}, staleAfterMs=${staleAfterMs}`);
  }

  const warnings: string[] = [];
  if (!revision) {
    warnings.push('git metadata unavailable; using fallback branch/commit metadata');
  }
  if (isStale) {
    warnings.push(`index is stale (ageMs=${ageMs}, staleAfterMs=${staleAfterMs})`);
  }

  return {
    repoId: index.repoId,
    branch: revision?.branch || hintedBranch || 'workspace',
    commitSha: revision?.commitSha || hintedCommitSha || 'workspace-unversioned',
    indexedAt: index.generatedAt,
    indexVersion: INDEX_VERSION,
    freshness: {
      ageMs,
      staleAfterMs,
      isStale,
      policy,
    },
    warnings,
  };
};

const scoreSymbolMatch = (symbol: IndexedSymbol, query: string): number => {
  const loweredName = symbol.name.toLowerCase();
  const loweredSignature = symbol.signature.toLowerCase();
  const loweredFilePath = symbol.filePath.toLowerCase();
  const exportBonus = symbol.isExported ? 4 : 0;

  if (loweredName === query) {
    return 120 + exportBonus;
  }
  if (loweredName.startsWith(query)) {
    return 95 + exportBonus;
  }
  if (loweredName.includes(query)) {
    return 80 + exportBonus;
  }
  if (loweredSignature.includes(query)) {
    return 50 + exportBonus;
  }
  if (loweredFilePath.includes(query)) {
    return 25 + exportBonus;
  }
  return 0;
};

const classifyReference = (symbolName: string, lineText: string): { kind: ReferenceKind; confidence: ConfidenceLevel; column: number } => {
  const symbolPattern = new RegExp(`\\b${escapeRegExp(symbolName)}\\b`);
  const match = symbolPattern.exec(lineText);
  const column = match ? match.index + 1 : 1;

  if (new RegExp(`(?:^|\\s)import\\s+.*\\b${escapeRegExp(symbolName)}\\b`).test(lineText)) {
    return { kind: 'import', confidence: 'high', column };
  }
  if (new RegExp(`\\b${escapeRegExp(symbolName)}\\s*\\(`).test(lineText)) {
    return { kind: 'call', confidence: 'high', column };
  }
  if (new RegExp(`\\b${escapeRegExp(symbolName)}\\b\\s*=`).test(lineText)) {
    return { kind: 'write', confidence: 'medium', column };
  }
  return { kind: 'read', confidence: 'medium', column };
};

const normalizeChangedPathSet = (items: string[] | undefined): Set<string> => {
  return new Set((items || []).map((item) => normalizeSlashes(String(item || '').trim()).replace(/^\/+/, '')).filter(Boolean));
};

const scoreContextGoal = (goal: string, filePath: string): number => {
  const tokens = goal.toLowerCase().split(/[^a-z0-9_$]+/).filter((token) => token.length > 2);
  const loweredPath = filePath.toLowerCase();
  return tokens.reduce((score, token) => score + (loweredPath.includes(token) ? 12 : 0), 0);
};

export const searchIndexedSymbols = async (args: SymbolSearchArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const query = String(args.query || '').trim().toLowerCase();
  if (!query) {
    throw new Error('query is required');
  }

  const requestedKind = String(args.kind || '').trim();
  const limit = normalizeLimit(args.limit, 20);

  const items = index.symbols
    .map((symbol) => ({ symbol, score: scoreSymbolMatch(symbol, query) }))
    .filter(({ symbol, score }) => {
      if (requestedKind && symbol.kind !== requestedKind) {
        return false;
      }
      return score > 0;
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      if (left.symbol.filePath !== right.symbol.filePath) {
        return left.symbol.filePath.localeCompare(right.symbol.filePath);
      }
      return left.symbol.startLine - right.symbol.startLine;
    })
    .slice(0, limit)
    .map(({ symbol, score }) => ({ ...symbol, score }));

  return {
    repoId: index.repoId,
    generatedAt: index.generatedAt,
    metadata,
    totalIndexedFiles: index.files.length,
    totalIndexedSymbols: index.symbols.length,
    items,
  };
};

export const resolveIndexedSymbolDefinition = async (args: SymbolDefineArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const symbolId = String(args.symbolId || '').trim();
  const name = String(args.name || '').trim();
  const filePathHint = normalizeSlashes(String(args.filePathHint || '').trim()).replace(/^\/+/, '');

  let symbol = symbolId
    ? index.symbols.find((item) => item.symbolId === symbolId)
    : undefined;

  if (!symbol && name) {
    symbol = index.symbols.find((item) => item.name === name && (!filePathHint || item.filePath === filePathHint));
  }

  if (!symbol) {
    return {
      repoId: index.repoId,
      metadata,
      found: false,
    };
  }

  const entry = findFileEntry(index, symbol.filePath);
  const absolutePath = ensureSafeRepoFilePath(index.repoRoot, symbol.filePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);

  return {
    repoId: index.repoId,
    metadata,
    found: true,
    symbol,
    declaration: {
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      snippet: lines.slice(symbol.startLine - 1, symbol.endLine).join('\n'),
    },
    importSummary: entry.imports,
    exportSummary: entry.symbols.filter((item) => item.isExported).map((item) => item.name),
  };
};

export const findIndexedSymbolReferences = async (args: ReferenceSearchArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const limit = normalizeLimit(args.limit, 50);
  const symbol = index.symbols.find((item) => item.symbolId === String(args.symbolId || '').trim());
  if (!symbol) {
    throw new Error(`unknown symbolId: ${args.symbolId}`);
  }

  const pattern = new RegExp(`\\b${escapeRegExp(symbol.name)}\\b`);
  const items: ReferenceMatch[] = [];

  for (const file of index.files) {
    if (items.length >= limit) {
      break;
    }
    const content = await fs.readFile(path.join(index.repoRoot, file.filePath), 'utf8');
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (items.length >= limit) {
        break;
      }
      if (!pattern.test(lines[lineIndex])) {
        continue;
      }
      if (file.filePath === symbol.filePath && lineIndex + 1 === symbol.startLine) {
        continue;
      }
      const classified = classifyReference(symbol.name, lines[lineIndex]);
      items.push({
        filePath: file.filePath,
        line: lineIndex + 1,
        column: classified.column,
        text: lines[lineIndex].trim().slice(0, 240),
        kind: classified.kind,
        confidence: classified.confidence,
      });
    }
  }

  return {
    repoId: index.repoId,
    metadata,
    symbol,
    items,
  };
};

export const getIndexedFileOutline = async (args: FileOutlineArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const entry = findFileEntry(index, args.filePath);
  return {
    repoId: index.repoId,
    metadata,
    filePath: entry.filePath,
    imports: entry.imports,
    exports: entry.symbols.filter((item) => item.isExported).map((item) => item.name),
    symbols: entry.symbols,
  };
};

export const readIndexedScope = async (args: ScopeReadArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const entry = findFileEntry(index, args.filePath);
  const absolutePath = ensureSafeRepoFilePath(index.repoRoot, entry.filePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const contextLines = normalizeContextLines(args.contextLines);

  let targetSymbol = args.symbolId ? entry.symbols.find((item) => item.symbolId === String(args.symbolId).trim()) : undefined;
  const line = Number(args.line);
  if (!targetSymbol && Number.isInteger(line) && line > 0) {
    targetSymbol = entry.symbols.find((item) => item.startLine <= line && item.endLine >= line);
  }

  const startLine = targetSymbol
    ? targetSymbol.startLine
    : Math.max(1, (Number.isInteger(line) && line > 0 ? line : 1) - contextLines);
  const endLine = targetSymbol
    ? targetSymbol.endLine
    : Math.min(lines.length, (Number.isInteger(line) && line > 0 ? line : 1) + contextLines);

  return {
    repoId: index.repoId,
    metadata,
    filePath: entry.filePath,
    symbol: targetSymbol,
    startLine,
    endLine,
    snippet: lines.slice(startLine - 1, endLine).join('\n'),
  };
};

const resolveCandidateFilePath = async (
  repoRoot: string,
  explicitEnvName: string,
  candidateNames: string[],
): Promise<string | null> => {
  const explicitPath = String(process.env[explicitEnvName] || '').trim();
  if (explicitPath) {
    return ensureRepoScopedPath(repoRoot, explicitPath, explicitEnvName);
  }

  for (const relativePath of candidateNames.filter(Boolean)) {
    const absolutePath = ensureRepoScopedPath(repoRoot, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        return absolutePath;
      }
    } catch {
      // ignore missing path
    }
  }

  return null;
};

const resolveRawCandidateFilePath = async (repoRoot: string, args: CandidateListArgs): Promise<string | null> => {
  return resolveCandidateFilePath(repoRoot, 'INDEXING_SECURITY_CANDIDATES_PATH', [
    args.commitSha ? `tmp/security-candidates/${args.commitSha}.jsonl` : '',
    args.branch ? `tmp/security-candidates/${args.branch}.jsonl` : '',
    'tmp/security-candidates/latest.jsonl',
    'tmp/security-candidates.jsonl',
  ]);
};

const resolveMergedCandidateFilePath = async (repoRoot: string, args: CandidateListArgs): Promise<string | null> => {
  return resolveCandidateFilePath(repoRoot, 'INDEXING_SECURITY_MERGED_CANDIDATES_PATH', [
    args.commitSha ? `tmp/security-candidates/${args.commitSha}.merged.jsonl` : '',
    args.commitSha ? `tmp/security-candidates/merged/${args.commitSha}.jsonl` : '',
    args.branch ? `tmp/security-candidates/${args.branch}.merged.jsonl` : '',
    args.branch ? `tmp/security-candidates/merged/${args.branch}.jsonl` : '',
    'tmp/security-candidates/latest.merged.jsonl',
    'tmp/security-candidates/merged/latest.jsonl',
    'tmp/security-candidates.merged.jsonl',
  ]);
};

export const listSecurityCandidates = async (args: CandidateListArgs) => {
  const resolved = resolveRepo(args.repoId);
  const view = normalizeCandidateListView(args.view);
  const rawCandidateFilePath = await resolveRawCandidateFilePath(resolved.repoRoot, args);
  const mergedCandidateFilePath = await resolveMergedCandidateFilePath(resolved.repoRoot, args);

  let rawItems: SecurityCandidateAnchor[] = [];
  if (rawCandidateFilePath) {
    const raw = await fs.readFile(rawCandidateFilePath, 'utf8');
    try {
      rawItems = parseJsonl(raw, normalizeSecurityCandidateAnchor);
    } catch (error) {
      const message = getErrorMessage(error);
      throw new Error(`invalid security candidate JSONL (${normalizeSlashes(path.relative(resolved.repoRoot, rawCandidateFilePath))}): ${message}`);
    }
  }

  let mergedItems: MergedSecurityReviewUnit[] = [];
  if (mergedCandidateFilePath) {
    const raw = await fs.readFile(mergedCandidateFilePath, 'utf8');
    try {
      mergedItems = parseJsonl(raw, normalizeMergedSecurityReviewUnit);
    } catch (error) {
      const message = getErrorMessage(error);
      throw new Error(`invalid merged security candidate JSONL (${normalizeSlashes(path.relative(resolved.repoRoot, mergedCandidateFilePath))}): ${message}`);
    }
  }
  if (mergedItems.length === 0 && rawItems.length > 0) {
    mergedItems = mergeSecurityReviewUnits(rawItems);
  }

  const candidateKind = String(args.candidateKind || '').trim() as CandidateKind | '';
  const limit = normalizeLimit(args.limit, 50);
  const filteredRawItems = rawItems
    .filter((item) => {
      if (args.commitSha && item.commitSha !== args.commitSha) {
        return false;
      }
      if (candidateKind && item.candidateKind !== candidateKind) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
  const filteredMergedItems = mergedItems
    .filter((item) => {
      if (args.commitSha && item.commitSha !== args.commitSha) {
        return false;
      }
      if (candidateKind && item.candidateKind !== candidateKind) {
        return false;
      }
      return true;
    })
    .slice(0, limit);

  const selectedSourcePath = view === 'merged'
    ? (mergedCandidateFilePath || rawCandidateFilePath)
    : rawCandidateFilePath;
  let artifactIndexedAt = new Date().toISOString();
  if (selectedSourcePath) {
    const stat = await fs.stat(selectedSourcePath);
    artifactIndexedAt = stat.mtime.toISOString();
  }
  const candidateCommitSha = args.commitSha
    || filteredRawItems[0]?.commitSha
    || filteredMergedItems[0]?.commitSha
    || rawItems[0]?.commitSha
    || mergedItems[0]?.commitSha;
  const metadataBase = await buildIndexMetadata({
    repoId: resolved.repoId,
    repoRoot: resolved.repoRoot,
    generatedAt: artifactIndexedAt,
    files: [],
    symbols: [],
  }, args.branch, candidateCommitSha);
  const metadata = candidateCommitSha
    ? {
      ...metadataBase,
      commitSha: candidateCommitSha,
      warnings: metadataBase.commitSha !== candidateCommitSha
        ? [...metadataBase.warnings, `candidate artifact commitSha differs from current HEAD (${metadataBase.commitSha})`]
        : metadataBase.warnings,
    }
    : metadataBase;

  return {
    repoId: resolved.repoId,
    metadata,
    view,
    sourcePath: rawCandidateFilePath ? normalizeSlashes(path.relative(resolved.repoRoot, rawCandidateFilePath)) : null,
    mergedSourcePath: mergedCandidateFilePath ? normalizeSlashes(path.relative(resolved.repoRoot, mergedCandidateFilePath)) : null,
    rawCount: rawItems.length,
    mergedCount: mergedItems.length,
    items: view === 'merged' ? filteredMergedItems : filteredRawItems,
  };
};

export const buildIndexContextBundle = async (args: ContextBundleArgs) => {
  const index = await getRepositoryIndex(args.repoId);
  const metadata = await buildIndexMetadata(index, args.branch, args.commitSha);
  const maxItems = normalizeLimit(args.maxItems, 6, 20);
  const changedPathSet = normalizeChangedPathSet(args.changedPaths);
  const goal = String(args.goal || '').trim();
  if (!goal) {
    throw new Error('goal is required');
  }

  const symbolMatches = (await searchIndexedSymbols({
    repoId: args.repoId,
    branch: args.branch,
    commitSha: args.commitSha,
    query: goal,
    limit: maxItems,
  }))
    .items
    .map((symbol) => ({
      type: 'symbol',
      filePath: symbol.filePath,
      reason: changedPathSet.has(symbol.filePath) ? 'matched goal and changed path' : 'matched goal in symbol index',
      score: Number(symbol.score || 0) + (changedPathSet.has(symbol.filePath) ? 30 : 0),
      symbol,
    }));

  const loweredGoal = goal.toLowerCase();
  const docMatches = DOC_HINTS
    .filter((item) => item.keywords.some((keyword) => loweredGoal.includes(keyword)))
    .slice(0, maxItems)
    .map((item) => ({
      type: 'doc',
      filePath: item.filePath,
      reason: item.reason,
      score: 40 + scoreContextGoal(goal, item.filePath),
    }));

  const changedFileMatches = index.files
    .filter((file) => changedPathSet.has(file.filePath))
    .slice(0, maxItems)
    .map((file) => ({
      type: 'changed-file',
      filePath: file.filePath,
      reason: 'explicit changed path',
      score: 90 + scoreContextGoal(goal, file.filePath),
    }));

  const deduped = new Map<string, Record<string, unknown>>();
  for (const item of [...changedFileMatches, ...symbolMatches, ...docMatches]) {
    const key = `${item.type}:${item.filePath}:${String((item as { symbol?: { symbolId?: string } }).symbol?.symbolId || '')}`;
    const existing = deduped.get(key);
    if (!existing || Number(existing.score || 0) < Number(item.score || 0)) {
      deduped.set(key, item);
    }
  }

  const items = [...deduped.values()]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, maxItems);

  return {
    repoId: index.repoId,
    generatedAt: index.generatedAt,
    metadata,
    items,
    recommendedOrder: items.map((item) => String(item.filePath || '')),
  };
};

export const __resetCodeIndexCacheForTests = (): void => {
  cachedIndex = null;
};

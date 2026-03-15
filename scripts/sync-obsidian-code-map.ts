/* eslint-disable no-console */
import 'dotenv/config';
import { promises as fs, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

type SymbolKind = 'function' | 'class';

type CodeSymbol = {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  signature: string;
  notePath: string;
};

type FileNode = {
  filePath: string;
  notePath: string;
  imports: string[];
  symbolIds: string[];
};

type BuildResult = {
  files: FileNode[];
  symbols: CodeSymbol[];
};

type EntryHint = {
  role: string;
  reason: string;
};

type CliOptions = {
  repoPath: string;
  vaultPath: string;
  outputDir: string;
  watch: boolean;
  includeExt: Set<string>;
  excludeDirs: Set<string>;
  debounceMs: number;
  tagPolicy: TagPolicy;
};

type TagPolicy = {
  baseTags: string[];
  fileTags: string[];
  symbolTags: string[];
  indexTags: string[];
  includePathTags: boolean;
  pathTagPrefix: string;
  pathTagDepth: number;
  includeExtensionTag: boolean;
  symbolKindTagPrefix: string;
  emitInlineTags: boolean;
  architectureRules: Array<{ prefix: string; tag: string }>;
};

const DEFAULT_INCLUDE_EXT = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'cs', 'cpp', 'c', 'h', 'hpp'];
const DEFAULT_EXCLUDE_DIRS = ['.git', '.obsidian', 'node_modules', 'dist', 'build', 'coverage', '.next', 'out', 'target'];
const DEFAULT_TAG_BASE = ['code-map'];
const DEFAULT_TAG_FILE = ['code-file', 'code/file'];
const DEFAULT_TAG_SYMBOL = ['symbol', 'code/symbol'];
const DEFAULT_TAG_INDEX = ['index'];
const DEFAULT_ARCH_TAG_RULES = [
  'src/discord:arch/discord',
  'src/services/obsidian:arch/obsidian',
  'src/services/skills:arch/skills',
  'src/routes:arch/api',
  'src/mcp:arch/mcp',
  'scripts:arch/tooling',
  'docs:arch/docs',
];

const normalizePosix = (value: string): string => value.split(path.sep).join('/');

const stripExt = (value: string): string => value.replace(/\.[^.]+$/, '');

const toShortHash = (value: string): string => crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);

const splitCsv = (value: string): string[] => {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

const normalizeTag = (value: string): string => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_/]+|[-_/]+$/g, '');
  return normalized;
};

const splitTags = (value: string): string[] => {
  return splitCsv(value)
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);
};

const uniqueTags = (tags: string[]): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

const parseArchitectureRules = (value: string): Array<{ prefix: string; tag: string }> => {
  const output: Array<{ prefix: string; tag: string }> = [];
  for (const item of splitCsv(value)) {
    const idx = item.indexOf(':');
    if (idx < 1) {
      continue;
    }
    const rawPrefix = normalizePosix(item.slice(0, idx).trim()).replace(/^\/+|\/+$/g, '');
    const rawTag = normalizeTag(item.slice(idx + 1));
    if (!rawPrefix || !rawTag) {
      continue;
    }
    output.push({ prefix: rawPrefix, tag: rawTag });
  }
  return output;
};

const parseBool = (value: string): boolean => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const parsePositiveInt = (value: string, fallback: number, min = 1): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  if (rounded < min) {
    return fallback;
  }
  return rounded;
};

const toYamlTagArray = (tags: string[]): string => {
  const escaped = tags.map((tag) => `'${tag.replace(/'/g, "''")}'`);
  return `[${escaped.join(', ')}]`;
};

const toInlineTagLine = (tags: string[]): string => {
  return tags.map((tag) => `#${tag}`).join(' ').trim();
};

const getArchitectureTags = (filePath: string, rules: Array<{ prefix: string; tag: string }>): string[] => {
  const normalizedPath = normalizePosix(filePath);
  const tags: string[] = [];
  for (const rule of rules) {
    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      tags.push(rule.tag);
    }
  }
  return uniqueTags(tags);
};

const detectEntryHints = (filePath: string): EntryHint[] => {
  const normalized = normalizePosix(filePath);
  const hints: EntryHint[] = [];

  if (normalized === 'src/app.ts' || normalized === 'src/bot.ts' || normalized === 'server.ts' || normalized === 'bot.ts') {
    hints.push({ role: 'entry/runtime', reason: 'runtime bootstrap' });
  }
  if (/^src\/routes\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)) {
    hints.push({ role: 'entry/http-route', reason: 'http route handler' });
  }
  if (/^src\/discord\/commands\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)) {
    hints.push({ role: 'entry/discord-command', reason: 'discord slash/message command' });
  }
  if (/^scripts\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)) {
    hints.push({ role: 'entry/script', reason: 'ops/tooling script' });
  }
  if (/^src\/mcp\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)) {
    hints.push({ role: 'entry/mcp', reason: 'mcp service entry' });
  }

  return hints;
};

const classifyLayer = (filePath: string): string => {
  const normalized = normalizePosix(filePath);
  if (normalized.startsWith('src/routes/')) {
    return 'route';
  }
  if (normalized.startsWith('src/discord/')) {
    return 'discord';
  }
  if (normalized.startsWith('src/services/')) {
    return 'service';
  }
  if (normalized.startsWith('src/middleware/')) {
    return 'middleware';
  }
  if (normalized.startsWith('src/mcp/')) {
    return 'mcp';
  }
  if (normalized.startsWith('src/utils/')) {
    return 'utility';
  }
  if (normalized.startsWith('scripts/')) {
    return 'tooling';
  }
  if (normalized.startsWith('docs/')) {
    return 'docs';
  }
  return 'misc';
};

const resolveRelativeImport = (fromFilePath: string, specifier: string, fileByPath: Map<string, FileNode>): string | null => {
  const spec = String(specifier || '').trim();
  if (!spec.startsWith('.')) {
    return null;
  }

  const fromDir = path.posix.dirname(normalizePosix(fromFilePath));
  const base = normalizePosix(path.posix.normalize(path.posix.join(fromDir, spec)));

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.py`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mjs`,
    `${base}/index.cjs`,
  ];

  for (const candidate of candidates) {
    if (fileByPath.has(candidate)) {
      return candidate;
    }
  }

  return null;
};

const buildPathTags = (filePath: string, prefix: string, depth: number): string[] => {
  const cleanPrefix = normalizeTag(prefix || 'path');
  if (!cleanPrefix || depth < 1) {
    return [];
  }

  const withoutExt = stripExt(normalizePosix(filePath));
  const rawParts = withoutExt.split('/').filter(Boolean);
  const parts = rawParts.map((part) => normalizeTag(part)).filter(Boolean);
  if (parts.length === 0) {
    return [];
  }

  const output: string[] = [];
  const maxDepth = Math.min(parts.length, depth);
  for (let i = 0; i < maxDepth; i += 1) {
    const branch = parts.slice(0, i + 1).join('/');
    output.push(`${cleanPrefix}/${branch}`);
  }
  return output;
};

const ensureDirectory = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readTextFileSafe = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
};

const sanitizeFileName = (value: string): string => {
  return value
    .replace(/[\\/]/g, '__')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const toWikiLink = (notePath: string, alias?: string): string => {
  const base = stripExt(normalizePosix(notePath));
  if (!alias) {
    return `[[${base}]]`;
  }
  return `[[${base}|${alias}]]`;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);

  let repoPath = String(process.env.OBSIDIAN_CODEMAP_REPO_PATH || '').trim();
  let vaultPath = String(process.env.OBSIDIAN_CODEMAP_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let outputDir = String(process.env.OBSIDIAN_CODEMAP_OUTPUT_DIR || 'index/code-map').trim();
  let watch = parseBool(String(process.env.OBSIDIAN_CODEMAP_WATCH || ''));
  let includeExt = splitCsv(String(process.env.OBSIDIAN_CODEMAP_INCLUDE_EXT || DEFAULT_INCLUDE_EXT.join(',')));
  let excludeDirs = splitCsv(String(process.env.OBSIDIAN_CODEMAP_EXCLUDE_DIRS || DEFAULT_EXCLUDE_DIRS.join(',')));
  let debounceMs = parsePositiveInt(String(process.env.OBSIDIAN_CODEMAP_WATCH_DEBOUNCE_MS || ''), 1500, 200);
  let tagBase = splitTags(String(process.env.OBSIDIAN_CODEMAP_TAG_BASE || DEFAULT_TAG_BASE.join(',')));
  let tagFile = splitTags(String(process.env.OBSIDIAN_CODEMAP_TAG_FILE || DEFAULT_TAG_FILE.join(',')));
  let tagSymbol = splitTags(String(process.env.OBSIDIAN_CODEMAP_TAG_SYMBOL || DEFAULT_TAG_SYMBOL.join(',')));
  let tagIndex = splitTags(String(process.env.OBSIDIAN_CODEMAP_TAG_INDEX || DEFAULT_TAG_INDEX.join(',')));
  let tagPathEnabled = parseBool(String(process.env.OBSIDIAN_CODEMAP_TAG_PATH_ENABLED || 'false'));
  let tagPathPrefix = normalizeTag(String(process.env.OBSIDIAN_CODEMAP_TAG_PATH_PREFIX || 'code/path'));
  let tagPathDepth = parsePositiveInt(String(process.env.OBSIDIAN_CODEMAP_TAG_PATH_DEPTH || ''), 3, 1);
  let tagIncludeExtension = parseBool(String(process.env.OBSIDIAN_CODEMAP_TAG_INCLUDE_EXTENSION || 'false'));
  let tagSymbolKindPrefix = normalizeTag(String(process.env.OBSIDIAN_CODEMAP_TAG_SYMBOL_KIND_PREFIX || 'symbol'));
  let tagEmitInline = parseBool(String(process.env.OBSIDIAN_CODEMAP_TAG_INLINE_ENABLED || 'false'));
  let architectureRules = parseArchitectureRules(
    String(process.env.OBSIDIAN_CODEMAP_ARCH_TAG_RULES || DEFAULT_ARCH_TAG_RULES.join(',')),
  );

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    const next = String(args[i + 1] || '').trim();
    if ((current === '--repo' || current === '--repo-path') && next) {
      repoPath = next;
      i += 1;
      continue;
    }
    if ((current === '--vault' || current === '--vault-path') && next) {
      vaultPath = next;
      i += 1;
      continue;
    }
    if ((current === '--out' || current === '--output-dir') && next) {
      outputDir = next;
      i += 1;
      continue;
    }
    if (current === '--watch') {
      watch = true;
      continue;
    }
    if (current === '--no-watch') {
      watch = false;
      continue;
    }
    if (current === '--include-ext' && next) {
      includeExt = splitCsv(next);
      i += 1;
      continue;
    }
    if (current === '--exclude-dirs' && next) {
      excludeDirs = splitCsv(next);
      i += 1;
      continue;
    }
    if (current === '--debounce-ms' && next) {
      debounceMs = parsePositiveInt(next, debounceMs, 200);
      i += 1;
      continue;
    }
    if (current === '--tag-base' && next) {
      tagBase = splitTags(next);
      i += 1;
      continue;
    }
    if (current === '--tag-file' && next) {
      tagFile = splitTags(next);
      i += 1;
      continue;
    }
    if (current === '--tag-symbol' && next) {
      tagSymbol = splitTags(next);
      i += 1;
      continue;
    }
    if (current === '--tag-index' && next) {
      tagIndex = splitTags(next);
      i += 1;
      continue;
    }
    if (current === '--tag-path-enabled') {
      tagPathEnabled = true;
      continue;
    }
    if (current === '--tag-path-disabled') {
      tagPathEnabled = false;
      continue;
    }
    if (current === '--tag-path-prefix' && next) {
      tagPathPrefix = normalizeTag(next) || tagPathPrefix;
      i += 1;
      continue;
    }
    if (current === '--tag-path-depth' && next) {
      tagPathDepth = parsePositiveInt(next, tagPathDepth, 1);
      i += 1;
      continue;
    }
    if (current === '--tag-include-extension') {
      tagIncludeExtension = true;
      continue;
    }
    if (current === '--tag-no-extension') {
      tagIncludeExtension = false;
      continue;
    }
    if (current === '--tag-symbol-kind-prefix' && next) {
      tagSymbolKindPrefix = normalizeTag(next) || tagSymbolKindPrefix;
      i += 1;
      continue;
    }
    if (current === '--inline-tags') {
      tagEmitInline = true;
      continue;
    }
    if (current === '--no-inline-tags') {
      tagEmitInline = false;
      continue;
    }
    if (current === '--arch-tag-rules' && next) {
      architectureRules = parseArchitectureRules(next);
      i += 1;
    }
  }

  const resolvedRepoPath = path.resolve(repoPath || process.cwd());
  const resolvedVaultPath = path.resolve(vaultPath || resolvedRepoPath);

  return {
    repoPath: resolvedRepoPath,
    vaultPath: resolvedVaultPath,
    outputDir: normalizePosix(outputDir || 'index/code-map'),
    watch,
    includeExt: new Set(includeExt.map((item) => item.replace(/^\./, '').toLowerCase()).filter(Boolean)),
    excludeDirs: new Set(excludeDirs.map((item) => item.trim()).filter(Boolean)),
    debounceMs,
    tagPolicy: {
      baseTags: uniqueTags(tagBase.length ? tagBase : DEFAULT_TAG_BASE),
      fileTags: uniqueTags(tagFile.length ? tagFile : DEFAULT_TAG_FILE),
      symbolTags: uniqueTags(tagSymbol.length ? tagSymbol : DEFAULT_TAG_SYMBOL),
      indexTags: uniqueTags(tagIndex.length ? tagIndex : DEFAULT_TAG_INDEX),
      includePathTags: tagPathEnabled,
      pathTagPrefix: normalizeTag(tagPathPrefix || 'code/path') || 'code/path',
      pathTagDepth: tagPathDepth,
      includeExtensionTag: tagIncludeExtension,
      symbolKindTagPrefix: normalizeTag(tagSymbolKindPrefix || 'symbol') || 'symbol',
      emitInlineTags: tagEmitInline,
      architectureRules,
    },
  };
};

const ensureDirectoryPath = async (dirPath: string, label: string): Promise<string> => {
  const resolved = path.resolve(dirPath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`${label} path does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} path is not a directory: ${resolved}`);
  }
  return resolved;
};

const shouldSkipDirectory = (name: string, excludeDirs: Set<string>): boolean => {
  if (!name) {
    return false;
  }
  if (name.startsWith('.')) {
    return true;
  }
  return excludeDirs.has(name);
};

const hasIncludedExtension = (filePath: string, includeExt: Set<string>): boolean => {
  const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
  if (!extension) {
    return false;
  }
  return includeExt.has(extension);
};

const collectSourceFiles = async (
  rootPath: string,
  includeExt: Set<string>,
  excludeDirs: Set<string>,
  outputAbsolutePath: string,
): Promise<string[]> => {
  const output: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, excludeDirs)) {
          continue;
        }
        if (absolutePath.startsWith(outputAbsolutePath + path.sep) || absolutePath === outputAbsolutePath) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      if (!hasIncludedExtension(absolutePath, includeExt)) {
        continue;
      }
      output.push(absolutePath);
    }
  };

  await walk(rootPath);
  output.sort((a, b) => a.localeCompare(b));
  return output;
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

  return [...imports].sort((a, b) => a.localeCompare(b));
};

const extractSymbols = (content: string): Array<{ kind: SymbolKind; name: string; line: number; signature: string }> => {
  const lines = content.split(/\r?\n/);
  const output: Array<{ kind: SymbolKind; name: string; line: number; signature: string }> = [];
  const seen = new Set<string>();

  const classRegex = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/;
  const functionRegex = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/;
  const arrowRegex = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    let matchedKind: SymbolKind | null = null;
    let matchedName = '';

    const classMatch = classRegex.exec(raw);
    if (classMatch?.[1]) {
      matchedKind = 'class';
      matchedName = classMatch[1];
    }

    if (!matchedKind) {
      const fnMatch = functionRegex.exec(raw);
      if (fnMatch?.[1]) {
        matchedKind = 'function';
        matchedName = fnMatch[1];
      }
    }

    if (!matchedKind) {
      const arrowMatch = arrowRegex.exec(raw);
      if (arrowMatch?.[1]) {
        matchedKind = 'function';
        matchedName = arrowMatch[1];
      }
    }

    if (!matchedKind || !matchedName) {
      continue;
    }

    const dedupeKey = `${matchedKind}:${matchedName}:${i + 1}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    output.push({
      kind: matchedKind,
      name: matchedName,
      line: i + 1,
      signature: line.slice(0, 240),
    });
  }

  return output;
};

const uniqueWords = (content: string): Set<string> => {
  const words = new Set<string>();
  const matches = content.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [];
  for (const token of matches) {
    words.add(token);
  }
  return words;
};

const writeMarkdown = async (filePath: string, content: string): Promise<void> => {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
};

const buildFileTags = (filePath: string, policy: TagPolicy): string[] => {
  const tags = [...policy.baseTags, ...policy.fileTags];

  if (policy.includePathTags) {
    tags.push(...buildPathTags(filePath, policy.pathTagPrefix, policy.pathTagDepth));
  }

  if (policy.includeExtensionTag) {
    const ext = normalizeTag(path.extname(filePath).replace(/^\./, ''));
    if (ext) {
      tags.push(`code/ext/${ext}`);
    }
  }

  const normalizedPath = normalizePosix(filePath);
  for (const rule of policy.architectureRules) {
    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      tags.push(rule.tag);
    }
  }

  return uniqueTags(tags);
};

const buildSymbolTags = (symbol: CodeSymbol, policy: TagPolicy): string[] => {
  const tags = [...policy.baseTags, ...policy.symbolTags, `${policy.symbolKindTagPrefix}/${symbol.kind}`];

  if (policy.includePathTags) {
    tags.push(...buildPathTags(symbol.filePath, policy.pathTagPrefix, policy.pathTagDepth));
  }

  if (policy.includeExtensionTag) {
    const ext = normalizeTag(path.extname(symbol.filePath).replace(/^\./, ''));
    if (ext) {
      tags.push(`code/ext/${ext}`);
    }
  }

  const normalizedPath = normalizePosix(symbol.filePath);
  for (const rule of policy.architectureRules) {
    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      tags.push(rule.tag);
    }
  }

  return uniqueTags(tags);
};

const buildIndexTags = (policy: TagPolicy): string[] => {
  return uniqueTags([...policy.baseTags, ...policy.indexTags, ...policy.architectureRules.map((rule) => rule.tag)]);
};

const renderFileNote = (
  generatedAt: string,
  file: FileNode,
  architectureTags: string[],
  layer: string,
  entryHints: EntryHint[],
  dependencyLinks: string[],
  dependentLinks: string[],
  symbolLinks: string[],
  importList: string[],
  mentionLinks: string[],
  tags: string[],
  emitInlineTags: boolean,
): string => {
  const inlineTags = toInlineTagLine(tags);
  const lines: string[] = [
    '---',
    'schema: code-map.file',
    `source_file: ${file.filePath}`,
    `updated_at: ${generatedAt}`,
    `tags: ${toYamlTagArray(tags)}`,
    '---',
    '',
    `# ${file.filePath}`,
    '',
    '## Overview',
    `- Layer: ${layer}`,
    `- Architecture: ${architectureTags.length > 0 ? architectureTags.join(', ') : '(unclassified)'}`,
    `- Entry Roles: ${entryHints.length > 0 ? entryHints.map((item) => `${item.role} (${item.reason})`).join(', ') : '(none)'}`,
    '',
    '## Primary Dependencies',
  ];

  if (dependencyLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of dependencyLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Primary Dependents');
  if (dependentLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of dependentLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Declared Symbols');

  if (emitInlineTags) {
    lines.splice(lines.length - 1, 0, inlineTags || '#code-map', '');
  }

  if (symbolLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of symbolLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Imports');
  if (importList.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of importList) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('', '## Related Symbols (Text Mentions)');
  if (mentionLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of mentionLinks) {
      lines.push(`- ${link}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const renderSymbolNote = (
  generatedAt: string,
  symbol: CodeSymbol,
  architectureTags: string[],
  layer: string,
  entryHints: EntryHint[],
  fileWikiLink: string,
  primaryLinks: string[],
  relatedLinks: string[],
  referencedByFiles: string[],
  tags: string[],
  emitInlineTags: boolean,
): string => {
  const inlineTags = toInlineTagLine(tags);
  const lines: string[] = [
    '---',
    'schema: code-map.symbol',
    `name: ${symbol.name}`,
    `kind: ${symbol.kind}`,
    `source_file: ${symbol.filePath}`,
    `source_line: ${String(symbol.line)}`,
    `updated_at: ${generatedAt}`,
    `tags: ${toYamlTagArray(tags)}`,
    '---',
    '',
    `# ${symbol.name} (${symbol.kind})`,
    '',
    '## Breadcrumb',
    `- Layer: ${layer}`,
    `- Architecture: ${architectureTags.length > 0 ? architectureTags.join(', ') : '(unclassified)'}`,
    `- Entry Context: ${entryHints.length > 0 ? entryHints.map((item) => item.role).join(', ') : '(none)'}`,
    '',
    `- Source: ${fileWikiLink}`,
    `- Signature: ${symbol.signature || '(unknown)'}`,
    '',
    '## Links To (Primary)',
  ];

  if (emitInlineTags) {
    lines.splice(lines.indexOf(`- Source: ${fileWikiLink}`), 0, inlineTags || '#code-map', '');
  }

  if (primaryLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of primaryLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Links To (Related Mentions)');
  if (relatedLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of relatedLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Referenced By Files');
  if (referencedByFiles.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of referencedByFiles) {
      lines.push(`- ${link}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

const renderIndexNote = (
  generatedAt: string,
  outputDir: string,
  repoPath: string,
  files: FileNode[],
  symbols: CodeSymbol[],
  topReferenced: Array<{ symbol: CodeSymbol; count: number }>,
  hubLinks: string[],
  tags: string[],
  emitInlineTags: boolean,
): string => {
  const inlineTags = toInlineTagLine(tags);
  const lines: string[] = [
    '---',
    'schema: code-map.index',
    `updated_at: ${generatedAt}`,
    `tags: ${toYamlTagArray(tags)}`,
    '---',
    '',
    '# Code Map Index',
    '',
    `- repo_path: ${repoPath}`,
    `- output_dir: ${outputDir}`,
    `- file_count: ${String(files.length)}`,
    `- symbol_count: ${String(symbols.length)}`,
    '',
    '## Navigation',
  ];

  if (hubLinks.length === 0) {
    lines.push('- (none)');
  } else {
    for (const link of hubLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push('', '## Hot Symbols');

  if (emitInlineTags) {
    lines.splice(lines.indexOf(`- repo_path: ${repoPath}`), 0, inlineTags || '#code-map', '');
  }

  if (topReferenced.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of topReferenced) {
      lines.push(`- ${toWikiLink(item.symbol.notePath, `${item.symbol.name} (${item.symbol.kind})`)} - refs: ${String(item.count)}`);
    }
  }

  lines.push('', '## Files', '');
  for (const file of files) {
    lines.push(`- ${toWikiLink(file.notePath, file.filePath)}`);
  }

  return `${lines.join('\n')}\n`;
};

const buildCodeMap = async (options: CliOptions): Promise<BuildResult> => {
  const outputRoot = path.resolve(options.vaultPath, options.outputDir);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await ensureDirectory(outputRoot);

  const sourceFiles = await collectSourceFiles(options.repoPath, options.includeExt, options.excludeDirs, outputRoot);

  const files: FileNode[] = [];
  const symbols: CodeSymbol[] = [];
  const symbolIdsByName = new Map<string, string[]>();
  const fileContents = new Map<string, string>();

  for (const absolutePath of sourceFiles) {
    const relativePath = normalizePosix(path.relative(options.repoPath, absolutePath));
    const content = await readTextFileSafe(absolutePath);
    fileContents.set(relativePath, content);

    const parsedSymbols = extractSymbols(content);
    const fileNoteName = `${sanitizeFileName(relativePath)}.md`;
    const fileNotePath = normalizePosix(path.join(options.outputDir, 'files', fileNoteName));

    const fileNode: FileNode = {
      filePath: relativePath,
      notePath: fileNotePath,
      imports: extractImports(content),
      symbolIds: [],
    };

    for (const parsed of parsedSymbols) {
      const id = `${parsed.kind}:${parsed.name}:${toShortHash(`${relativePath}:${String(parsed.line)}`)}`;
      const symbolNoteFileName = `${sanitizeFileName(parsed.name)}.${parsed.kind}.${toShortHash(id)}.md`;
      const symbolNotePath = normalizePosix(path.join(options.outputDir, 'symbols', parsed.kind, symbolNoteFileName));

      const symbol: CodeSymbol = {
        id,
        name: parsed.name,
        kind: parsed.kind,
        filePath: relativePath,
        line: parsed.line,
        signature: parsed.signature,
        notePath: symbolNotePath,
      };

      symbols.push(symbol);
      fileNode.symbolIds.push(symbol.id);

      const named = symbolIdsByName.get(symbol.name) || [];
      named.push(symbol.id);
      symbolIdsByName.set(symbol.name, named);
    }

    files.push(fileNode);
  }

  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const fileByPath = new Map(files.map((file) => [file.filePath, file]));
  const architectureTagsByFile = new Map<string, string[]>();
  const layerByFile = new Map<string, string>();
  const entryHintsByFile = new Map<string, EntryHint[]>();
  const importDepsByFile = new Map<string, Set<string>>();
  const importedByFile = new Map<string, Set<string>>();
  const referencedByFiles = new Map<string, Set<string>>();
  const linksToSymbolsByMention = new Map<string, Set<string>>();
  const linksToSymbolsByImport = new Map<string, Set<string>>();
  const fileMentionSymbols = new Map<string, Set<string>>();

  for (const file of files) {
    const architectureTags = getArchitectureTags(file.filePath, options.tagPolicy.architectureRules);
    architectureTagsByFile.set(file.filePath, architectureTags);
    layerByFile.set(file.filePath, classifyLayer(file.filePath));
    entryHintsByFile.set(file.filePath, detectEntryHints(file.filePath));
  }

  for (const file of files) {
    const dependencies = new Set<string>();
    for (const specifier of file.imports) {
      const resolved = resolveRelativeImport(file.filePath, specifier, fileByPath);
      if (!resolved || resolved === file.filePath) {
        continue;
      }
      dependencies.add(resolved);
      const reverse = importedByFile.get(resolved) || new Set<string>();
      reverse.add(file.filePath);
      importedByFile.set(resolved, reverse);
    }
    importDepsByFile.set(file.filePath, dependencies);
  }

  for (const file of files) {
    const content = fileContents.get(file.filePath) || '';
    const words = uniqueWords(content);
    const mentionedIds = new Set<string>();

    for (const token of words) {
      const ids = symbolIdsByName.get(token) || [];
      for (const id of ids) {
        mentionedIds.add(id);
        const referencedSet = referencedByFiles.get(id) || new Set<string>();
        referencedSet.add(file.filePath);
        referencedByFiles.set(id, referencedSet);
      }
    }

    fileMentionSymbols.set(file.filePath, mentionedIds);

    for (const declaredId of file.symbolIds) {
      const outgoing = linksToSymbolsByMention.get(declaredId) || new Set<string>();
      for (const mentionedId of mentionedIds) {
        if (mentionedId === declaredId) {
          continue;
        }
        outgoing.add(mentionedId);
      }
      linksToSymbolsByMention.set(declaredId, outgoing);

      const importOutgoing = linksToSymbolsByImport.get(declaredId) || new Set<string>();
      const dependencies = importDepsByFile.get(file.filePath) || new Set<string>();
      for (const dependencyFilePath of dependencies) {
        const dependency = fileByPath.get(dependencyFilePath);
        if (!dependency) {
          continue;
        }
        for (const dependentSymbolId of dependency.symbolIds) {
          if (dependentSymbolId === declaredId) {
            continue;
          }
          importOutgoing.add(dependentSymbolId);
        }
      }
      linksToSymbolsByImport.set(declaredId, importOutgoing);
    }
  }

  const generatedAt = new Date().toISOString();

  const hubLinks: string[] = [];
  const hubsDir = normalizePosix(path.join(options.outputDir, 'hubs'));
  const architectureHubDir = normalizePosix(path.join(hubsDir, 'architecture'));

  const systemHubPath = normalizePosix(path.join(hubsDir, '_SYSTEM.md'));
  const entryHubPath = normalizePosix(path.join(hubsDir, '_ENTRYPOINTS.md'));
  hubLinks.push(toWikiLink(systemHubPath, 'System Map'));
  hubLinks.push(toWikiLink(entryHubPath, 'Entrypoints'));

  const architectureToFiles = new Map<string, FileNode[]>();
  for (const file of files) {
    const tags = architectureTagsByFile.get(file.filePath) || [];
    for (const tag of tags) {
      const grouped = architectureToFiles.get(tag) || [];
      grouped.push(file);
      architectureToFiles.set(tag, grouped);
    }
  }

  const entryFiles = files
    .filter((file) => (entryHintsByFile.get(file.filePath) || []).length > 0)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  const systemHubLines: string[] = [
    '---',
    'schema: code-map.hub.system',
    `updated_at: ${generatedAt}`,
    `tags: ${toYamlTagArray(uniqueTags([...options.tagPolicy.baseTags, 'hub/system']))}`,
    '---',
    '',
    '# System Map',
    '',
    '## Navigation Order',
    '- 1) Entrypoints',
    '- 2) Architecture Hubs',
    '- 3) File Notes',
    '- 4) Symbol Notes',
    '',
    '## Entrypoints',
  ];

  if (entryFiles.length === 0) {
    systemHubLines.push('- (none)');
  } else {
    for (const file of entryFiles) {
      systemHubLines.push(`- ${toWikiLink(file.notePath, file.filePath)}`);
    }
  }

  systemHubLines.push('', '## Architecture Hubs');
  const architectureTags = [...architectureToFiles.keys()].sort((a, b) => a.localeCompare(b));
  if (architectureTags.length === 0) {
    systemHubLines.push('- (none)');
  } else {
    for (const archTag of architectureTags) {
      const archHubPath = normalizePosix(path.join(architectureHubDir, `${sanitizeFileName(archTag)}.md`));
      hubLinks.push(toWikiLink(archHubPath, archTag));
      systemHubLines.push(`- ${toWikiLink(archHubPath, archTag)}`);
    }
  }

  await writeMarkdown(path.resolve(options.vaultPath, systemHubPath), `${systemHubLines.join('\n')}\n`);

  const entryHubLines: string[] = [
    '---',
    'schema: code-map.hub.entrypoints',
    `updated_at: ${generatedAt}`,
    `tags: ${toYamlTagArray(uniqueTags([...options.tagPolicy.baseTags, 'hub/entrypoints']))}`,
    '---',
    '',
    '# Entrypoints',
    '',
  ];

  if (entryFiles.length === 0) {
    entryHubLines.push('- (none)');
  } else {
    for (const file of entryFiles) {
      const hints = entryHintsByFile.get(file.filePath) || [];
      entryHubLines.push(`- ${toWikiLink(file.notePath, file.filePath)} :: ${hints.map((item) => item.role).join(', ')}`);
    }
  }

  await writeMarkdown(path.resolve(options.vaultPath, entryHubPath), `${entryHubLines.join('\n')}\n`);

  for (const archTag of architectureTags) {
    const archHubPath = normalizePosix(path.join(architectureHubDir, `${sanitizeFileName(archTag)}.md`));
    const archFiles = (architectureToFiles.get(archTag) || []).sort((a, b) => a.filePath.localeCompare(b.filePath));
    const archLines: string[] = [
      '---',
      'schema: code-map.hub.architecture',
      `updated_at: ${generatedAt}`,
      `architecture: ${archTag}`,
      `tags: ${toYamlTagArray(uniqueTags([...options.tagPolicy.baseTags, 'hub/architecture', archTag]))}`,
      '---',
      '',
      `# Architecture Hub: ${archTag}`,
      '',
      `- file_count: ${String(archFiles.length)}`,
      '',
      '## Files',
    ];

    if (archFiles.length === 0) {
      archLines.push('- (none)');
    } else {
      for (const file of archFiles) {
        archLines.push(`- ${toWikiLink(file.notePath, file.filePath)}`);
      }
    }

    await writeMarkdown(path.resolve(options.vaultPath, archHubPath), `${archLines.join('\n')}\n`);
  }

  for (const file of files) {
    const symbolLinks = file.symbolIds
      .map((id) => symbolById.get(id))
      .filter((value): value is CodeSymbol => Boolean(value))
      .map((symbol) => toWikiLink(symbol.notePath, `${symbol.name} (${symbol.kind})`));

    const mentions = [...(fileMentionSymbols.get(file.filePath) || new Set<string>())]
      .map((id) => symbolById.get(id))
      .filter((value): value is CodeSymbol => Boolean(value))
      .filter((symbol) => !file.symbolIds.includes(symbol.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((symbol) => toWikiLink(symbol.notePath, `${symbol.name} (${symbol.kind})`));

    const dependencies = [...(importDepsByFile.get(file.filePath) || new Set<string>())]
      .map((pathKey) => fileByPath.get(pathKey))
      .filter((value): value is FileNode => Boolean(value))
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((dep) => toWikiLink(dep.notePath, dep.filePath));

    const dependents = [...(importedByFile.get(file.filePath) || new Set<string>())]
      .map((pathKey) => fileByPath.get(pathKey))
      .filter((value): value is FileNode => Boolean(value))
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((dep) => toWikiLink(dep.notePath, dep.filePath));

    const tags = buildFileTags(file.filePath, options.tagPolicy);
    const content = renderFileNote(
      generatedAt,
      file,
      architectureTagsByFile.get(file.filePath) || [],
      layerByFile.get(file.filePath) || 'misc',
      entryHintsByFile.get(file.filePath) || [],
      dependencies,
      dependents,
      symbolLinks,
      file.imports,
      mentions,
      tags,
      options.tagPolicy.emitInlineTags,
    );
    const absoluteNotePath = path.resolve(options.vaultPath, file.notePath);
    await writeMarkdown(absoluteNotePath, content);
  }

  for (const symbol of symbols) {
    const fileNode = fileByPath.get(symbol.filePath);
    const fileWikiLink = fileNode ? toWikiLink(fileNode.notePath, symbol.filePath) : symbol.filePath;

    const primaryLinks = [...(linksToSymbolsByImport.get(symbol.id) || new Set<string>())]
      .map((id) => symbolById.get(id))
      .filter((value): value is CodeSymbol => Boolean(value))
      .filter((target) => target.id !== symbol.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((target) => toWikiLink(target.notePath, `${target.name} (${target.kind})`));

    const relatedLinks = [...(linksToSymbolsByMention.get(symbol.id) || new Set<string>())]
      .map((id) => symbolById.get(id))
      .filter((value): value is CodeSymbol => Boolean(value))
      .filter((target) => target.id !== symbol.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((target) => toWikiLink(target.notePath, `${target.name} (${target.kind})`));

    const refFiles = [...(referencedByFiles.get(symbol.id) || new Set<string>())]
      .map((filePath) => fileByPath.get(filePath))
      .filter((value): value is FileNode => Boolean(value))
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((file) => toWikiLink(file.notePath, file.filePath));

    const tags = buildSymbolTags(symbol, options.tagPolicy);
    const content = renderSymbolNote(
      generatedAt,
      symbol,
      architectureTagsByFile.get(symbol.filePath) || [],
      layerByFile.get(symbol.filePath) || 'misc',
      entryHintsByFile.get(symbol.filePath) || [],
      fileWikiLink,
      primaryLinks,
      relatedLinks,
      refFiles,
      tags,
      options.tagPolicy.emitInlineTags,
    );
    const absoluteNotePath = path.resolve(options.vaultPath, symbol.notePath);
    await writeMarkdown(absoluteNotePath, content);
  }

  const topReferenced = symbols
    .map((symbol) => ({ symbol, count: (referencedByFiles.get(symbol.id) || new Set<string>()).size }))
    .sort((a, b) => b.count - a.count || a.symbol.name.localeCompare(b.symbol.name))
    .slice(0, 30);

  const indexTags = buildIndexTags(options.tagPolicy);
  const indexContent = renderIndexNote(
    generatedAt,
    options.outputDir,
    options.repoPath,
    files,
    symbols,
    topReferenced,
    [...new Set(hubLinks)],
    indexTags,
    options.tagPolicy.emitInlineTags,
  );
  await writeMarkdown(path.resolve(options.vaultPath, options.outputDir, '_INDEX.md'), indexContent);

  return { files, symbols };
};

const shouldIgnoreChangedPath = (absolutePath: string, options: CliOptions, outputRoot: string): boolean => {
  if (!absolutePath) {
    return true;
  }
  if (absolutePath.startsWith(outputRoot + path.sep) || absolutePath === outputRoot) {
    return true;
  }

  const relative = normalizePosix(path.relative(options.repoPath, absolutePath));
  if (relative.startsWith('..')) {
    return true;
  }

  const parts = relative.split('/').filter(Boolean);
  if (parts.some((part) => shouldSkipDirectory(part, options.excludeDirs))) {
    return true;
  }

  if (path.extname(absolutePath)) {
    return !hasIncludedExtension(absolutePath, options.includeExt);
  }

  return false;
};

const runWithLogs = async (options: CliOptions): Promise<void> => {
  const startedAt = Date.now();
  const result = await buildCodeMap(options);
  const durationMs = Date.now() - startedAt;

  console.log(
    `[obsidian-code-map] generated files=${String(result.files.length)} symbols=${String(result.symbols.length)} durationMs=${String(durationMs)} output=${normalizePosix(path.join(options.vaultPath, options.outputDir))}`,
  );
};

const startWatchMode = async (options: CliOptions): Promise<void> => {
  const outputRoot = path.resolve(options.vaultPath, options.outputDir);
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let queued = false;

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      if (running) {
        queued = true;
        return;
      }

      running = true;
      try {
        await runWithLogs(options);
      } catch (error) {
        console.error('[obsidian-code-map] watch generation failed:', error instanceof Error ? error.message : String(error));
      } finally {
        running = false;
      }

      if (queued) {
        queued = false;
        schedule();
      }
    }, options.debounceMs);
  };

  await runWithLogs(options);

  const watcher = fsWatch(options.repoPath, { recursive: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }
    const absolutePath = path.resolve(options.repoPath, filename.toString());
    if (shouldIgnoreChangedPath(absolutePath, options, outputRoot)) {
      return;
    }
    schedule();
  });

  console.log(`[obsidian-code-map] watch enabled repo=${normalizePosix(options.repoPath)} debounceMs=${String(options.debounceMs)}`);

  const stop = (): void => {
    watcher.close();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    console.log('[obsidian-code-map] watch stopped');
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  options.repoPath = await ensureDirectoryPath(options.repoPath, 'repo');
  options.vaultPath = await ensureDirectoryPath(options.vaultPath, 'vault');

  if (options.watch) {
    await startWatchMode(options);
    return;
  }

  await runWithLogs(options);
};

main().catch((error) => {
  console.error('[obsidian-code-map] fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseBooleanEnv } from '../../../utils/env';
import type {
  ObsidianLoreQuery,
  ObsidianNode,
  ObsidianNoteWriteInput,
  ObsidianSearchQuery,
  ObsidianSearchResult,
  ObsidianVaultAdapter,
} from '../types';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const DEFAULT_MAX_DOCS = 40;
const DEFAULT_INDEX_TTL_MS = 15_000;

type IndexedDoc = {
  title: string;
  filePath: string;
  content: string;
  excerpt: string;
  modifiedAtMs: number;
  tags: string[];
  tagsLower: string[];
  wordsLower: string[];
  links: string[];
  backlinks: string[];
};

type RawDoc = Omit<IndexedDoc, 'links' | 'backlinks'> & {
  linkTargets: string[];
};

type VaultIndex = {
  docsByPath: Map<string, IndexedDoc>;
  tags: Map<string, Set<string>>;
  connectivityByPath: Map<string, number>;
  builtAt: number;
  expiresAt: number;
};

const OBSIDIAN_LOCAL_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_LOCAL_FS_ENABLED, true);

const SEARCH_TEXT_WEIGHT = Number(process.env.OBSIDIAN_SEARCH_WEIGHT_TEXT ?? 1);
const SEARCH_TITLE_WEIGHT = Number(process.env.OBSIDIAN_SEARCH_WEIGHT_TITLE ?? 1.2);
const SEARCH_TAG_WEIGHT = Number(process.env.OBSIDIAN_SEARCH_WEIGHT_TAG ?? 2.5);
const SEARCH_CONNECTIVITY_WEIGHT = Number(process.env.OBSIDIAN_SEARCH_WEIGHT_CONNECTIVITY ?? 1.1);
const SEARCH_RECENCY_WEIGHT = Number(process.env.OBSIDIAN_SEARCH_WEIGHT_RECENCY ?? 1.3);
const SEARCH_RECENCY_HALFLIFE_HOURS = Number(process.env.OBSIDIAN_SEARCH_RECENCY_HALFLIFE_HOURS ?? 72);

const localIndexCache = new Map<string, VaultIndex>();
const localIndexRefreshLocks = new Map<string, Promise<VaultIndex>>();

function indexTtlMs(): number {
  const raw = Number(process.env.OBSIDIAN_LOCAL_INDEX_TTL_MS ?? DEFAULT_INDEX_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_INDEX_TTL_MS;
  }
  return raw;
}

function normalizeVaultKey(vaultPath: string): string {
  return path.resolve(vaultPath);
}

function normalizePathToPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function parseTags(content: string): string[] {
  const tagMatches = content.match(/(^|\s)#([a-zA-Z0-9_\/-]+)/g) ?? [];
  const uniqueTags = new Set(
    tagMatches
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .map((token) => token.slice(token.startsWith('#') ? 1 : token.indexOf('#') + 1).toLowerCase()),
  );

  return [...uniqueTags];
}

function parseWikilinks(content: string): string[] {
  const linkMatches = content.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g) ?? [];
  const uniqueLinks = new Set(
    linkMatches
      .map((match) => {
        const inner = match.slice(2, -2);
        const base = inner.split('|')[0] ?? '';
        const target = base.split('#')[0] ?? '';
        return target.trim();
      })
      .filter(Boolean),
  );

  return [...uniqueLinks];
}

function toTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_\-/]+/g)
    .filter(Boolean);
}

function buildExcerpt(content: string, maxLength = 600): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n...`;
}

function estimateRelevance(content: string, query: string): number {
  const haystack = content.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) {
    return 0;
  }

  let score = 0;
  const occurrences = haystack.split(needle).length - 1;
  score += occurrences * 5;

  if (haystack.startsWith(needle)) {
    score += 4;
  }

  const titleLike = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  if (titleLike.includes(needle)) {
    score += 3;
  }

  return score;
}

function clampFinite(value: number, fallback: number, min = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, value);
}

function computeRecencyBonus(modifiedAtMs: number, nowMs: number): number {
  const safeHalfLife = clampFinite(SEARCH_RECENCY_HALFLIFE_HOURS, 72, 1);
  const ageMs = Math.max(0, nowMs - modifiedAtMs);
  const halfLifeMs = safeHalfLife * 60 * 60 * 1000;
  const freshness = Math.exp(-Math.log(2) * (ageMs / halfLifeMs));
  return freshness * 10;
}

function parseSearchIntent(rawQuery: string): { terms: string[]; requiredTags: string[] } {
  const query = String(rawQuery || '').toLowerCase().trim();
  if (!query) {
    return { terms: [], requiredTags: [] };
  }

  const tagPattern = /(?:^|\s)(?:tag:|#)([a-z0-9_\/-]+)/g;
  const requiredTagsSet = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(query)) !== null) {
    const tag = String(match[1] || '').trim().toLowerCase();
    if (tag) {
      requiredTagsSet.add(tag);
    }
  }

  const strippedQuery = query.replace(tagPattern, ' ');
  const terms = toTerms(strippedQuery);

  return {
    terms,
    requiredTags: [...requiredTagsSet],
  };
}

function buildConnectivityMap(docsByPath: Map<string, IndexedDoc>): Map<string, number> {
  const out = new Map<string, number>();
  for (const doc of docsByPath.values()) {
    const rawConnectivity = doc.links.length + (doc.backlinks.length * 1.5);
    const score = Math.log1p(rawConnectivity) * 4;
    out.set(doc.filePath, score);
  }
  return out;
}

async function withConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) {
            return;
          }
          await walk(absolute);
          return;
        }

        if (entry.isFile() && isMarkdownFile(absolute)) {
          output.push(absolute);
        }
      }),
    );
  }

  await walk(root);
  return output;
}

function normalizeRawDoc(rawPath: string, rawContent: string, root: string, modifiedAtMs = Date.now()): RawDoc {
  const relPath = normalizePathToPosix(path.relative(root, rawPath));
  const tags = parseTags(rawContent);

  return {
    title: path.basename(rawPath, path.extname(rawPath)),
    filePath: relPath,
    content: rawContent,
    excerpt: buildExcerpt(rawContent),
    modifiedAtMs,
    tags,
    tagsLower: tags.map((tag) => tag.toLowerCase()),
    wordsLower: toTerms(rawContent),
    linkTargets: parseWikilinks(rawContent),
  };
}

function resolveDocLinks(docs: RawDoc[]): IndexedDoc[] {
  const pathSet = new Set(docs.map((doc) => doc.filePath));
  const basenameIndex = new Map<string, string[]>();

  for (const doc of docs) {
    const base = path.basename(doc.filePath, path.extname(doc.filePath)).toLowerCase();
    const list = basenameIndex.get(base);
    if (list) {
      list.push(doc.filePath);
    } else {
      basenameIndex.set(base, [doc.filePath]);
    }
  }

  return docs.map((doc) => {
    const links = new Set<string>();

    for (const target of doc.linkTargets) {
      const targetNormalized = target.replace(/\\/g, '/').trim();
      if (!targetNormalized) {
        continue;
      }

      if (targetNormalized.includes('/')) {
        const withMd = targetNormalized.endsWith('.md') ? targetNormalized : `${targetNormalized}.md`;
        if (pathSet.has(withMd)) {
          links.add(withMd);
          continue;
        }
      }

      const candidates = basenameIndex.get(targetNormalized.toLowerCase());
      if (candidates && candidates.length > 0) {
        links.add(candidates[0]);
      }
    }

    return {
      ...doc,
      links: [...links],
      backlinks: [],
    };
  });
}

function buildBacklinksForDoc(filePath: string, docsByPath: Map<string, IndexedDoc>): string[] {
  const backlinks: string[] = [];
  for (const [candidatePath, doc] of docsByPath.entries()) {
    if (candidatePath === filePath) {
      continue;
    }
    if (doc.links.includes(filePath)) {
      backlinks.push(candidatePath);
    }
  }
  return backlinks;
}

async function buildVaultIndex(vaultPath: string): Promise<VaultIndex> {
  const normalizedRoot = path.resolve(vaultPath);
  const files = await listMarkdownFiles(normalizedRoot);
  const normalizedDocs: RawDoc[] = [];

  await withConcurrency(files, 16, async (absolutePath) => {
    let content: string;
    let modifiedAtMs = Date.now();
    try {
      const [fileContent, fileStat] = await Promise.all([
        fs.readFile(absolutePath, 'utf8'),
        fs.stat(absolutePath),
      ]);
      content = fileContent;
      modifiedAtMs = fileStat.mtimeMs;
    } catch {
      return;
    }

    normalizedDocs.push(normalizeRawDoc(absolutePath, content, normalizedRoot, modifiedAtMs));
  });

  const docs = resolveDocLinks(normalizedDocs);
  const docsByPath = new Map<string, IndexedDoc>();
  const tags = new Map<string, Set<string>>();

  for (const doc of docs) {
    docsByPath.set(doc.filePath, doc);
    for (const tag of doc.tagsLower) {
      const set = tags.get(tag);
      if (set) {
        set.add(doc.filePath);
      } else {
        tags.set(tag, new Set([doc.filePath]));
      }
    }
  }

  for (const doc of docsByPath.values()) {
    doc.backlinks = buildBacklinksForDoc(doc.filePath, docsByPath);
  }

  const now = Date.now();
  const connectivityByPath = buildConnectivityMap(docsByPath);
  return {
    docsByPath,
    tags,
    connectivityByPath,
    builtAt: now,
    expiresAt: now + indexTtlMs(),
  };
}

function triggerBackgroundRebuild(vaultPath: string): void {
  void getVaultIndex(vaultPath, { allowStale: false, forceRefresh: true });
}

async function getVaultIndex(
  vaultPath: string,
  options: { allowStale?: boolean; forceRefresh?: boolean } = {},
): Promise<VaultIndex> {
  const key = normalizeVaultKey(vaultPath);
  const cached = localIndexCache.get(key);
  const now = Date.now();
  const isFresh = Boolean(cached && cached.expiresAt > now);

  if (!options.forceRefresh && cached && (isFresh || options.allowStale)) {
    if (!isFresh) {
      triggerBackgroundRebuild(vaultPath);
    }
    return cached;
  }

  const inFlight = localIndexRefreshLocks.get(key);
  if (inFlight) {
    return inFlight;
  }

  const refreshPromise = buildVaultIndex(vaultPath)
    .then((index) => {
      localIndexCache.set(key, index);
      return index;
    })
    .finally(() => {
      localIndexRefreshLocks.delete(key);
    });

  localIndexRefreshLocks.set(key, refreshPromise);
  return refreshPromise;
}

function toLoreHints(docs: IndexedDoc[], maxDocs: number): string[] {
  return docs
    .slice(0, Math.max(1, maxDocs))
    .map((doc) => {
      const tagPart = doc.tags.length > 0 ? ` tags=${doc.tags.slice(0, 5).join(',')}` : '';
      return `[obsidian-local] ${doc.filePath}${tagPart} :: ${doc.excerpt.replace(/\s+/g, ' ').slice(0, 220)}`;
    });
}

function applySearchQuery(index: VaultIndex, query: ObsidianSearchQuery): ObsidianSearchResult[] {
  const docs = [...index.docsByPath.values()];
  const queryText = query.query.trim().toLowerCase();
  const { terms, requiredTags } = parseSearchIntent(queryText);

  const taggedCandidates = requiredTags.length > 0
    ? requiredTags
      .map((tag) => index.tags.get(tag))
      .filter((set): set is Set<string> => Boolean(set))
    : [];

  const requiredTagPaths = new Set<string>();
  if (requiredTags.length > 0) {
    if (taggedCandidates.length !== requiredTags.length) {
      return [];
    }

    const [first, ...rest] = taggedCandidates;
    for (const candidate of first) {
      if (rest.every((set) => set.has(candidate))) {
        requiredTagPaths.add(candidate);
      }
    }
  }

  const filtered = docs.filter((doc) => {
    if (requiredTags.length > 0 && !requiredTagPaths.has(doc.filePath)) {
      return false;
    }

    if (terms.length === 0) {
      return requiredTags.length > 0 || queryText.length === 0;
    }

    const hasTextMatch = terms.every((term) => doc.wordsLower.some((word) => word.includes(term)));
    if (hasTextMatch) {
      return true;
    }

    return terms.every((term) => doc.title.toLowerCase().includes(term));
  });

  return filtered
    .map((doc) => {
      const nowMs = Date.now();
      const baseScore = estimateRelevance(`${doc.title}\n${doc.content}`, queryText)
        * clampFinite(SEARCH_TEXT_WEIGHT, 1);
      const titleMatchBonus = terms.reduce((sum, term) => (
        doc.title.toLowerCase().includes(term) ? sum + 2 : sum
      ), 0) * clampFinite(SEARCH_TITLE_WEIGHT, 1.2);
      const tagBonus = requiredTags.reduce((sum, tag) => (
        doc.tagsLower.includes(tag) ? sum + 7 : sum
      ), 0) * clampFinite(SEARCH_TAG_WEIGHT, 2.5);
      const connectivityBonus = (index.connectivityByPath.get(doc.filePath) ?? 0)
        * clampFinite(SEARCH_CONNECTIVITY_WEIGHT, 1.1);
      const recencyBonus = computeRecencyBonus(doc.modifiedAtMs, nowMs)
        * clampFinite(SEARCH_RECENCY_WEIGHT, 1.3);
      const score = baseScore + titleMatchBonus + tagBonus + connectivityBonus;

      return {
        filePath: doc.filePath,
        title: doc.title,
        score: score + recencyBonus,
      };
    })
    .sort((a, b) => (b.score - a.score) || a.filePath.localeCompare(b.filePath))
    .slice(0, Math.max(1, query.limit));
}

function toGraphMetadata(index: VaultIndex): Record<string, ObsidianNode> {
  const output: Record<string, ObsidianNode> = {};

  for (const doc of index.docsByPath.values()) {
    output[doc.filePath] = {
      filePath: doc.filePath,
      title: doc.title,
      tags: doc.tags,
      backlinks: doc.backlinks,
      links: doc.links,
    };
  }

  return output;
}

function ensureMarkdownFileName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.toLowerCase().endsWith('.md')) {
    return normalized;
  }
  return `${normalized}.md`;
}

function renderFrontmatter(
  properties: Record<string, string | number | boolean | null> | undefined,
  tags: string[] | undefined,
  body: string,
): string {
  const safeProperties = properties ?? {};
  const safeTags = (tags ?? []).map((tag) => String(tag || '').trim()).filter(Boolean);

  if (Object.keys(safeProperties).length === 0 && safeTags.length === 0) {
    return body;
  }

  const lines: string[] = ['---'];

  if (safeTags.length > 0) {
    lines.push(`tags: [${safeTags.map((tag) => JSON.stringify(tag)).join(', ')}]`);
  }

  for (const [key, value] of Object.entries(safeProperties)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }

  lines.push('---', '', body);
  return lines.join('\n');
}

async function writeNote(params: ObsidianNoteWriteInput): Promise<{ path: string }> {
  const vaultRoot = path.resolve(params.vaultPath);
  const safeRelativePath = ensureMarkdownFileName(params.fileName);
  const absolutePath = path.resolve(vaultRoot, safeRelativePath);

  if (!absolutePath.startsWith(vaultRoot)) {
    throw new Error('Refused to write outside vault path');
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const rendered = renderFrontmatter(params.properties, params.tags, params.content);
  await fs.writeFile(absolutePath, rendered, 'utf8');
  const modifiedAtMs = Date.now();

  const key = normalizeVaultKey(vaultRoot);
  const cached = localIndexCache.get(key);
  if (cached && cached.docsByPath.size > 0) {
    const existingRawDocs: RawDoc[] = [...cached.docsByPath.values()].map((doc) => ({
      title: doc.title,
      filePath: doc.filePath,
      content: doc.content,
      excerpt: doc.excerpt,
      modifiedAtMs: doc.modifiedAtMs,
      tags: doc.tags,
      tagsLower: doc.tagsLower,
      wordsLower: doc.wordsLower,
      linkTargets: doc.links,
    }));

    const normalizedNew = normalizeRawDoc(absolutePath, rendered, vaultRoot, modifiedAtMs);
    const filtered = existingRawDocs.filter((doc) => doc.filePath !== normalizedNew.filePath);
    const rehydrated = resolveDocLinks([...filtered, normalizedNew]);

    const docsByPath = new Map<string, IndexedDoc>();
    const tags = new Map<string, Set<string>>();

    for (const doc of rehydrated) {
      docsByPath.set(doc.filePath, doc);
      for (const tag of doc.tagsLower) {
        const set = tags.get(tag);
        if (set) {
          set.add(doc.filePath);
        } else {
          tags.set(tag, new Set([doc.filePath]));
        }
      }
    }

    for (const doc of docsByPath.values()) {
      doc.backlinks = buildBacklinksForDoc(doc.filePath, docsByPath);
    }

    const now = Date.now();
    const connectivityByPath = buildConnectivityMap(docsByPath);
    localIndexCache.set(key, {
      docsByPath,
      tags,
      connectivityByPath,
      builtAt: now,
      expiresAt: now + indexTtlMs(),
    });
  }

  triggerBackgroundRebuild(vaultRoot);

  return { path: normalizePathToPosix(path.relative(vaultRoot, absolutePath)) };
}

export const localFsObsidianAdapter: ObsidianVaultAdapter = {
  id: 'local-fs',
  capabilities: ['read_lore', 'search_vault', 'read_file', 'graph_metadata', 'write_note'],
  isAvailable: () => OBSIDIAN_LOCAL_ENABLED,
  async readLore(params: ObsidianLoreQuery): Promise<string[]> {
    const index = await getVaultIndex(params.vaultPath, { allowStale: true });
    const docs = [...index.docsByPath.values()]
      .sort((a, b) => b.backlinks.length + b.links.length - (a.backlinks.length + a.links.length));

    return toLoreHints(docs, DEFAULT_MAX_DOCS);
  },
  async searchVault(params: ObsidianSearchQuery): Promise<ObsidianSearchResult[]> {
    const index = await getVaultIndex(params.vaultPath, { allowStale: true });
    return applySearchQuery(index, params);
  },
  async readFile(params: { vaultPath: string; filePath: string }): Promise<string | null> {
    const safeRelativePath = params.filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const vaultRoot = path.resolve(params.vaultPath);
    const absolutePath = path.resolve(vaultRoot, safeRelativePath);
    if (!absolutePath.startsWith(vaultRoot)) {
      return null;
    }

    try {
      return await fs.readFile(absolutePath, 'utf8');
    } catch {
      return null;
    }
  },
  async getGraphMetadata(params: { vaultPath: string }): Promise<Record<string, ObsidianNode>> {
    const index = await getVaultIndex(params.vaultPath, { allowStale: true });
    return toGraphMetadata(index);
  },
  async writeNote(params: ObsidianNoteWriteInput): Promise<{ path: string }> {
    return writeNote(params);
  },
  async warmup({ vaultPath }: { vaultPath: string }): Promise<void> {
    await getVaultIndex(vaultPath, { allowStale: false });
  },
};

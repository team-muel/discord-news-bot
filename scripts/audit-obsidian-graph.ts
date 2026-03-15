/* eslint-disable no-console */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getObsidianVaultRoot } from '../src/utils/obsidianEnv';

type NoteNode = {
  filePath: string;
  title: string;
  tags: string[];
  properties: Record<string, string>;
  links: string[];
  backlinks: string[];
};

type GraphAuditSnapshot = {
  generatedAt: string;
  vaultPath: string;
  totals: {
    files: number;
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  topTags: Array<{ tag: string; count: number }>;
  thresholds: {
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  ambiguousLinkSamples: Array<{ from: string; target: string; candidates: string[] }>;
  pass: boolean;
};

const DEFAULT_REQUIRED_PROPERTIES = ['schema', 'source', 'guild_id', 'title', 'category', 'updated_at'];

const parseArgs = (): { vaultPath: string } => {
  const args = process.argv.slice(2);
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--vault' || current === '--vault-path') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        vaultPath = value;
      }
      i += 1;
    }
  }

  return { vaultPath };
};

const ensureVaultPath = async (vaultPath: string): Promise<string> => {
  const trimmed = String(vaultPath || '').trim();
  if (!trimmed) {
    throw new Error('vault path is required. Set OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
  }

  const resolved = path.resolve(trimmed);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`vault path is not a directory: ${resolved}`);
  }
  return resolved;
};

const normalizePosix = (value: string): string => value.split(path.sep).join('/');

const toTerms = (value: string): string[] => {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_\-/]+/g)
    .filter(Boolean);
};

const parseFrontmatter = (content: string): Record<string, string> => {
  const match = String(content || '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(':')) {
      continue;
    }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    out[key] = value;
  }
  return out;
};

const parseTags = (content: string): string[] => {
  const tags = new Set<string>();
  const hashTags = String(content || '').match(/(^|\s)#([a-zA-Z0-9_\/-]+)/g) || [];
  for (const token of hashTags) {
    const normalized = token.trim().replace(/^#/, '').toLowerCase();
    if (normalized) {
      tags.add(normalized);
    }
  }

  const fm = parseFrontmatter(content);
  const fmTags = String(fm.tags || '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((item) => item.replace(/^"|"$/g, '').trim().toLowerCase())
    .filter(Boolean);

  for (const tag of fmTags) {
    tags.add(tag);
  }

  return [...tags];
};

const parseWikiLinks = (content: string): string[] => {
  const matches = String(content || '').match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g) || [];
  const out = new Set<string>();
  for (const full of matches) {
    const inner = full.slice(2, -2);
    const base = inner.split('|')[0] || '';
    const target = base.split('#')[0] || '';
    const normalized = target.trim();
    if (normalized) {
      out.add(normalized);
    }
  }
  return [...out];
};

const listMarkdownFiles = async (root: string): Promise<string[]> => {
  const output: string[] = [];

  const walk = async (current: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        output.push(absolute);
      }
    }
  };

  await walk(root);
  return output;
};

const parseRequiredProperties = (): string[] => {
  const raw = String(process.env.OBSIDIAN_AUDIT_REQUIRED_PROPERTIES || DEFAULT_REQUIRED_PROPERTIES.join(','));
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toNumberEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name] || '');
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const main = async (): Promise<void> => {
  const { vaultPath } = parseArgs();
  const configuredVaultPath = String(vaultPath || getObsidianVaultRoot() || '').trim();
  if (!configuredVaultPath) {
    console.error('[obsidian-audit] vault path is required. Set OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
    process.exit(2);
  }

  let resolvedVault = '';
  try {
    resolvedVault = await ensureVaultPath(configuredVaultPath);
  } catch (error) {
    console.error('[obsidian-audit] invalid vault path:', error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const files = await listMarkdownFiles(resolvedVault);
  const nodes = new Map<string, NoteNode>();
  const basenameIndex = new Map<string, string[]>();

  for (const absolute of files) {
    const relative = normalizePosix(path.relative(resolvedVault, absolute));
    const content = await fs.readFile(absolute, 'utf8');
    const properties = parseFrontmatter(content);
    const tags = parseTags(content);
    const links = parseWikiLinks(content);
    const title = path.basename(relative, path.extname(relative));

    nodes.set(relative, {
      filePath: relative,
      title,
      tags,
      properties,
      links,
      backlinks: [],
    });

    const baseKey = toTerms(title).join(' ');
    const current = basenameIndex.get(baseKey) || [];
    current.push(relative);
    basenameIndex.set(baseKey, current);
  }

  const unresolved: Array<{ from: string; target: string }> = [];
  const ambiguous: Array<{ from: string; target: string; candidates: string[] }> = [];

  for (const node of nodes.values()) {
    for (const rawTarget of node.links) {
      const target = normalizePosix(rawTarget);
      let resolvedPath: string | null = null;

      if (target.includes('/')) {
        const withExt = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`;
        if (nodes.has(withExt)) {
          resolvedPath = withExt;
        }
      } else {
        const key = toTerms(target).join(' ');
        const candidates = basenameIndex.get(key) || [];
        if (candidates.length > 0) {
          resolvedPath = candidates[0];
        }
        if (candidates.length > 1) {
          ambiguous.push({ from: node.filePath, target: rawTarget, candidates: [...candidates] });
        }
      }

      if (!resolvedPath) {
        unresolved.push({ from: node.filePath, target: rawTarget });
        continue;
      }

      const targetNode = nodes.get(resolvedPath);
      if (targetNode) {
        targetNode.backlinks.push(node.filePath);
      }
    }
  }

  const orphans = [...nodes.values()].filter((node) => node.backlinks.length === 0).map((node) => node.filePath);
  const deadends = [...nodes.values()].filter((node) => node.links.length === 0).map((node) => node.filePath);

  const requiredProperties = parseRequiredProperties();
  const missingPropertyFiles = [...nodes.values()]
    .map((node) => {
      const missing = requiredProperties.filter((key) => !Object.prototype.hasOwnProperty.call(node.properties, key));
      return { filePath: node.filePath, missing };
    })
    .filter((item) => item.missing.length > 0);

  const tagCount = new Map<string, number>();
  for (const node of nodes.values()) {
    for (const tag of node.tags) {
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    }
  }

  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  const thresholds = {
    unresolvedLinks: toNumberEnv('OBSIDIAN_AUDIT_MAX_UNRESOLVED', 50),
    ambiguousLinks: toNumberEnv('OBSIDIAN_AUDIT_MAX_AMBIGUOUS', 20),
    orphanFiles: toNumberEnv('OBSIDIAN_AUDIT_MAX_ORPHANS', 200),
    deadendFiles: toNumberEnv('OBSIDIAN_AUDIT_MAX_DEADENDS', 200),
    missingRequiredPropertyFiles: toNumberEnv('OBSIDIAN_AUDIT_MAX_MISSING_PROPERTIES', 50),
  };

  const snapshot: GraphAuditSnapshot = {
    generatedAt: new Date().toISOString(),
    vaultPath: resolvedVault,
    totals: {
      files: nodes.size,
      unresolvedLinks: unresolved.length,
      ambiguousLinks: ambiguous.length,
      orphanFiles: orphans.length,
      deadendFiles: deadends.length,
      missingRequiredPropertyFiles: missingPropertyFiles.length,
    },
    topTags,
    thresholds,
    ambiguousLinkSamples: ambiguous.slice(0, 20),
    pass:
      unresolved.length <= thresholds.unresolvedLinks
      && ambiguous.length <= thresholds.ambiguousLinks
      && orphans.length <= thresholds.orphanFiles
      && deadends.length <= thresholds.deadendFiles
      && missingPropertyFiles.length <= thresholds.missingRequiredPropertyFiles,
  };

  const runtimeDir = path.resolve(process.cwd(), '.runtime');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'obsidian-graph-audit.json'), JSON.stringify(snapshot, null, 2), 'utf8');

  console.log('[obsidian-audit] done');
  console.log(`[obsidian-audit] files=${snapshot.totals.files}`);
  console.log(`[obsidian-audit] unresolved=${snapshot.totals.unresolvedLinks}`);
  console.log(`[obsidian-audit] ambiguous=${snapshot.totals.ambiguousLinks}`);
  console.log(`[obsidian-audit] orphans=${snapshot.totals.orphanFiles}`);
  console.log(`[obsidian-audit] deadends=${snapshot.totals.deadendFiles}`);
  console.log(`[obsidian-audit] missingRequiredProperties=${snapshot.totals.missingRequiredPropertyFiles}`);
  console.log(`[obsidian-audit] pass=${snapshot.pass}`);

  if (!snapshot.pass) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('[obsidian-audit] unexpected error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

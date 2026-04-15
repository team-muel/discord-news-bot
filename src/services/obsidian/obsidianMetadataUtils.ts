type ObsidianFrontmatter = Record<string, unknown> | undefined;

export type GuildScopeMode = 'off' | 'prefer' | 'strict';

type GuildScopedPathCandidate = {
  filePath: string;
};

export function normalizeResultPath(filePath: unknown): string {
  return String(filePath || '').trim().replace(/\\/g, '/');
}

export function normalizeMetadataReference(value: unknown): string {
  return normalizeResultPath(value).replace(/\.md$/i, '').toLowerCase();
}

export function sanitizeGuildId(value: unknown): string {
  const candidate = String(value || '').trim();
  if (!/^\d{6,30}$/.test(candidate)) {
    return '';
  }
  return candidate;
}

export function stripFrontmatterBlock(content: string): string {
  return String(content || '').replace(/^---\n[\s\S]*?\n---\n?/m, '').trim();
}

export function readFrontmatterString(frontmatter: ObsidianFrontmatter, key: string): string {
  return String(frontmatter?.[key] || '').trim();
}

export function readFrontmatterStringArray(frontmatter: ObsidianFrontmatter, key: string): string[] {
  const value = frontmatter?.[key];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  if (!single) {
    return [];
  }
  if (single.includes(',')) {
    return single.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [single];
}

export function readFrontmatterTimestamp(frontmatter: ObsidianFrontmatter, key: string): number | null {
  const rawValue = readFrontmatterString(frontmatter, key);
  if (!rawValue) {
    return null;
  }
  const parsed = Date.parse(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDocumentIdentitySet(filePath: string, frontmatter: ObsidianFrontmatter): Set<string> {
  const identities = new Set<string>([normalizeMetadataReference(filePath)]);
  const canonicalKey = readFrontmatterString(frontmatter, 'canonical_key');
  if (canonicalKey) {
    identities.add(normalizeMetadataReference(canonicalKey));
  }
  return identities;
}

export function applyGuildScopeRanking<T extends GuildScopedPathCandidate>(
  candidates: T[],
  guildId: string | undefined,
  limit: number,
  mode: GuildScopeMode,
): T[] {
  const safeGuildId = sanitizeGuildId(guildId);
  if (!safeGuildId || mode === 'off') {
    return candidates.slice(0, limit);
  }

  const guildPrefix = `guilds/${safeGuildId}/`;
  const guildPaths = candidates.filter((candidate) => candidate.filePath.startsWith(guildPrefix));
  if (mode === 'strict') {
    return guildPaths.slice(0, limit);
  }

  const globalPaths = candidates.filter((candidate) => !candidate.filePath.startsWith(guildPrefix));
  return [...guildPaths, ...globalPaths].slice(0, limit);
}

export function buildFrontmatterContextSummary(frontmatter: ObsidianFrontmatter): string {
  if (!frontmatter) {
    return '';
  }

  const parts: string[] = [];
  const status = readFrontmatterString(frontmatter, 'status');
  const validAt = readFrontmatterString(frontmatter, 'valid_at');
  const invalidAt = readFrontmatterString(frontmatter, 'invalid_at');
  const sourceRefs = readFrontmatterStringArray(frontmatter, 'source_refs');
  const supersedesRefs = readFrontmatterStringArray(frontmatter, 'supersedes');

  if (status) parts.push(`status=${status}`);
  if (validAt) parts.push(`valid_at=${validAt.slice(0, 19)}`);
  if (invalidAt) parts.push(`invalid_at=${invalidAt.slice(0, 19)}`);
  if (sourceRefs.length > 0) parts.push(`source_refs=${sourceRefs.length}`);
  if (supersedesRefs.length > 0) parts.push(`supersedes=${supersedesRefs.length}`);

  return parts.join(' | ');
}
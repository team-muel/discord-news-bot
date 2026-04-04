import logger from '../../logger';
import { writeObsidianNoteWithAdapter } from './router';

const sanitizeGuildId = (value: unknown): string => {
  const candidate = String(value || '').trim();
  if (!/^\d{6,30}$/.test(candidate)) {
    return '';
  }
  return candidate;
};

const sanitizeFileName = (value: unknown): string => {
  const candidate = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return candidate || 'Untitled';
};

const stripMarkdownExtension = (value: string): string => {
  return String(value || '').trim().replace(/\.md$/i, '');
};

const canonicalizeLoreDocName = (rawName: string): string => {
  const normalized = stripMarkdownExtension(rawName)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .trim();

  if (normalized === 'guild_lore' || normalized === 'lore') {
    return 'Guild_Lore';
  }
  if (normalized === 'server_history' || normalized === 'history') {
    return 'Server_History';
  }
  if (normalized === 'decision_log' || normalized === 'decisions' || normalized === 'decision') {
    return 'Decision_Log';
  }

  return sanitizeFileName(stripMarkdownExtension(rawName));
};

const normalizeNestedRelativePath = (rawPath: string): string => {
  const normalized = stripMarkdownExtension(rawPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  const segments = normalized
    .split('/')
    .map((segment) => sanitizeFileName(segment))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

  return segments.join('/');
};

const toGuildRelativePath = (guildId: string, fileName: string): string => {
  const nested = normalizeNestedRelativePath(fileName);
  if (nested.includes('/')) {
    return `guilds/${guildId}/${nested}.md`;
  }

  const baseName = canonicalizeLoreDocName(nested || fileName);
  return `guilds/${guildId}/${baseName}.md`;
};

const normalizeTags = (tags?: string[]): string[] => {
  return (tags || [])
    .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 40);
};

export const upsertObsidianGuildDocument = async (params: {
  guildId: string;
  vaultPath: string;
  fileName: string;
  content: string;
  tags?: string[];
  properties?: Record<string, string | number | boolean | null>;
}): Promise<{ ok: boolean; path: string | null; reason?: string }> => {
  const guildId = sanitizeGuildId(params.guildId);
  if (!guildId) {
    return { ok: false, path: null, reason: 'INVALID_GUILD_ID' };
  }

  const vaultPath = String(params.vaultPath || '').trim();
  if (!vaultPath) {
    return { ok: false, path: null, reason: 'VAULT_PATH_REQUIRED' };
  }

  const content = String(params.content || '').trim();
  if (!content) {
    return { ok: false, path: null, reason: 'EMPTY_CONTENT' };
  }

  const result = await writeObsidianNoteWithAdapter({
    guildId,
    vaultPath,
    fileName: toGuildRelativePath(guildId, params.fileName),
    content,
    tags: normalizeTags(params.tags),
    properties: params.properties || {},
    trustedSource: true,
  });

  if (!result?.path) {
    logger.warn('[OBSIDIAN-AUTHORING] write failed for guild=%s file=%s', guildId, params.fileName);
    return { ok: false, path: null, reason: 'WRITE_FAILED' };
  }

  return { ok: true, path: result.path };
};

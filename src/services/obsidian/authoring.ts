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
    fileName: sanitizeFileName(params.fileName),
    content,
    tags: normalizeTags(params.tags),
    properties: params.properties || {},
  });

  if (!result?.path) {
    logger.warn('[OBSIDIAN-AUTHORING] write failed for guild=%s file=%s', guildId, params.fileName);
    return { ok: false, path: null, reason: 'WRITE_FAILED' };
  }

  return { ok: true, path: result.path };
};

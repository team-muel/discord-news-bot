import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { createMemoryItem } from '../agent/agentMemoryStore';
import { doc } from '../obsidian/obsidianDocBuilder';
import { summarizeReflectionBundle, upsertObsidianGuildDocument } from '../obsidian/authoring';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getErrorMessage } from '../../utils/errorMessage';

type NoteInput = {
  row: {
    id: number;
    guild_id: string | null;
    url: string;
    name: string | null;
    channel_id?: string | null;
  };
  mode: 'videos' | 'posts';
  latest: {
    id: string;
    title: string;
    content?: string;
    link: string;
    published: string;
    author: string;
  };
};

const MEMORY_TAGS = ['youtube', 'subscription', 'posts', 'community-post'] as const;
const MEMORY_EXCERPT_LIMIT = 280;
const MEMORY_CONTENT_LIMIT = 4_000;
const MEMORY_CONFIDENCE = 0.82;

const sanitizeSlug = (value: string, maxLen = 80): string =>
  value
    .replace(/[^a-zA-Z0-9\u3131-\uD79D_.-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen) || 'untitled';

const toDatePrefix = (published: string): string => {
  try {
    return new Date(published).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const truncateText = (value: string, maxLen: number): string => {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}...`;
};

const buildMemoryTitle = (input: NoteInput): string => {
  return String(input.latest.title || `${input.latest.author} ${input.mode}`).trim() || `${input.latest.author || 'YouTube'} ${input.mode}`;
};

const buildMemorySourceRef = (input: NoteInput): string => {
  const link = String(input.latest.link || '').trim();
  if (link) {
    return link;
  }
  return `youtube://${input.mode}/${encodeURIComponent(input.latest.id)}`;
};

const buildMemoryExcerpt = (input: NoteInput): string => {
  const candidate = String(input.latest.content || input.latest.title || '').trim();
  return truncateText(candidate, MEMORY_EXCERPT_LIMIT);
};

const buildMemoryContent = (input: NoteInput): string => {
  const sourceRef = buildMemorySourceRef(input);
  const body = truncateText(String(input.latest.content || '').trim(), MEMORY_CONTENT_LIMIT);
  return [
    `[youtube-${input.mode}] ${buildMemoryTitle(input)}`,
    input.latest.author ? `author: ${input.latest.author}` : null,
    input.latest.published ? `published: ${input.latest.published}` : null,
    `url: ${sourceRef}`,
    body ? `content:\n${body}` : null,
  ].filter(Boolean).join('\n');
};

const hasExistingMemorySource = async (guildId: string, sourceRef: string): Promise<boolean> => {
  if (!isSupabaseConfigured() || !sourceRef) {
    return false;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('memory_sources')
      .select('memory_item_id')
      .eq('guild_id', guildId)
      .eq('source_ref', sourceRef)
      .limit(1);

    if (error) {
      logger.warn('[SUBSCRIPTION-NOTE] memory source lookup failed guild=%s ref=%s reason=%s', guildId, sourceRef, error.message || 'LOOKUP_FAILED');
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    logger.warn('[SUBSCRIPTION-NOTE] memory source lookup threw guild=%s ref=%s reason=%s', guildId, sourceRef, getErrorMessage(error));
    return false;
  }
};

const persistSubscriptionMemory = async (input: NoteInput, guildId: string): Promise<void> => {
  if (input.mode !== 'posts' || !isSupabaseConfigured()) {
    return;
  }

  const sourceRef = buildMemorySourceRef(input);
  if (await hasExistingMemorySource(guildId, sourceRef)) {
    return;
  }

  try {
    await createMemoryItem({
      guildId,
      channelId: input.row.channel_id || undefined,
      type: 'episode',
      title: buildMemoryTitle(input),
      content: buildMemoryContent(input),
      tags: [...MEMORY_TAGS],
      confidence: MEMORY_CONFIDENCE,
      actorId: 'youtube-monitor',
      source: {
        sourceKind: 'system',
        sourceRef,
        excerpt: buildMemoryExcerpt(input),
      },
    });
    logger.info('[SUBSCRIPTION-NOTE] memory persisted guild=%s source=%d ref=%s', guildId, input.row.id, sourceRef);
  } catch (error) {
    logger.warn('[SUBSCRIPTION-NOTE] memory persist failed guild=%s source=%d reason=%s', guildId, input.row.id, getErrorMessage(error));
  }
};

export const writeSubscriptionNote = async (input: NoteInput): Promise<void> => {
  const { row, mode, latest } = input;

  const guildId = String(row.guild_id || '').trim();
  if (!guildId || !/^\d{6,30}$/.test(guildId)) {
    return;
  }

  await persistSubscriptionMemory(input, guildId);

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    return;
  }

  const datePrefix = toDatePrefix(latest.published);
  const slug = sanitizeSlug(latest.title || latest.id);
  const fileName = `events/subscriptions/${datePrefix}_${mode}_${slug}`;

  const builder = doc()
    .title(latest.title || `${latest.author} — ${mode}`)
    .tag('youtube', 'subscription', mode)
    .property('source', 'youtube-monitor')
    .property('created', new Date().toISOString())
    .property('published_at', latest.published)
    .property('author', latest.author)
    .property('youtube_id', latest.id)
    .property('mode', mode)
    .property('source_row_id', row.id);

  builder.section('Content');
  if (latest.link) {
    builder.line(`URL: ${latest.link}`);
  }
  if (latest.content) {
    builder.line('');
    builder.line(latest.content.slice(0, 2000));
  }

  const { markdown, tags } = builder.build();

  const result = await upsertObsidianGuildDocument({
    guildId,
    vaultPath,
    fileName,
    content: markdown,
    tags,
  });

  if (result.ok) {
    const reflection = summarizeReflectionBundle(result.reflectionBundle);
    logger.info('[SUBSCRIPTION-NOTE] wrote %s for guild=%s source=%d concern=%s next=%s', fileName, guildId, row.id, reflection.concern, reflection.nextPath);
  } else {
    logger.warn('[SUBSCRIPTION-NOTE] failed guild=%s file=%s reason=%s', guildId, fileName, result.reason);
  }
};

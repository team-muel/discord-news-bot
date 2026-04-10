import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { doc } from '../obsidian/obsidianDocBuilder';
import { summarizeReflectionBundle, upsertObsidianGuildDocument } from '../obsidian/authoring';
import { getErrorMessage } from '../../utils/errorMessage';

type NoteInput = {
  row: {
    id: number;
    guild_id: string | null;
    url: string;
    name: string | null;
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

export const writeSubscriptionNote = async (input: NoteInput): Promise<void> => {
  const { row, mode, latest } = input;

  const guildId = String(row.guild_id || '').trim();
  if (!guildId || !/^\d{6,30}$/.test(guildId)) {
    return;
  }

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

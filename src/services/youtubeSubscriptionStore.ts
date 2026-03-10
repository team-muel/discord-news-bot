import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type YouTubeSubscriptionKind = 'videos' | 'posts';

export type YouTubeSubscription = {
  id: number;
  user_id: string | null;
  guild_id: string | null;
  channel_id: string | null;
  url: string;
  name: string;
  last_post_id: string | null;
  last_post_signature: string | null;
  created_at: string | null;
};

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{20,}$/;

const extractChannelIdFromInput = (input: string): string | null => {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (CHANNEL_ID_RE.test(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      const fromQuery = parsed.searchParams.get('channel_id');
      if (fromQuery && CHANNEL_ID_RE.test(fromQuery)) {
        return fromQuery;
      }

      const channelMatch = parsed.pathname.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/);
      if (channelMatch?.[1] && CHANNEL_ID_RE.test(channelMatch[1])) {
        return channelMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
};

const buildSourceUrl = (
  channelId: string,
  kind: YouTubeSubscriptionKind,
  guildId: string,
  discordChannelId: string,
): string => {
  return `https://www.youtube.com/channel/${channelId}?muelGuild=${encodeURIComponent(guildId)}&muelChannel=${encodeURIComponent(discordChannelId)}#${kind}`;
};

export const parseYouTubeChannelIdOrThrow = (input: string): string => {
  const channelId = extractChannelIdFromInput(input);
  if (!channelId) {
    throw new Error('유효한 YouTube 채널 URL 또는 채널 ID(UC...)를 입력해주세요.');
  }
  return channelId;
};

export const createYouTubeSubscription = async (params: {
  userId: string;
  guildId: string;
  discordChannelId: string;
  channelInput: string;
  kind: YouTubeSubscriptionKind;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const channelId = parseYouTubeChannelIdOrThrow(params.channelInput);
  const url = buildSourceUrl(channelId, params.kind, params.guildId, params.discordChannelId);
  const client = getSupabaseClient();

  const { data: existingByScope, error: existingByScopeError } = await client
    .from('sources')
    .select('id, user_id, guild_id, channel_id, url, name, last_post_id, last_post_signature, created_at')
    .eq('url', url)
    .eq('guild_id', params.guildId)
    .eq('channel_id', params.discordChannelId)
    .limit(1);

  if (existingByScopeError) {
    throw existingByScopeError;
  }

  if (existingByScope && existingByScope.length > 0) {
    return { created: false, row: existingByScope[0] as YouTubeSubscription, channelId, url };
  }

  const { data: inserted, error: insertError } = await client
    .from('sources')
    .insert([
      {
        user_id: params.userId,
        guild_id: params.guildId,
        channel_id: params.discordChannelId,
        name: `youtube-${params.kind}`,
        url,
      },
    ])
    .select('id, user_id, guild_id, channel_id, url, name, last_post_id, last_post_signature, created_at')
    .limit(1);

  if (insertError) {
    throw insertError;
  }

  if (!inserted || inserted.length === 0) {
    throw new Error('INSERT_FAILED');
  }

  return { created: true, row: inserted[0] as YouTubeSubscription, channelId, url };
};

export const listYouTubeSubscriptions = async (params: { guildId: string; userId?: string }) => {
  if (!isSupabaseConfigured()) {
    return [] as YouTubeSubscription[];
  }

  const client = getSupabaseClient();
  let query = client
    .from('sources')
    .select('id, user_id, guild_id, channel_id, url, name, last_post_id, last_post_signature, created_at')
    .eq('guild_id', params.guildId)
    .ilike('url', '%youtube.com/channel/%#%')
    .order('created_at', { ascending: false });

  if (params.userId) {
    query = query.eq('user_id', params.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data ?? []) as YouTubeSubscription[];
};

export const deleteYouTubeSubscription = async (params: {
  guildId: string;
  discordChannelId: string;
  channelInput: string;
  kind: YouTubeSubscriptionKind;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const channelId = parseYouTubeChannelIdOrThrow(params.channelInput);
  const url = buildSourceUrl(channelId, params.kind, params.guildId, params.discordChannelId);
  const client = getSupabaseClient();

  const { data: rows, error: selectError } = await client
    .from('sources')
    .select('id')
    .eq('guild_id', params.guildId)
    .eq('channel_id', params.discordChannelId)
    .eq('url', url)
    .limit(1);

  if (selectError) {
    throw selectError;
  }

  if (!rows || rows.length === 0) {
    return { deleted: false, channelId, url };
  }

  const targetId = rows[0].id;
  const { error: deleteError } = await client.from('sources').delete().eq('id', targetId);
  if (deleteError) {
    throw deleteError;
  }

  return { deleted: true, channelId, url };
};

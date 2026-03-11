import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type NewsChannelSubscription = {
  id: number;
  user_id: string | null;
  guild_id: string | null;
  channel_id: string | null;
  url: string;
  name: string;
  created_at: string | null;
};

const resolvePersistedUserId = async (userId: string): Promise<string | null> => {
  const normalized = userId.trim();
  if (!normalized) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('users')
    .select('id')
    .eq('id', normalized)
    .limit(1);

  if (error) {
    throw error;
  }

  return data && data.length > 0 ? normalized : null;
};

const buildNewsSourceUrl = (guildId: string, discordChannelId: string): string => {
  return `https://www.google.com/finance/markets?muelGuild=${encodeURIComponent(guildId)}&muelChannel=${encodeURIComponent(discordChannelId)}#google-finance-news`;
};

export const createNewsChannelSubscription = async (params: {
  userId: string;
  guildId: string;
  discordChannelId: string;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const url = buildNewsSourceUrl(params.guildId, params.discordChannelId);
  const client = getSupabaseClient();

  const { data: existing, error: existingError } = await client
    .from('sources')
    .select('id, user_id, guild_id, channel_id, url, name, created_at')
    .eq('name', 'google-finance-news')
    .eq('guild_id', params.guildId)
    .eq('channel_id', params.discordChannelId)
    .limit(1);

  if (existingError) {
    throw existingError;
  }

  if (existing && existing.length > 0) {
    const row = existing[0] as NewsChannelSubscription;
    if (!row.url) {
      const { error: updateError } = await client.from('sources').update({ url }).eq('id', row.id);
      if (updateError) {
        throw updateError;
      }
    }
    return { created: false, row };
  }

  const persistedUserId = await resolvePersistedUserId(params.userId);

  const { data: inserted, error: insertError } = await client
    .from('sources')
    .insert([
      {
        user_id: persistedUserId,
        guild_id: params.guildId,
        channel_id: params.discordChannelId,
        name: 'google-finance-news',
        url,
      },
    ])
    .select('id, user_id, guild_id, channel_id, url, name, created_at')
    .limit(1);

  if (insertError) {
    throw insertError;
  }

  if (!inserted || inserted.length === 0) {
    throw new Error('INSERT_FAILED');
  }

  return { created: true, row: inserted[0] as NewsChannelSubscription };
};

export const listNewsChannelSubscriptions = async (params: { guildId: string }) => {
  if (!isSupabaseConfigured()) {
    return [] as NewsChannelSubscription[];
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('sources')
    .select('id, user_id, guild_id, channel_id, url, name, created_at')
    .eq('name', 'google-finance-news')
    .eq('guild_id', params.guildId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as NewsChannelSubscription[];
};

export const deleteNewsChannelSubscription = async (params: {
  guildId: string;
  discordChannelId: string;
}) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const client = getSupabaseClient();
  const { data: rows, error: selectError } = await client
    .from('sources')
    .select('id')
    .eq('name', 'google-finance-news')
    .eq('guild_id', params.guildId)
    .eq('channel_id', params.discordChannelId)
    .limit(1);

  if (selectError) {
    throw selectError;
  }

  if (!rows || rows.length === 0) {
    return { deleted: false };
  }

  const { error: deleteError } = await client.from('sources').delete().eq('id', rows[0].id);
  if (deleteError) {
    throw deleteError;
  }

  return { deleted: true };
};

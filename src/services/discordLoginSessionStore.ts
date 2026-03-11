import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export const upsertDiscordLoginSession = async (params: {
  guildId: string;
  userId: string;
  expiresAt: string;
}): Promise<boolean> => {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from('discord_login_sessions')
    .upsert(
      {
        guild_id: params.guildId,
        user_id: params.userId,
        expires_at: params.expiresAt,
      },
      { onConflict: 'guild_id,user_id' },
    );

  if (error) {
    throw error;
  }

  return true;
};

export const purgeExpiredDiscordLoginSessions = async (): Promise<number> => {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  const client = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('discord_login_sessions')
    .delete()
    .lt('expires_at', nowIso)
    .select('guild_id,user_id');

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data.length : 0;
};

export const getDiscordLoginSessionExpiryMs = async (params: {
  guildId: string;
  userId: string;
}): Promise<number | null> => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('discord_login_sessions')
    .select('expires_at')
    .eq('guild_id', params.guildId)
    .eq('user_id', params.userId)
    .limit(1);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const raw = String((data[0] as { expires_at?: string }).expires_at || '').trim();
  if (!raw) {
    return null;
  }

  const expiresAt = Date.parse(raw);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  if (Date.now() > expiresAt) {
    await client
      .from('discord_login_sessions')
      .delete()
      .eq('guild_id', params.guildId)
      .eq('user_id', params.userId);
    return null;
  }

  return expiresAt;
};

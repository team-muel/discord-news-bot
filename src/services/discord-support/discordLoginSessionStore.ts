import { fromTable } from '../infra/baseRepository';
import { T_DISCORD_LOGIN_SESSIONS } from '../infra/tableRegistry';

export const upsertDiscordLoginSession = async (params: {
  guildId: string;
  userId: string;
  expiresAt: string;
}): Promise<boolean> => {
  const qb = fromTable(T_DISCORD_LOGIN_SESSIONS);
  if (!qb) return false;

  const { error } = await qb
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
  const qb = fromTable(T_DISCORD_LOGIN_SESSIONS);
  if (!qb) return 0;

  const nowIso = new Date().toISOString();
  const { data, error } = await qb
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
  const qb = fromTable(T_DISCORD_LOGIN_SESSIONS);
  if (!qb) return null;

  const { data, error } = await qb
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
    const delQb = fromTable(T_DISCORD_LOGIN_SESSIONS);
    if (delQb) {
      await delQb
        .delete()
        .eq('guild_id', params.guildId)
        .eq('user_id', params.userId);
    }
    return null;
  }

  return expiresAt;
};

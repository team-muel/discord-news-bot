import logger from '../../logger';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { isMissingTableError } from '../../utils/supabaseErrors';

const unavailableLockNames = new Set<string>();
const MAX_UNAVAILABLE_LOCK_NAMES = 200;

const isLockTableUnavailableError = (error: any): boolean => isMissingTableError(error, 'distributed_locks');

export const acquireDistributedLease = async (params: {
  name: string;
  owner: string;
  leaseMs: number;
}): Promise<{ ok: boolean; reason?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: 'SUPABASE_NOT_CONFIGURED' };
  }

  const db = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + Math.max(5_000, params.leaseMs)).toISOString();

  try {
    const { data, error } = await db
      .from('distributed_locks')
      .update({ owner_token: params.owner, expires_at: leaseUntilIso, updated_at: new Date().toISOString() })
      .eq('name', params.name)
      .or(`owner_token.is.null,expires_at.lt.${nowIso},owner_token.eq.${params.owner}`)
      .select('name')
      .limit(1);

    if (error) {
      throw error;
    }

    if (Array.isArray(data) && data.length > 0) {
      return { ok: true };
    }

    const { error: insertError } = await db.from('distributed_locks').insert([
      {
        name: params.name,
        owner_token: params.owner,
        expires_at: leaseUntilIso,
      },
    ]);

    if (!insertError) {
      return { ok: true };
    }

    const code = String((insertError as any)?.code || '');
    if (code !== '23505') {
      throw insertError;
    }

    return { ok: false, reason: 'LOCK_HELD' };
  } catch (error) {
    if (isLockTableUnavailableError(error)) {
      if (!unavailableLockNames.has(params.name) && unavailableLockNames.size < MAX_UNAVAILABLE_LOCK_NAMES) {
        unavailableLockNames.add(params.name);
        logger.error('[LOCK] distributed_locks table missing/unavailable; lock=%s', params.name);
      }
      return { ok: false, reason: 'LOCK_TABLE_UNAVAILABLE' };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[LOCK] acquire failed lock=%s err=%s', params.name, message);
    return { ok: false, reason: 'LOCK_ERROR' };
  }
};

export const releaseDistributedLease = async (params: {
  name: string;
  owner: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const db = getSupabaseClient();
    const { error } = await db
      .from('distributed_locks')
      .update({ owner_token: null, expires_at: null, updated_at: new Date().toISOString() })
      .eq('name', params.name)
      .eq('owner_token', params.owner);

    if (error && !isLockTableUnavailableError(error)) {
      logger.warn('[LOCK] release failed lock=%s err=%s', params.name, error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[LOCK] release error lock=%s err=%s', params.name, message);
  }
};

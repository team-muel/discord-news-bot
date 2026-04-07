import logger from '../../logger';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { isMissingTableError, isMissingFunctionError } from '../../utils/supabaseErrors';
import { getErrorMessage } from '../../utils/errorMessage';

const unavailableLockNames = new Set<string>();
const MAX_UNAVAILABLE_LOCK_NAMES = 200;

const isLockTableUnavailableError = (error: any): boolean => isMissingTableError(error, 'distributed_locks');

let legacyFallbackWarned = false;

/**
 * Legacy two-step acquire (UPDATE → INSERT).
 * Kept as fallback while the `acquire_distributed_lease` RPC is being deployed.
 * Subject to a low-probability TOCTOU race — see MIGRATION_DISTRIBUTED_LOCK_RPC.sql.
 */
const acquireLegacy = async (
  db: ReturnType<typeof getSupabaseClient>,
  params: { name: string; owner: string },
  leaseUntilIso: string,
  nowIso: string,
): Promise<{ ok: boolean; reason?: string }> => {
  const { data, error } = await db
    .from('distributed_locks')
    .update({ owner_token: params.owner, expires_at: leaseUntilIso, updated_at: new Date().toISOString() })
    .eq('name', params.name)
    .or(`owner_token.is.null,expires_at.lt.${nowIso},owner_token.eq.${params.owner}`)
    .select('name')
    .limit(1);

  if (error) throw error;

  if (Array.isArray(data) && data.length > 0) return { ok: true };

  const { error: insertError } = await db.from('distributed_locks').insert([
    { name: params.name, owner_token: params.owner, expires_at: leaseUntilIso },
  ]);

  if (!insertError) return { ok: true };

  const code = String((insertError as unknown as Record<string, unknown>)?.code || '');
  if (code !== '23505') throw insertError;

  return { ok: false, reason: 'LOCK_HELD' };
};

export const acquireDistributedLease = async (params: {
  name: string;
  owner: string;
  leaseMs: number;
}): Promise<{ ok: boolean; reason?: string }> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: 'SUPABASE_NOT_CONFIGURED' };
  }

  const db = getSupabaseClient();
  const safeLeaseMs = Math.max(5_000, params.leaseMs);
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + safeLeaseMs).toISOString();

  try {
    // Atomic single-statement acquire via PostgreSQL RPC.
    // Falls back to legacy two-step if the RPC function is not yet deployed.
    const { data, error } = await db.rpc('acquire_distributed_lease', {
      p_name: params.name,
      p_owner: params.owner,
      p_lease_ms: safeLeaseMs,
    });

    if (error) {
      if (isMissingFunctionError(error, 'acquire_distributed_lease')) {
        if (!legacyFallbackWarned) {
          legacyFallbackWarned = true;
          logger.warn(
            '[LOCK] acquire_distributed_lease RPC not found — using legacy two-step acquire. Deploy MIGRATION_DISTRIBUTED_LOCK_RPC.sql to fix.',
          );
        }
        return await acquireLegacy(db, params, leaseUntilIso, nowIso);
      }
      throw error;
    }

    const acquired = typeof data === 'boolean' ? data : Boolean(data);
    return acquired ? { ok: true } : { ok: false, reason: 'LOCK_HELD' };
  } catch (error) {
    if (isLockTableUnavailableError(error)) {
      if (!unavailableLockNames.has(params.name) && unavailableLockNames.size < MAX_UNAVAILABLE_LOCK_NAMES) {
        unavailableLockNames.add(params.name);
        logger.error('[LOCK] distributed_locks table missing/unavailable; lock=%s', params.name);
      }
      return { ok: false, reason: 'LOCK_TABLE_UNAVAILABLE' };
    }

    const message = getErrorMessage(error);
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
    const message = getErrorMessage(error);
    logger.warn('[LOCK] release error lock=%s err=%s', params.name, message);
  }
};

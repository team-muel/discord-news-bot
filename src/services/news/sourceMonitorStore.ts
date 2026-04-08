import logger from '../../logger';
import { getClient } from '../infra/baseRepository';
import { T_SOURCES } from '../infra/tableRegistry';

export const updateSourceState = async (params: {
  id: number;
  patch: Record<string, string | null>;
  logPrefix: string;
}) => {
  const db = getClient();
  const { error } = await db
    .from(T_SOURCES)
    .update({ ...params.patch, last_check_at: new Date().toISOString() })
    .eq('id', params.id);

  if (error) {
    logger.warn('%s failed to update source=%s: %s', params.logPrefix, String(params.id), error.message);
  }
};

export const claimSourceLock = async (params: {
  id: number;
  instanceId: string;
  lockLeaseMs: number;
  logPrefix: string;
}): Promise<boolean> => {
  const db = getClient();
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + params.lockLeaseMs).toISOString();

  const tryClaimLockTokenNull = async () => {
    return db
      .from(T_SOURCES)
      .update({ lock_token: params.instanceId, lock_expires_at: leaseUntilIso })
      .eq('id', params.id)
      .eq('is_active', true)
      .is('lock_token', null)
      .select('id')
      .limit(1);
  };

  const tryClaimOwnLockToken = async () => {
    return db
      .from(T_SOURCES)
      .update({ lock_token: params.instanceId, lock_expires_at: leaseUntilIso })
      .eq('id', params.id)
      .eq('is_active', true)
      .eq('lock_token', params.instanceId)
      .select('id')
      .limit(1);
  };

  const tryClaimExpiredLock = async () => {
    return db
      .from(T_SOURCES)
      .update({ lock_token: params.instanceId, lock_expires_at: leaseUntilIso })
      .eq('id', params.id)
      .eq('is_active', true)
      .lt('lock_expires_at', nowIso)
      .select('id')
      .limit(1);
  };

  const tryClaimNullExpiresAt = async () => {
    return db
      .from(T_SOURCES)
      .update({ lock_token: params.instanceId, lock_expires_at: leaseUntilIso })
      .eq('id', params.id)
      .eq('is_active', true)
      .is('lock_expires_at', null)
      .select('id')
      .limit(1);
  };

  const attempts = [tryClaimLockTokenNull, tryClaimOwnLockToken, tryClaimExpiredLock, tryClaimNullExpiresAt];

  for (const attempt of attempts) {
    const { data, error } = await attempt();
    if (error) {
      logger.warn('%s lock claim failed source=%s: %s', params.logPrefix, String(params.id), error.message);
      return false;
    }

    if (Array.isArray(data) && data.length > 0) {
      return true;
    }
  }

  return false;
};

export const releaseSourceLock = async (params: {
  id: number;
  instanceId: string;
  logPrefix: string;
}) => {
  const db = getClient();
  const { error } = await db
    .from(T_SOURCES)
    .update({ lock_token: null, lock_expires_at: null })
    .eq('id', params.id)
    .eq('lock_token', params.instanceId);

  if (error) {
    logger.warn('%s lock release failed source=%s: %s', params.logPrefix, String(params.id), error.message);
  }
};

export const fetchFreshSourceRow = async (id: number): Promise<{ last_post_id: string | null; last_post_signature: string | null } | null> => {
  const db = getClient();
  const { data, error } = await db
    .from(T_SOURCES)
    .select('last_post_id,last_post_signature')
    .eq('id', id)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as { last_post_id: string | null; last_post_signature: string | null };
};

import logger from '../logger';
import { getSupabaseClient } from './supabaseClient';

export const updateSourceState = async (params: {
  id: number;
  patch: Record<string, string | null>;
  logPrefix: string;
}) => {
  const db = getSupabaseClient();
  const { error } = await db
    .from('sources')
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
  const db = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + params.lockLeaseMs).toISOString();

  const { data, error } = await db
    .from('sources')
    .update({ lock_token: params.instanceId, lock_expires_at: leaseUntilIso })
    .eq('id', params.id)
    .eq('is_active', true)
    .or(`lock_token.is.null,lock_expires_at.lt.${nowIso},lock_token.eq.${params.instanceId}`)
    .select('id')
    .limit(1);

  if (error) {
    logger.warn('%s lock claim failed source=%s: %s', params.logPrefix, String(params.id), error.message);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

export const releaseSourceLock = async (params: {
  id: number;
  instanceId: string;
  logPrefix: string;
}) => {
  const db = getSupabaseClient();
  const { error } = await db
    .from('sources')
    .update({ lock_token: null, lock_expires_at: null })
    .eq('id', params.id)
    .eq('lock_token', params.instanceId);

  if (error) {
    logger.warn('%s lock release failed source=%s: %s', params.logPrefix, String(params.id), error.message);
  }
};

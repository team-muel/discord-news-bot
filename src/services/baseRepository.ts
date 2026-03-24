/**
 * Base repository helpers for Supabase data access.
 *
 * New Store/Repository files should import from here instead of
 * supabaseClient directly. This centralizes:
 *   - Configuration check
 *   - Error normalization
 *   - Retry-on-transient pattern
 *
 * Migration path:
 *   1. New code: import { getClient, withSupabase } from './baseRepository'
 *   2. Existing code: gradually adopt when touching Store files
 *   3. supabaseClient.ts remains the low-level singleton
 */
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import logger from '../logger';

export type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

/**
 * Returns the Supabase client or throws a clear error.
 * Use this instead of importing getSupabaseClient directly.
 */
export const getClient = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

/**
 * Execute a Supabase operation with standardized error handling.
 * Returns a discriminated union instead of throwing.
 *
 * @example
 * const result = await withSupabase(async (client) => {
 *   const { data, error } = await client.from('users').select('*').eq('id', userId);
 *   if (error) throw error;
 *   return data;
 * });
 * if (!result.ok) { logger.warn('DB error: %s', result.error); }
 */
export const withSupabase = async <T>(
  fn: (client: ReturnType<typeof getSupabaseClient>) => Promise<T>,
): Promise<RepositoryResult<T>> => {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'SUPABASE_NOT_CONFIGURED', code: 'NOT_CONFIGURED' };
  }
  try {
    const client = getSupabaseClient();
    const data = await fn(client);
    return { ok: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as Record<string, unknown>).code)
      : undefined;
    logger.debug('[REPO] operation failed: %s (code=%s)', message, code || 'unknown');
    return { ok: false, error: message, code };
  }
};

/**
 * Normalize Supabase/Postgrest errors into user-readable messages.
 * Prevents leaking raw [object Object] into Discord responses.
 */
export const normalizeDbError = (err: unknown): string => {
  if (!err) return 'Unknown database error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    // Postgrest error shape: { code, message, details, hint }
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.details === 'string') return obj.details;
  }
  return String(err);
};

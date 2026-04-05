/**
 * Base repository helpers for Supabase data access.
 *
 * Provides `getClient` (config-checked singleton) and `fromTable`
 * (shorthand for `.from(table)` with null-on-unconfigured).
 *
 * New Store/Repository files should import from here instead of
 * supabaseClient directly.
 */
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

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
 * Shorthand: check Supabase is configured, get client, then call `.from(table)`.
 * Returns null (unconfigured) or the query builder.
 *
 * @example
 * const qb = fromTable(T_USERS);
 * if (!qb) return null;
 * const { data, error } = await qb.select('*').eq('id', userId);
 */
export const fromTable = (table: string) => {
  if (!isSupabaseConfigured()) return null;
  return getSupabaseClient().from(table);
};

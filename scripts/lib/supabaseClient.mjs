/**
 * Shared Supabase client factory for scripts.
 * Replaces 7+ copy-pasted createClient + env parsing blocks.
 */
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
export const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

/**
 * Create a Supabase client for script usage (no session persistence).
 * Throws if URL or KEY is missing.
 */
export const createScriptClient = () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY (SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
};

/**
 * Detect "table / relation does not exist" from any Supabase / PostgREST error.
 *
 * Covers:
 *  - 42P01  (PostgreSQL: undefined_table)
 *  - PGRST205  (PostgREST: schema-cache miss)
 *  - PGRST204  (PostgREST: relation not found)
 *  - message heuristics: tableName mention, "does not exist", "could not find"
 */
export const isMissingRelationError = (error, tableName = '') => {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  if (message.includes('does not exist') || message.includes('could not find')) return true;
  if (tableName) return message.includes(String(tableName).toLowerCase());
  return false;
};
